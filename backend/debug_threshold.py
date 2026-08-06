#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Palo Alto 리소스 한도(threshold) 자동수집이 동작하지 않는 원인을 진단하는 스크립트.

Devices 동기화 시 자동 실행되는 것과 동일한 코드
(backend/app/services/firewall/vendors/paloalto.py의 PaloAltoAPI.export_resource_limits)를
그대로 호출하여, 어떤 값이 나오는지 / 왜 비어있는지를 직접 확인한다.

사용법:
  python backend/debug_threshold.py <hostname> <username>

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
    parser = argparse.ArgumentParser(description="Palo Alto 리소스 한도(threshold) 수집 진단")
    parser.add_argument("hostname")
    parser.add_argument("username")
    args = parser.parse_args()

    logging.basicConfig(level=logging.DEBUG, format="%(levelname)s %(name)s: %(message)s")

    password = getpass.getpass(f"{args.username}@{args.hostname} 비밀번호: ")
    api = PaloAltoAPI(args.hostname, args.username, password)

    print("\n[1] export_resource_limits() 호출 (앱과 완전히 동일한 코드 경로)")
    try:
        limits = api.export_resource_limits()
        print(f"    -> 결과: {limits}")
        if not limits:
            print("    -> 비어있음. CLI 출력 포맷이 예상과 다르거나(PAN-OS 버전 차이),")
            print("       SSH 계정 권한 부족으로 명령 결과가 비어있을 가능성이 있다.")
            print("       (앱은 이 경우 예외 없이 조용히 threshold 갱신을 건너뛴다)")
    except Exception as e:
        print(f"    -> [예외 발생] {type(e).__name__}: {e}")

    print("\n[2] 참고: 원본 SSH 출력 직접 확인 (인터랙티브 쉘 + pager off, 앱과 동일 방식)")
    try:
        import time
        import paramiko
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh.connect(
            args.hostname, port=22,
            username=args.username, password=password,
            timeout=20, look_for_keys=False, allow_agent=False,
        )
        channel = ssh.invoke_shell()

        def read_until_prompt(timeout: int = 10) -> str:
            output = ""
            start_time = time.time()
            while True:
                if channel.recv_ready():
                    output += channel.recv(65535).decode('utf-8', errors='ignore')
                    if output.strip().endswith(('>', '#')):
                        return output
                if time.time() - start_time > timeout:
                    raise TimeoutError(f"쉘 프롬프트 대기 시간 초과. 현재 출력:\n{output}")
                time.sleep(0.5)

        read_until_prompt(timeout=20)
        channel.send("set cli pager off\n")
        read_until_prompt()

        channel.send("show system state filter cfg.general.max*\n")
        output = read_until_prompt(timeout=30)
        print("    --- show system state filter cfg.general.max* ---")
        print(output if output.strip() else "(빈 출력)")

        print("\n[3] 참고: 필터 없는 전체 cfg.general 에서 'max' 포함 라인만 추출 (실제 키 이름 확인용)")
        channel.send("show system state filter cfg.general\n")
        output2 = read_until_prompt(timeout=30)
        found = [l.strip() for l in output2.splitlines() if 'max' in l.lower()]
        print('\n'.join(found) if found else "    (max 포함 라인 없음)")

        ssh.close()
    except Exception as e:
        print(f"    -> [SSH 확인 중 오류] {type(e).__name__}: {e}")

    print("\n완료.")


if __name__ == "__main__":
    main()
