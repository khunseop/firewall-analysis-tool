import os
import sys
import types

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))

import paloalto_ip_user_map as m

BLOCK_XML = """<response status="success"><result>IP address: 10.1.1.5 (vsys1)
User: CORP\\hong.gildong
From: UserIDAgent
Idle Timeout: 2400s
Max Timeout: 3600s
</result></response>"""

TABLE_XML = """<response status="success"><result>
IP              Vsys   From    User                    IdleTimeout(s) MaxTimeout(s)
--------------- ------ ------- ----------------------- -------------- -------------
10.1.1.5        vsys1  AD      CORP\\hong.gildong       2300           3500
10.1.1.6        vsys1  UIA     LAB\\kim                 100            200
Total: 2 users
</result></response>"""

ENTRY_XML = """<response status="success"><result>
<entry><ip>10.1.1.5</ip><vsys>vsys1</vsys><type>AD</type><user>CORP\\hong.gildong</user><idle_timeout>2400</idle_timeout></entry>
</result></response>"""

EMPTY_XML = '<response status="success"><result/></response>'


def test_split_user():
    assert m.split_user('CORP\\hong') == ('CORP', 'hong')
    assert m.split_user('hong') == ('', 'hong')
    assert m.split_user('a\\b\\c') == ('a', 'b\\c')


def test_parse_block():
    rows = m.parse_mapping(BLOCK_XML)
    assert rows == [{'ip': '10.1.1.5', 'vsys': 'vsys1', 'user': 'CORP\\hong.gildong', 'From': 'UserIDAgent',
                     'Idle Timeout': '2400s', 'Max Timeout': '3600s'}]


def test_parse_table():
    rows = m.parse_mapping(TABLE_XML)
    assert [(r['ip'], r['user']) for r in rows] == [('10.1.1.5', 'CORP\\hong.gildong'), ('10.1.1.6', 'LAB\\kim')]
    assert rows[1]['from'] == 'UIA'


def test_parse_entry_and_empty():
    rows = m.parse_mapping(ENTRY_XML)
    assert rows[0]['user'] == 'CORP\\hong.gildong' and rows[0]['type'] == 'AD'
    assert m.parse_mapping(EMPTY_XML) == []


def test_to_output_rows():
    out = m.to_output_rows('10.1.1.5', m.parse_mapping(BLOCK_XML))
    assert out[0]['도메인'] == 'CORP' and out[0]['사용자명'] == 'hong.gildong' and out[0]['상태'] == '매핑됨'
    assert m.to_output_rows('9.9.9.9', []) == [{'조회 IP': '9.9.9.9', '상태': '매핑 없음'}]


def test_read_ips(tmp_path):
    f = tmp_path / 'ips.txt'
    f.write_text('10.0.0.1\n\n# 주석\n10.0.0.2 # 뒤 주석\n10.0.0.1\nnot-an-ip\n', encoding='utf-8')
    assert m.read_ips(str(f)) == (['10.0.0.1', '10.0.0.2'], ['not-an-ip'])


class _FW:
    api_key = 'k'

    def __init__(self, fail_on=()):
        self.fail_on, self.calls = set(fail_on), []

    def get_api_data(self, params, timeout=0):
        cmd = dict(params)['cmd']
        ip = cmd.split('<ip>')[1].split('</ip>')[0]
        self.calls.append(ip)
        if ip in self.fail_on:
            raise RuntimeError('boom')
        xml = BLOCK_XML if ip == '10.1.1.5' else EMPTY_XML
        return types.SimpleNamespace(text=xml)


def test_run_queries_continues_after_single_error(monkeypatch):
    monkeypatch.setattr(m.time, 'sleep', lambda s: None)
    rows = []
    stop = m.run_queries(_FW(fail_on={'10.1.1.9'}), ['10.1.1.5', '10.1.1.9', '10.1.1.7'], 1, None, rows)
    assert stop == ''
    assert [r['상태'] for r in rows] == ['매핑됨', '오류', '매핑 없음']


def test_run_queries_aborts_after_consecutive_errors(monkeypatch):
    monkeypatch.setattr(m.time, 'sleep', lambda s: None)
    ips = [f'10.0.0.{i}' for i in range(1, 30)]
    fw, rows = _FW(fail_on=set(ips)), []
    stop = m.run_queries(fw, ips, 0, None, rows)
    assert '연속' in stop and len(fw.calls) == m.MAX_CONSECUTIVE_ERRORS
