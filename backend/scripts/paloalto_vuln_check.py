"""
임시 스크립트: Palo Alto 전 장비의 보안 설정 현황 수집 (취약점 점검용).

- 장비에서 XML API(running config)로 실시간 조회하며 DB에는 아무것도 저장하지 않는다.
- 장비 로컬 설정만 본다 (Panorama 푸시 설정은 제외). ha_peer_ip 가 있는 장비는 피어도 각각 수집한다.
- 결과는 xlsx: `요약` 시트 + 점검 항목(ITEMS)별 시트.

점검 항목 (ITEMS)
  admin               관리자 계정 (비밀번호 해시 값은 출력하지 않고 설정 여부만)
  permitted_ip        장비 관리 접속 허용 IP + 설명 (비어 있으면 전체 허용)
  password_profile    패스워드 프로파일 전체 설정
  password_complexity Minimum Password Complexity (Device > Setup > Management)
  auth_profile        (시트 없음) 계정이 참조하는 인증 프로파일의 allow-list / MFA 계산용
- MFA 는 계정이 아니라 인증 프로파일에 설정되므로 "계정 → 인증 프로파일 → multi-factor-auth" 로 계산한다.
  (설정상 사용 여부이며 MFA 서버의 실제 동작 여부는 확인하지 않는다)

점검 항목 추가 방법
  1) parse_xxx(xml_text, ctx) -> list[dict] 파서 작성 (행 1개 = dict 1개. 설정 트리를 그대로 담을 때는 _flatten 사용)
  2) ITEMS 에 Item(key, sheet, xpath, parse) 한 줄 추가 (다른 항목 결과가 필요하면 ITEMS 에서 그 항목 뒤에 두고 ctx[key] 로 참조)
  항목 하나가 실패해도 나머지는 계속 수집되며, 요약 시트에 '부분 실패'와 사유가 남는다.

실행 (프로젝트 루트에서):
    .venv/bin/python backend/scripts/paloalto_vuln_check.py [--device-id 1] [--out out.xlsx] [--workers 8]
"""
import argparse
import asyncio
import os
import sys
import xml.etree.ElementTree as ET
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pandas as pd
from sqlalchemy import select

from app.db.session import SessionLocal
from app.models import Device
from app.services.sync.collector import create_collector_from_device

DEVICE_XPATH = "/config/devices/entry[@name='localhost.localdomain']"

# 인증 프로파일 method 하위 태그 → 표시명
_AUTH_METHODS = {
    'local-database': 'local',
    'radius': 'radius',
    'ldap': 'ldap',
    'kerberos': 'kerberos',
    'tacacs-plus': 'tacacs+',
    'saml-idp': 'saml',
    'cloud': 'cloud',
}


# ---------------------------------------------------------------- XML 헬퍼

def _members(elem) -> list[str]:
    if elem is None:
        return []
    return [m.text for m in elem.findall('member') if m.text]


def _yes(elem) -> bool:
    return elem is not None and (elem.text or '').strip().lower() == 'yes'


def _result(xml_text: str, tag: str):
    """`/response/result/<tag>` 요소. 해당 설정이 없으면 None."""
    return ET.fromstring(xml_text).find(f'./result/{tag}')


def _entries(xml_text: str, tag: str) -> list[ET.Element]:
    container = _result(xml_text, tag)
    return [] if container is None else container.findall('entry')


def _flatten(elem: ET.Element) -> dict[str, str]:
    """요소 하위의 모든 말단 값을 `경로/태그 → 값` 으로 펼친다 (버전별 필드 차이에 대응)."""
    row = {}
    stack = [(c, c.tag) for c in elem]
    while stack:
        node, path = stack.pop(0)
        children = list(node)
        if children:
            stack = [(c, f'{path}/{c.tag}') for c in children] + stack
        else:
            row[path] = (node.text or '').strip()
    return row


# ---------------------------------------------------------------- 파서

def parse_permitted_ips(xml_text: str, ctx: dict | None = None) -> list[dict]:
    return [{'허용 IP': e.get('name'), '설명': (e.findtext('description') or '').strip()}
            for e in _entries(xml_text, 'permitted-ip') if e.get('name')]


def parse_password_profiles(xml_text: str, ctx: dict | None = None) -> list[dict]:
    return [{'프로파일': e.get('name'), **_flatten(e)} for e in _entries(xml_text, 'password-profile')]


def parse_password_complexity(xml_text: str, ctx: dict | None = None) -> list[dict]:
    elem = _result(xml_text, 'password-complexity')
    return [] if elem is None else [_flatten(elem)]


