"""
임시 스크립트: Palo Alto 전 장비의 관리자 계정 / 관리 접속 허용 IP / MFA 설정 현황 수집 (취약점 점검용).

- 장비에서 XML API(running config)로 실시간 조회하며 DB에는 아무것도 저장하지 않는다.
- 수집 항목 (장비 로컬 설정만 — Panorama 푸시 설정은 보지 않음)
  * /config/mgt-config/users                 관리자 계정 (비밀번호 해시 값은 출력하지 않고 설정 여부만)
  * .../deviceconfig/system/permitted-ip     장비 관리 접속 허용 IP (비어 있으면 전체 허용)
  * /config/shared/authentication-profile    계정이 참조하는 인증 프로파일의 allow-list / MFA 설정
- MFA 는 계정이 아니라 인증 프로파일에 설정되므로 "계정 → 인증 프로파일 → multi-factor-auth" 로 계산한다.
  (설정상 사용 여부이며 MFA 서버의 실제 동작 여부는 확인하지 않는다)
- ha_peer_ip 가 있는 장비는 피어도 각각 수집한다. 결과는 xlsx (계정 / 허용IP / 요약 시트).

실행 (프로젝트 루트에서):
    .venv/bin/python backend/scripts/collect_paloalto_admin_access.py [--device-id 1] [--out out.xlsx] [--workers 8]
"""
import argparse
import asyncio
import os
import sys
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pandas as pd
from sqlalchemy import select

from app.db.session import SessionLocal
from app.models import Device
from app.services.sync.collector import create_collector_from_device

DEVICE_XPATH = "/config/devices/entry[@name='localhost.localdomain']"
XPATH_USERS = "/config/mgt-config/users"
XPATH_PERMITTED_IP = f"{DEVICE_XPATH}/deviceconfig/system/permitted-ip"
XPATH_AUTH_PROFILE = "/config/shared/authentication-profile"

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


def _members(elem) -> list[str]:
    if elem is None:
        return []
    return [m.text for m in elem.findall('member') if m.text]


def _yes(elem) -> bool:
    return elem is not None and (elem.text or '').strip().lower() == 'yes'


def _entries(xml_text: str, tag: str) -> list[ET.Element]:
    """`/response/result/<tag>/entry` 목록. 해당 설정이 없으면 빈 리스트."""
    root = ET.fromstring(xml_text)
    container = root.find(f'./result/{tag}')
    return [] if container is None else container.findall('entry')


def parse_permitted_ips(xml_text: str) -> list[str]:
    return [e.get('name') for e in _entries(xml_text, 'permitted-ip') if e.get('name')]


def parse_auth_profiles(xml_text: str) -> dict[str, dict]:
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
        elif r.tag == 'vsysreader' or r.tag == 'vsysadmin' or r.tag == 'devicereader' or r.tag == 'deviceadmin':
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
            '프로파일 allow-list': ','.join(profile['allow_list']) if profile else '',
            'MFA 사용': 'Y' if profile and profile['mfa_enabled'] else 'N',
            'MFA 요소': ','.join(profile['mfa_factors']) if profile else '',
        })
    return admins


def _show(fw, xpath: str) -> str:
    params = (('key', fw.api_key), ('type', 'config'), ('action', 'show'), ('xpath', xpath))
    return fw.get_api_data(params, timeout=30).text


def collect_one(label: str, device, use_ha_ip: bool) -> dict:
    """장비 1대(주 장비 또는 HA 피어) 수집. 실패해도 예외 대신 error 를 담아 반환."""
    host = device.ha_peer_ip if use_ha_ip else device.ip_address
    result = {'device': device.name, 'role': label, 'host': host,
              'admins': [], 'permitted_ips': [], 'error': ''}
    try:
        fw = create_collector_from_device(device, use_ha_ip=use_ha_ip)
        if not fw.connect():
            raise RuntimeError('접속/인증 실패')
        try:
            profiles = parse_auth_profiles(_show(fw, XPATH_AUTH_PROFILE))
            result['admins'] = parse_admins(_show(fw, XPATH_USERS), profiles)
            result['permitted_ips'] = parse_permitted_ips(_show(fw, XPATH_PERMITTED_IP))
        finally:
            fw.disconnect()
    except Exception as e:
        result['error'] = f"{type(e).__name__}: {e}"
    return result


def build_frames(results: list[dict]) -> dict[str, pd.DataFrame]:
    admin_rows, ip_rows, summary_rows = [], [], []
    for r in results:
        base = {'장비': r['device'], '구분': r['role'], '접속 IP': r['host']}
        admin_rows += [{**base, **a} for a in r['admins']]
        ip_rows += [{**base, '허용 IP': ip} for ip in r['permitted_ips']]
        failed = bool(r['error'])
        summary_rows.append({
            **base,
            '수집 결과': '실패' if failed else '성공',
            '실패 사유': r['error'],
            '관리자 수': '' if failed else len(r['admins']),
            'MFA 미사용 계정 수': '' if failed else sum(a['MFA 사용'] == 'N' for a in r['admins']),
            '허용 IP 수': '' if failed else len(r['permitted_ips']),
            '허용 IP 미설정(전체 허용)': '' if failed else ('Y' if not r['permitted_ips'] else 'N'),
        })
    return {
        '요약': pd.DataFrame(summary_rows),
        '계정': pd.DataFrame(admin_rows),
        '허용IP': pd.DataFrame(ip_rows),
    }


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
            print(f"  [{'실패' if r['error'] else '성공'}] {r['device']} ({r['role']}, {r['host']}) {r['error']}")
            results.append(r)
    order = {(d.name, label): i for i, (label, d, _) in enumerate(jobs)}
    results.sort(key=lambda r: order[(r['device'], r['role'])])

    if not out:
        out_dir = os.path.join(os.path.dirname(__file__), '..', 'exports')
        os.makedirs(out_dir, exist_ok=True)
        out = os.path.join(out_dir, f"paloalto_admin_access_{datetime.now():%Y%m%d_%H%M%S}.xlsx")
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
