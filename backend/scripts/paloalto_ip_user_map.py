"""
임시 스크립트: Palo Alto 한 대에서 `show user ip-user-mapping ip <ip>` 를 IP별로 조회해
IP → AD 도메인\\사용자명 매핑을 Excel 로 정리한다.

- 장비는 DB 에 등록된 Palo Alto 1대를 --ip 로 지정한다 (접속 정보는 DB 에서). HA 피어 IP 를 주면 피어에 접속한다.
- 조회할 IP 는 --file 에서 읽는다 (한 줄에 하나, 빈 줄/# 주석/중복 무시, 입력 순서 유지).
- XML API(op 명령)로 IP 1개씩 순차 조회하며 --delay 초 간격을 둔다 (기본 1초, 500개 ≈ 8분).
  `all` 은 매핑이 수만 건이면 응답이 너무 커서 쓰지 않는다.
- 응답 파싱: XML <entry> / `IP address: x (vsys1)` + `User: d\\u` 블록 / 헤더가 있는 표 — 셋 다 처리.
- 중간에 중단(Ctrl+C)하거나 연속 실패로 멈춰도 그때까지의 결과는 Excel 로 저장한다.

실행 (프로젝트 루트에서):
    .venv/bin/python backend/scripts/paloalto_ip_user_map.py --ip 192.168.1.1 --file ips.txt [--out out.xlsx] [--delay 1] [--vsys vsys1]
"""
import argparse
import asyncio
import ipaddress
import os
import re
import sys
import time
import xml.etree.ElementTree as ET
from datetime import datetime

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pandas as pd

from app.services.sync.collector import create_collector_from_device
from paloalto_vuln_check import load_devices

MAX_CONSECUTIVE_ERRORS = 10  # 연속 실패가 이만큼이면 장비/접속 문제로 보고 중단

_IP_BLOCK = re.compile(r'IP address:\s*(\S+)\s*\(([^)]*)\)', re.IGNORECASE)
_KV = re.compile(r'^\s*([A-Za-z][A-Za-z _()/-]*?)\s*:\s*(.*?)\s*$')


def split_user(user: str) -> tuple[str, str]:
    """`domain\\username` → (domain, username). 도메인이 없으면 ('', user)."""
    if '\\' in user:
        domain, name = user.split('\\', 1)
        return domain, name
    return '', user


def _parse_text(text: str) -> list[dict]:
    rows, cur, header = [], None, None
    for line in text.splitlines():
        m = _IP_BLOCK.search(line)
        if m:
            cur = {'ip': m.group(1), 'vsys': m.group(2)}
            rows.append(cur)
            continue
        kv = _KV.match(line)
        if kv and cur is not None:
            key, val = kv.group(1).strip(), kv.group(2)
            if key.lower() == 'user':
                cur['user'] = val
            else:
                cur[key] = val
            continue
        tokens = line.split()
        if not tokens or all(set(t) <= set('-=') for t in tokens):  # 빈 줄 / 표 구분선
            continue
        if tokens[0].lower() == 'ip' and any(t.lower() == 'user' for t in tokens):  # 표 헤더
            header, cur = [t.lower() for t in tokens], None
        elif header and len(tokens) == len(header):
            rows.append(dict(zip(header, tokens)))
    return rows


def parse_mapping(xml_text: str) -> list[dict]:
    """응답에서 매핑 행들을 뽑는다. 각 행은 최소 ip / user 키를 가지며, 나머지 필드는 원본 키 그대로 유지."""
    result = ET.fromstring(xml_text).find('./result')
    if result is None:
        return []
    entries = result.findall('.//entry')
    if entries:
        raw = [{c.tag: (c.text or '').strip() for c in e} for e in entries]
    else:
        raw = _parse_text(''.join(result.itertext()))
    rows = []
    for r in raw:
        r = {k: v for k, v in r.items()}
        if r.get('user'):
            rows.append(r)
    return rows


def to_output_rows(query_ip: str, mappings: list[dict]) -> list[dict]:
    if not mappings:
        return [{'조회 IP': query_ip, '상태': '매핑 없음'}]
    out = []
    for m in mappings:
        domain, name = split_user(m['user'])
        extra = {k: v for k, v in m.items() if k not in ('ip', 'vsys', 'user')}
        out.append({'조회 IP': query_ip, '상태': '매핑됨', 'vsys': m.get('vsys', ''),
                    '도메인': domain, '사용자명': name, '원본 user': m['user'], **extra})
    return out


def read_ips(path: str) -> tuple[list[str], list[str]]:
    """(유효한 IP 목록, 잘못된 줄 목록). 중복 제거, 순서 유지."""
    valid, bad, seen = [], [], set()
    with open(path, encoding='utf-8-sig') as f:
        for line in f:
            s = line.split('#', 1)[0].strip()
            if not s or s in seen:
                continue
            seen.add(s)
            try:
                ipaddress.ip_address(s)
                valid.append(s)
            except ValueError:
                bad.append(s)
    return valid, bad