def parse_auth_profiles(xml_text: str, ctx: dict | None = None) -> dict[str, dict]:
    profiles = {}
    for e in _entries(xml_text, 'authentication-profile'):
        method_elem = e.find('method')
        method = ''
        if method_elem is not None:
            method = ','.join(_AUTH_METHODS.get(c.tag, c.tag) for c in method_elem)
        mfa = e.find('multi-factor-auth')
        profiles[e.get('name')] = {
            'method': method,
            'allow_list': _members(e.find('allow-list')),
            'mfa_enabled': mfa is not None and _yes(mfa.find('mfa-enable')),
            'mfa_factors': _members(mfa.find('factors')) if mfa is not None else [],
        }
    return profiles


def _role_text(perm) -> str:
    """permissions/role-based 아래: superuser·deviceadmin 등은 태그명, custom 은 프로파일명."""
    if perm is None or perm.find('role-based') is None:
        return ''
    roles = []
    for r in perm.find('role-based'):
        if r.tag == 'custom':
            roles.append(f"custom:{(r.findtext('profile') or '').strip()}")
        elif r.tag in ('vsysreader', 'vsysadmin', 'devicereader', 'deviceadmin'):
            roles.append(r.tag)
        elif _yes(r):
            roles.append(r.tag)
    return ','.join(roles)


def parse_admins(xml_text: str, profiles: dict[str, dict]) -> list[dict]:
    admins = []
    for e in _entries(xml_text, 'users'):
        profile_name = (e.findtext('authentication-profile') or '').strip()
        profile = profiles.get(profile_name) if profile_name else None
        has_pubkey = e.find('public-key') is not None
        has_hash = e.find('phash') is not None
        cert_only = _yes(e.find('client-certificate-only'))

        methods = []
        if cert_only:
            methods.append('certificate')
        if has_pubkey:
            methods.append('public-key')
        if profile_name:
            methods.append(f"profile({profile['method']})" if profile else f"profile({profile_name}: 설정 없음)")
        elif has_hash:
            methods.append('local-password')

        admins.append({
            '계정': e.get('name'),
            '역할': _role_text(e.find('permissions')),
            '인증 방식': ' + '.join(methods),
            '인증 프로파일': profile_name,
            '비밀번호 설정': 'Y' if has_hash else 'N',
            '패스워드 프로파일': (e.findtext('password-profile') or '').strip(),
            '프로파일 allow-list': ','.join(profile['allow_list']) if profile else '',
            'MFA 사용': 'Y' if profile and profile['mfa_enabled'] else 'N',
            'MFA 요소': ','.join(profile['mfa_factors']) if profile else '',
        })
    return admins


# ---------------------------------------------------------------- 점검 항목 등록

@dataclass(frozen=True)
class Item:
    key: str                                    # 결과(data)·ctx 키
    sheet: str | None                           # None 이면 시트를 만들지 않음 (다른 항목의 입력용)
    xpath: str
    parse: Callable[[str, dict], object]        # (xml_text, 앞선 항목 결과 ctx) → 시트용 list[dict]


ITEMS = [
    Item('auth_profile', None, '/config/shared/authentication-profile', parse_auth_profiles),
    Item('admin', '계정', '/config/mgt-config/users',
         lambda xml, ctx: parse_admins(xml, ctx.get('auth_profile', {}))),
    Item('permitted_ip', '허용IP', f'{DEVICE_XPATH}/deviceconfig/system/permitted-ip', parse_permitted_ips),
    Item('password_profile', '패스워드프로파일', '/config/shared/password-profile', parse_password_profiles),
    Item('password_complexity', '패스워드복잡도',
         f'{DEVICE_XPATH}/deviceconfig/setting/management/password-complexity', parse_password_complexity),
]


# ---------------------------------------------------------------- 수집

def _show(fw, xpath: str) -> str:
    params = (('key', fw.api_key), ('type', 'config'), ('action', 'show'), ('xpath', xpath))
    text = fw.get_api_data(params, timeout=30).text
    root = ET.fromstring(text)
    if root.get('status') == 'error':
        raise RuntimeError(f"API 오류(code={root.get('code')}): {''.join(root.itertext()).strip()}")
    return text


