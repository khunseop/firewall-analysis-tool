import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))

from paloalto_vuln_check import (
    build_frames,
    parse_admins,
    parse_auth_profiles,
    parse_password_complexity,
    parse_password_profiles,
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
<entry name="admin"><phash>$1$abc</phash><password-profile>pw90</password-profile><permissions><role-based><superuser>yes</superuser></role-based></permissions></entry>
<entry name="ops"><authentication-profile>radius-mfa</authentication-profile>
<permissions><role-based><custom><profile>readonly-x</profile></custom></role-based></permissions></entry>
<entry name="keyuser"><public-key>c3No</public-key><authentication-profile>local-nomfa</authentication-profile>
<permissions><role-based><deviceadmin><entry name="localhost.localdomain"/></deviceadmin></role-based></permissions></entry>
<entry name="certuser"><client-certificate-only>yes</client-certificate-only></entry>
<entry name="ghost"><authentication-profile>missing</authentication-profile></entry>
</users></result></response>"""

PERMIT_XML = """<response status="success"><result><permitted-ip>
<entry name="10.0.0.0/24"><description>본사 관리망</description></entry><entry name="192.168.1.5"/></permitted-ip></result></response>"""

PWPROF_XML = """<response status="success"><result><password-profile>
<entry name="pw90"><password-change><expire-in-days>90</expire-in-days><expiration-warning-period>7</expiration-warning-period></password-change>
<password-history-count>5</password-history-count></entry><entry name="empty"/></password-profile></result></response>"""

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
    assert parse_permitted_ips(PERMIT_XML) == [{'허용 IP': '10.0.0.0/24', '설명': '본사 관리망'}, {'허용 IP': '192.168.1.5', '설명': ''}]
    assert parse_permitted_ips(EMPTY_XML) == []
    assert parse_admins(EMPTY_XML, {}) == []


def _result(device, role, host, data=None, item_errors=None, error=''):
    return {'device': device, 'role': role, 'host': host, 'data': data or {},
            'item_errors': item_errors or {}, 'error': error}


def test_build_frames_flags_open_access_and_failure():
    ok = _result('fw1', '주 장비', '1.1.1.1', {
        'admin': parse_admins(USERS_XML, parse_auth_profiles(AUTH_XML)), 'permitted_ip': []})
    bad = _result('fw2', 'HA 피어', '2.2.2.2', error='timeout')
    frames = build_frames([ok, bad])
    s = frames['요약']
    assert s.loc[0, '허용 IP 미설정(전체 허용)'] == 'Y'
    assert s.loc[0, 'MFA 미사용 계정 수'] == 4
    assert s.loc[1, '수집 결과'] == '실패'
    assert len(frames['계정']) == 5


def test_build_frames_partial_failure_keeps_other_items():
    r = _result('fw1', '주 장비', '1.1.1.1',
                {'permitted_ip': [{'허용 IP': '1.1.1.1', '설명': ''}]},
                item_errors={'password_complexity': 'RuntimeError: API 오류'})
    frames = build_frames([r])
    assert frames['요약'].loc[0, '수집 결과'] == '부분 실패'
    assert 'password_complexity' in frames['요약'].loc[0, '실패 사유']
    assert frames['요약'].loc[0, '허용 IP 수'] == 1
    assert frames['요약'].loc[0, '관리자 수'] == ''
    assert len(frames['허용IP']) == 1
    assert frames['패스워드복잡도'].empty


COMPLEX_XML = """<response status="success"><result><password-complexity><enabled>yes</enabled>
<minimum-length>12</minimum-length><minimum-uppercase-letters>1</minimum-uppercase-letters>
<block-username-inclusion>yes</block-username-inclusion></password-complexity></result></response>"""


def test_parse_password_complexity():
    assert parse_password_complexity(COMPLEX_XML) == [{
        'enabled': 'yes', 'minimum-length': '12',
        'minimum-uppercase-letters': '1', 'block-username-inclusion': 'yes'}]
    assert parse_password_complexity(EMPTY_XML) == []


def test_parse_password_profiles_flattens_all_fields():
    rows = parse_password_profiles(PWPROF_XML)
    assert rows[0] == {'프로파일': 'pw90', 'password-change/expire-in-days': '90',
                       'password-change/expiration-warning-period': '7', 'password-history-count': '5'}
    assert rows[1] == {'프로파일': 'empty'}
    assert parse_password_profiles(EMPTY_XML) == []
    admins = {a['계정']: a for a in parse_admins(USERS_XML, {})}
    assert admins['admin']['패스워드 프로파일'] == 'pw90'
