#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Devices 페이지 "직접 추출 > 사용이력"이 제대로 동작하지 않는 원인을 진단하는 스크립트.

직접추출 경로(backend/app/services/export/tasks.py의 _collect_hit_dates)가 실제로
호출하는 것과 동일한 코드
(backend/app/services/firewall/vendors/paloalto.py의 PaloAltoAPI.export_last_hit_date /
export_last_hit_date_ssh)를 그대로 호출한다.

주의: 직접추출 경로는 vsys를 지정하지 않고 호출하므로 내부적으로 'vsys1' 하나만 조회한다
(정규 동기화 파이프라인은 실제 정책에 존재하는 vsys 목록을 넘겨 멀티 vsys를 처리하지만,
직접추출은 그렇지 않다). 장비에 vsys1 외 다른 VSYS가 있다면 이것이 "일부만 추출되거나
비어있는" 원인일 수 있다 — --vsys 옵션으로 비교해볼 수 있다.

사용법:
  python backend/debug_hit_dates.py <hostname> <username> [--ssh] [--vsys vsys1,vsys2] [--timeout 600]

비밀번호는 실행 시 안전하게 입력받는다.
"""
import argparse
import getpass
import logging
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from backend.app.services.firewall.vendors.paloalto import PaloAltoAPI  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description="Palo Alto 사용이력(last_hit_date) 직접추출 진단")
    parser.add_argument("hostname")
    parser.add_argument("username")
    parser.add_argument("--ssh", action="store_true", help="SSH 기반 추출 사용 (기본은 XML API)")
    parser.add_argument("--vsys", default=None, help="쉼표로 구분된 VSYS 이름. 생략 시 직접추출과 동일하게 vsys1만 조회")
    parser.add_argument("--timeout", type=int, default=600, help="SSH 모드 명령 타임아웃(초, 기본 600)")
    args = parser.parse_args()

    logging.basicConfig(level=logging.DEBUG, format="%(levelname)s %(name)s: %(message)s")

    password = getpass.getpass(f"{args.username}@{args.hostname} 비밀번호: ")
    vsys_list = [v.strip() for v in args.vsys.split(",")] if args.vsys else None

    api = PaloAltoAPI(args.hostname, args.username, password)

    if not args.ssh:
        print("\n[1] connect() (API 모드는 사전에 API 키 발급 필요)")
        if not api.connect():
            print("    -> [실패] 연결 실패 (API 키 발급 실패). 계정/비밀번호 또는 API 접근 권한을 확인하라.")
            sys.exit(1)
        print("    -> 성공")

    mode = "SSH" if args.ssh else "API"
    vsys_desc = ", ".join(vsys_list) if vsys_list else "지정 안 함 -> 기본값 vsys1만 (직접추출과 동일)"
    print(f"\n[2] {mode} 모드로 히트 정보 조회 (vsys: {vsys_desc})")

    try:
        if args.ssh:
            df = api.export_last_hit_date_ssh(vsys=vsys_list, timeout=args.timeout)
        else:
            df = api.export_last_hit_date(vsys=vsys_list)
    except Exception as e:
        print(f"    -> [예외 발생] {type(e).__name__}: {e}")
        sys.exit(1)
    finally:
        api.disconnect()

    print(f"\n[3] 결과: {len(df)}건")
    if df.empty:
        print("    -> 비어있음. 대상 VSYS에 정책이 없거나, 파싱 실패, 인증/권한 문제일 수 있다.")
    else:
        print(df.head(20).to_string(index=False))
        if "vsys" in df.columns:
            print(f"\n    VSYS별 건수:\n{df['vsys'].value_counts().to_string()}")

    if not vsys_list:
        print("\n[안내] 이 실행은 직접추출과 동일하게 vsys1만 조회했다.")
        print("       장비에 vsys1 외 다른 VSYS가 있다면 --vsys vsys1,vsys2,... 로 재실행해서")
        print("       사용이력이 일부 VSYS에서만 누락되는지 비교해봐라.")


if __name__ == "__main__":
    main()
