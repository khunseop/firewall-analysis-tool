#!/usr/bin/env python3
"""Palo Alto 방화벽 다수 장비의 로그를 FTP 백업 서버로 일괄 export 한다.

장비별로 SSH 접속 후 아래 순서로 실행:
  1) set cli pager off
  2) set cli timeout idle never
  3) ftp export log <type> start-time equal <D>@00:00:00 end-time equal <D>@23:59:59 to <id>:<pw>@<server>

사용 예:
  export BACKUP_PW='ftp-password'
  python scripts/pan_log_backup.py -d devices.csv --date 2026/11/12 \
      --server 10.0.0.50 --ftp-user backup

devices.csv (헤더 포함):
  host,username,password
  10.1.1.1,admin,secret
  10.1.1.2,admin,secret

여러 로그 타입: --log-types traffic,threat,system
날짜 미지정 시 어제 날짜. 날짜 범위: --date 2026/11/10 --end-date 2026/11/12 (일 단위로 반복)
"""
import argparse
import csv
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta

import paramiko

PROMPT_RE = re.compile(r"[\w.\-@()]+[>#]\s*$")  # admin@PA-FW01> / admin@PA-FW01#


def read_until_prompt(chan, timeout):
    """프롬프트가 다시 나타날 때까지 출력 수집. (출력, 프롬프트 도달 여부) 반환."""
    buf = ""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if chan.recv_ready():
            buf += chan.recv(65535).decode("utf-8", errors="replace")
            last = buf.rstrip("\r\n ").splitlines()[-1] if buf.strip() else ""
            if PROMPT_RE.search(last + " "):
                return buf, True
        else:
            time.sleep(0.3)
    return buf, False


def run_cmd(chan, cmd, timeout):
    chan.send(cmd + "\n")
    return read_until_prompt(chan, timeout)


def backup_one(dev, jobs, args):
    """한 장비에서 모든 (날짜, 로그타입) 작업 수행. 결과 리스트 반환."""
    host = dev["host"]
    results = []
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(
            host, port=args.port, username=dev["username"], password=dev["password"],
            look_for_keys=False, allow_agent=False, timeout=args.connect_timeout,
        )
        chan = client.invoke_shell(width=250, height=1000)
        out, ok = read_until_prompt(chan, 30)  # 로그인 배너 소비
        if not ok:
            return [(host, "-", "-", False, "로그인 프롬프트 확인 실패")]

        for cmd in ("set cli pager off", "set cli timeout idle never"):
            out, ok = run_cmd(chan, cmd, 15)
            if not ok:
                return [(host, "-", "-", False, f"'{cmd}' 응답 없음")]

        for day, log_type in jobs:
            d = day.strftime("%Y/%m/%d")
            cmd = (
                f"ftp export log {log_type} start-time equal {d}@00:00:00 "
                f"end-time equal {d}@23:59:59 to "
                f"{args.ftp_user}:{args.ftp_pw}@{args.server}"
            )
            out, ok = run_cmd(chan, cmd, args.export_timeout)
            low = out.lower()
            failed = any(k in low for k in ("error", "fail", "invalid syntax", "unknown command"))
            if not ok:
                results.append((host, d, log_type, False, "타임아웃(프롬프트 미복귀)"))
            elif failed:
                tail = " | ".join(l.strip() for l in out.strip().splitlines()[-3:])
                results.append((host, d, log_type, False, tail))
            else:
                results.append((host, d, log_type, True, "OK"))
        chan.send("exit\n")
    except Exception as e:  # 접속/인증 실패 등
        results.append((host, "-", "-", False, f"{type(e).__name__}: {e}"))
    finally:
        client.close()
    return results


def load_devices(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = [r for r in csv.DictReader(f) if r.get("host", "").strip()]
    for r in rows:
        r["host"] = r["host"].strip()
    return rows


def main():
    p = argparse.ArgumentParser(description="Palo Alto 로그 FTP 일괄 백업")
    p.add_argument("-d", "--devices", required=True, help="장비 CSV (host,username,password)")
    p.add_argument("--server", required=True, help="백업(FTP) 서버 주소")
    p.add_argument("--ftp-user", required=True)
    p.add_argument("--ftp-pw", default=os.environ.get("BACKUP_PW"),
                   help="FTP 비밀번호 (미지정 시 환경변수 BACKUP_PW)")
    p.add_argument("--date", help="백업 날짜 YYYY/MM/DD (기본: 어제)")
    p.add_argument("--end-date", help="범위 백업 종료일 (선택)")
    p.add_argument("--log-types", default="traffic", help="쉼표 구분 (기본: traffic)")
    p.add_argument("--port", type=int, default=22)
    p.add_argument("--workers", type=int, default=5, help="동시 처리 장비 수")
    p.add_argument("--connect-timeout", type=int, default=15)
    p.add_argument("--export-timeout", type=int, default=3600, help="export 1건 최대 대기(초)")
    args = p.parse_args()

    if not args.ftp_pw:
        sys.exit("FTP 비밀번호가 없습니다: --ftp-pw 또는 환경변수 BACKUP_PW")

    start = (datetime.strptime(args.date, "%Y/%m/%d") if args.date
             else datetime.now() - timedelta(days=1))
    end = datetime.strptime(args.end_date, "%Y/%m/%d") if args.end_date else start
    if end < start:
        sys.exit("--end-date 가 --date 보다 빠릅니다")
    days = [start + timedelta(days=i) for i in range((end - start).days + 1)]
    types = [t.strip() for t in args.log_types.split(",") if t.strip()]
    jobs = [(d, t) for d in days for t in types]

    devices = load_devices(args.devices)
    print(f"장비 {len(devices)}대 × 작업 {len(jobs)}건 시작 (동시 {args.workers})")

    all_results = []
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(backup_one, d, jobs, args): d["host"] for d in devices}
        for fut in as_completed(futs):
            for host, d, t, ok, msg in fut.result():
                print(f"[{'OK ' if ok else 'FAIL'}] {host:<18} {d:<11} {t:<10} {msg}")
                all_results.append((host, d, t, ok, msg))

    fails = [r for r in all_results if not r[3]]
    print(f"\n완료: 성공 {len(all_results) - len(fails)} / 실패 {len(fails)}")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
