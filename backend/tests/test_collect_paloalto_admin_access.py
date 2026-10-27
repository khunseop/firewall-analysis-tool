import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))

from collect_paloalto_admin_access import (
    build_frames,
    parse_admins,
    parse_auth_profiles,
    parse_permitted_ips,
)

AUTH_XML = """<response status="success"><result><authentication-profile>
<entry name="radius-mfa"><method><radius><server-profile>rad1</server-profile></radius></method>
<allow-list><member>all</member></allow-list>
<multi-factor-auth><mfa-enable>yes</mfa-enable><factors><member>duo</member></factors></multi-factor-auth></entry>
<entry name="local-nomfa"><method><local-database/></method><allow-list><member>admins</member></allow-list>
<multi-factor-auth><mfa-enable>no</mfa-enable></multi-factor-auth></entry>
</authentication-profile></result></response>"""

USERS_XML = """<response status="success"><result><users>
<entry name="admin"><phash>$1$abc</phash><permissions><role-based><superuser>yes</superuser></role-based></permissions></entry>
<entry name="ops"><authentication-profile>radius-mfa</authentication-profile>
<permissions><role-based><custom><profile>readonly-x</profile></custom></role-based></permissions></entry>
<entry name="keyuser"><public-key>c3No</public-key><authentication-profile>local-nomfa</authentication-profile>
<permissions><role-based><deviceadmin><entry name="localhost.localdomain"/></deviceadmin></role-based></permissions></entry>
<entry name="certuser"><client-certificate-only>yes</client-certificate-only></entry>
<entry name="ghost"><authentication-profile>missing</authentication-profile></entry>
</users></result></response>"""

PERMIT_XML = """<response status="success"><result><permitted-ip>
<entry name="10.0.0.0/24"/><entry name="192.168.1.5"/></permitted-ip></result></response>"""

EMPTY_XML = '<response status="success" code="7"><result/></response>'


def test_parse_auth_profiles():
    p = parse_auth_profiles(AUTH_XML)
    assert p['radius-mfa'] == {'method': 'radius', 'allow_list': ['all'], 'mfa_enabled': True, 'mfa_factors': ['duo']}
    assert p['local-nomfa']['method'] == 'local'
    assert p['local-nomfa']['mfa_enabled'] is False


def test_parse_admins_mfa_and_methods():
    admins = {a['계정']: a for a in parse_admins(USERS_XML, parse_auth_profiles(AUTH_XML))}
    assert admins['admin']['MFA 사용'] == 'N'
    assert admins['admin']['인증 방식'] == 'local-password'
    assert admins['admin']['비밀번호 설정'] == 'Y'
    assert admins['admin']['역할'] == 'superuser'
    assert admins['ops']['MFA 사용'] == 'Y'
    assert admins['ops']['MFA 요소'] == 'duo'
    assert admins['ops']['역할'] == 'custom:readonly-x'
    assert admins['keyuser']['인증 방식'] == 'public-key + profile(local)'
    assert admins['keyuser']['역할'] == 'deviceadmin'
    assert admins['certuser']['인증 방식'] == 'certificate'
    assert 'missing' in admins['ghost']['인증 방식']
    assert admins['ghost']['MFA 사용'] == 'N'


def test_parse_permitted_ips_and_empty():
    assert parse_permitted_ips(PERMIT_XML) == ['10.0.0.0/24', '192.168.1.5']
    assert parse_permitted_ips(EMPTY_XML) == []
    assert parse_admins(EMPTY_XML, {}) == []


def test_build_frames_flags_open_access_and_failure():
    ok = {'device': 'fw1', 'role': '주 장비', 'host': '1.1.1.1', 'error': '',
          'admins': parse_admins(USERS_XML, parse_auth_profiles(AUTH_XML)), 'permitted_ips': []}
    bad = {'device': 'fw2', 'role': 'HA 피어', 'host': '2.2.2.2', 'error': 'timeout',
           'admins': [], 'permitted_ips': []}
    frames = build_frames([ok, bad])
    s = frames['요약']
    assert s.loc[0, '허용 IP 미설정(전체 허용)'] == 'Y'
    assert s.loc[0, 'MFA 미사용 계정 수'] == 4
    assert s.loc[1, '수집 결과'] == '실패'
    assert len(frames['계정']) == 5