def query_one(fw, ip: str, vsys: str | None) -> list[dict]:
    cmd = f'<show><user><ip-user-mapping><ip>{ip}</ip></ip-user-mapping></user></show>'
    params = [('key', fw.api_key), ('type', 'op'), ('cmd', cmd)]
    if vsys:
        params.append(('vsys', vsys))
    text = fw.get_api_data(params, timeout=30).text
    root = ET.fromstring(text)
    if root.get('status') == 'error':
        raise RuntimeError(f"API 오류(code={root.get('code')}): {''.join(root.itertext()).strip()}")
    return parse_mapping(text)


def run_queries(fw, ips: list[str], delay: float, vsys: str | None, rows: list[dict]) -> str:
    """rows 에 결과를 쌓는다 (중단돼도 호출 측에 남도록). 중단 사유를 반환."""
    errors_in_a_row = 0
    for i, ip in enumerate(ips, 1):
        try:
            rows.extend(to_output_rows(ip, query_one(fw, ip, vsys)))
            errors_in_a_row = 0
        except Exception as e:
            rows.append({'조회 IP': ip, '상태': '오류', '오류': f'{type(e).__name__}: {e}'})
            errors_in_a_row += 1
            if errors_in_a_row >= MAX_CONSECUTIVE_ERRORS:
                return f'연속 {MAX_CONSECUTIVE_ERRORS}회 실패로 중단 ({i}/{len(ips)} 처리): {e}'
        if i % 50 == 0 or i == len(ips):
            print(f'  {i}/{len(ips)} 조회')
        if i < len(ips):
            time.sleep(delay)
    return ''


async def main(ip: str, file: str, out: str | None, delay: float, vsys: str | None):
    ips, bad = read_ips(file)
    if not ips:
        print('조회할 유효한 IP가 없습니다.')
        return
    devices = await load_devices([ip])
    if len(devices) != 1:
        print(f'--ip {ip} 에 해당하는 Palo Alto 장비가 {len(devices)}대입니다. 정확히 1대여야 합니다.')
        return
    device = devices[0]
    fw = create_collector_from_device(device, use_ha_ip=(ip == device.ha_peer_ip and ip != device.ip_address))
    if not fw.connect():
        print(f'{device.name}({ip}) 접속/인증 실패')
        return

    print(f'{device.name} ({ip}) — {len(ips)}개 조회, 간격 {delay}초 (예상 {len(ips) * delay / 60:.1f}분)')
    if bad:
        print(f'경고: 잘못된 IP {len(bad)}건은 건너뜁니다: {", ".join(bad[:5])}{" …" if len(bad) > 5 else ""}')
    rows: list[dict] = [{'조회 IP': b, '상태': '오류', '오류': '잘못된 IP 형식'} for b in bad]
    stop_reason = ''
    try:
        stop_reason = run_queries(fw, ips, delay, vsys, rows)
    except KeyboardInterrupt:
        stop_reason = '사용자 중단 (Ctrl+C)'
    finally:
        fw.disconnect()

    if not out:
        out_dir = os.path.join(os.path.dirname(__file__), '..', 'exports')
        os.makedirs(out_dir, exist_ok=True)
        out = os.path.join(out_dir, f"paloalto_ip_user_{datetime.now():%Y%m%d_%H%M%S}.xlsx")
    df = pd.DataFrame(rows)
    with pd.ExcelWriter(out, engine='openpyxl') as writer:
        df.to_excel(writer, sheet_name='매핑', index=False)
    mapped = df[df['상태'] == '매핑됨']['조회 IP'].nunique() if '상태' in df else 0
    print(f'매핑됨 {mapped} / 매핑 없음 {(df["상태"] == "매핑 없음").sum()} / 오류 {(df["상태"] == "오류").sum()}')
    if stop_reason:
        print(f'※ {stop_reason} — 여기까지의 결과만 저장됨')
    print(f'저장: {os.path.abspath(out)}')


if __name__ == '__main__':
    parser_arg = argparse.ArgumentParser()
    parser_arg.add_argument('--ip', required=True, help='조회할 방화벽 IP (DB 에 등록된 Palo Alto, HA 피어 IP 도 가능)')
    parser_arg.add_argument('--file', required=True, help='조회 대상 IP 목록 파일 (한 줄에 하나)')
    parser_arg.add_argument('--out', default=None, help='xlsx 저장 경로 (기본: backend/exports/)')
    parser_arg.add_argument('--delay', type=float, default=1.0, help='조회 간격 초 (기본 1)')
    parser_arg.add_argument('--vsys', default=None, help='조회할 vsys (미지정 시 장비 기본)')
    args = parser_arg.parse_args()
    asyncio.run(main(args.ip, args.file, args.out, args.delay, args.vsys))