def collect_one(label: str, device, use_ha_ip: bool) -> dict:
    """장비 1대(주 장비 또는 HA 피어) 수집. 접속 실패는 error, 항목별 실패는 item_errors 에 담는다."""
    host = device.ha_peer_ip if use_ha_ip else device.ip_address
    result = {'device': device.name, 'role': label, 'host': host, 'data': {}, 'item_errors': {}, 'error': ''}
    try:
        fw = create_collector_from_device(device, use_ha_ip=use_ha_ip)
        if not fw.connect():
            raise RuntimeError('접속/인증 실패')
        try:
            for item in ITEMS:
                try:
                    result['data'][item.key] = item.parse(_show(fw, item.xpath), result['data'])
                except Exception as e:
                    result['item_errors'][item.key] = f"{type(e).__name__}: {e}"
        finally:
            fw.disconnect()
    except Exception as e:
        result['error'] = f"{type(e).__name__}: {e}"
    return result


# ---------------------------------------------------------------- 결과 정리

def _summary_row(base: dict, r: dict) -> dict:
    data, errs = r['data'], r['item_errors']
    if r['error']:
        status, reason = '실패', r['error']
    elif errs:
        status, reason = '부분 실패', '; '.join(f'{k}: {v}' for k, v in errs.items())
    else:
        status, reason = '성공', ''

    def val(key, fn):  # 해당 항목이 수집된 경우에만 값 계산
        return fn(data[key]) if key in data else ''

    return {
        **base,
        '수집 결과': status,
        '실패 사유': reason,
        '관리자 수': val('admin', len),
        'MFA 미사용 계정 수': val('admin', lambda rows: sum(a['MFA 사용'] == 'N' for a in rows)),
        '허용 IP 수': val('permitted_ip', len),
        '허용 IP 미설정(전체 허용)': val('permitted_ip', lambda rows: 'Y' if not rows else 'N'),
    }


def build_frames(results: list[dict]) -> dict[str, pd.DataFrame]:
    rows = {item.sheet: [] for item in ITEMS if item.sheet}
    summary_rows = []
    for r in results:
        base = {'장비': r['device'], '구분': r['role'], '접속 IP': r['host']}
        for item in ITEMS:
            if item.sheet:
                rows[item.sheet] += [{**base, **row} for row in r['data'].get(item.key, [])]
        summary_rows.append(_summary_row(base, r))
    return {'요약': pd.DataFrame(summary_rows), **{sheet: pd.DataFrame(v) for sheet, v in rows.items()}}


async def load_devices(device_id: int | None) -> list[Device]:
    async with SessionLocal() as db:
        stmt = select(Device).where(Device.vendor == 'paloalto').order_by(Device.id)
        if device_id is not None:
            stmt = stmt.where(Device.id == device_id)
        return list((await db.execute(stmt)).scalars().all())


async def main(device_id: int | None, out: str | None, workers: int):
    devices = await load_devices(device_id)
    if not devices:
        print('대상 Palo Alto 장비가 없습니다.')
        return

    jobs = []
    for d in devices:
        jobs.append(('주 장비', d, False))
        if d.ha_peer_ip:
            jobs.append(('HA 피어', d, True))
    print(f'{len(devices)}대 / 수집 대상 {len(jobs)}건 (workers={workers})')

    loop = asyncio.get_running_loop()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [loop.run_in_executor(pool, collect_one, *job) for job in jobs]
        results = []
        for fut in asyncio.as_completed(futures):
            r = await fut
            status = '실패' if r['error'] else ('부분 실패' if r['item_errors'] else '성공')
            print(f"  [{status}] {r['device']} ({r['role']}, {r['host']}) {r['error'] or ''}")
            for k, v in r['item_errors'].items():
                print(f"      - {k}: {v}")
            results.append(r)
    order = {(d.name, label): i for i, (label, d, _) in enumerate(jobs)}
    results.sort(key=lambda r: order[(r['device'], r['role'])])

    if not out:
        out_dir = os.path.join(os.path.dirname(__file__), '..', 'exports')
        os.makedirs(out_dir, exist_ok=True)
        out = os.path.join(out_dir, f"paloalto_vuln_check_{datetime.now():%Y%m%d_%H%M%S}.xlsx")
    with pd.ExcelWriter(out, engine='openpyxl') as writer:
        for sheet, df in build_frames(results).items():
            df.to_excel(writer, sheet_name=sheet, index=False)
    print(f'저장: {os.path.abspath(out)}')


if __name__ == '__main__':
    parser_arg = argparse.ArgumentParser()
    parser_arg.add_argument('--device-id', type=int, default=None, help='특정 장비만 수집 (미지정 시 Palo Alto 전체)')
    parser_arg.add_argument('--out', type=str, default=None, help='xlsx 저장 경로 (기본: backend/exports/)')
    parser_arg.add_argument('--workers', type=int, default=8, help='병렬 수집 스레드 수 (기본 8)')
    args = parser_arg.parse_args()
    asyncio.run(main(args.device_id, args.out, args.workers))
