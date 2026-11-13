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

로그 산출물 (기본 ./logs, --log-dir 로 변경):
  logs/pan_backup_YYYYMMDD_HHMMSS.log        시각이 붙은 진행/결과 기록
  logs/pan_backup_YYYYMMDD_HHMMSS_result.csv 작업별 결과 (host,date,log_type,status,message,elapsed_sec)
  logs/raw/YYYYMMDD_HHMMSS/<host>.txt        장비 CLI 응답 원문 (FTP 비밀번호는 *** 마스킹)
"""
import argparse
import csv
import logging
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta

import paramiko

PROMPT_RE = re.compile(r"[\w.\-@()]+[>#]\s*$")  # admin@PA-FW01> / admin@PA-FW01#

log = logging.getLogger("pan_backup")


def read_until_prompt(chan, timeout, raw=None):
    """프롬프트가 다시 나타날 때까지 출력 수집. (출력, 프롬프트 도달 여부) 반환."""
    buf = ""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if chan.recv_ready():
            chunk = chan.recv(65535).decode("utf-8", errors="replace")
            buf += chunk
            if raw:
                raw(chunk)
            last = buf.rstrip("\r\n ").splitlines()[-1] if buf.strip() else ""
            if PROMPT_RE.search(last + " "):
                return buf, True
        else:
            time.sleep(0.3)
    return buf, False


def run_cmd(chan, cmd, timeout, raw=None):
    chan.send(cmd + "\n")
    return read_until_prompt(chan, timeout, raw)


def backup_one(dev, jobs, args, raw_dir):
    """한 장비에서 모든 (날짜, 로그타입) 작업 수행.

    결과 리스트 [(host, date, log_type, ok, message, elapsed_sec)] 반환.
    """
    host = dev["host"]
    results = []
    secret = args.ftp_pw

    def mask(text):
        return text.replace(secret, "***")

    raw_fh = open(os.path.join(raw_dir, f"{host}.txt"), "a", encoding="utf-8")

    def raw(text):
        raw_fh.write(mask(text))
        raw_fh.flush()

    def mark(text):  # 원문 파일 안의 구분선
        raw(f"\n===== [{datetime.now():%H:%M:%S}] {text} =====\n")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    t_dev = time.time()
    try:
        log.info("%s 접속 시도", host)
        client.connect(
            host, port=args.port, username=dev["username"], password=dev["password"],
            look_for_keys=False, allow_agent=False, timeout=args.connect_timeout,
        )
        log.info("%s 접속 성공", host)
        chan = client.invoke_shell(width=250, height=1000)
        out, ok = read_until_prompt(chan, 30, raw)  # 로그인 배너 소비
        if not ok:
            log.error("%s 로그인 프롬프트 확인 실패", host)
            return [(host, "-", "-", False, "로그인 프롬프트 확인 실패", round(time.time() - t_dev, 1))]

        for cmd in ("set cli pager off", "set cli timeout idle never"):
            mark(cmd)
            out, ok = run_cmd(chan, cmd, 15, raw)
            if not ok:
                log.error("%s '%s' 응답 없음", host, cmd)
                return [(host, "-", "-", False, f"'{cmd}' 응답 없음", round(time.time() - t_dev, 1))]
        log.info("%s CLI 설정 완료 (pager off, timeout idle never)", host)

        for day, log_type in jobs:
            d = day.strftime("%Y/%m/%d")
            cmd = (
                f"ftp export log {log_type} start-time equal {d}@00:00:00 "
                f"end-time equal {d}@23:59:59 to "
                f"{args.ftp_user}:{secret}@{args.server}"
            )
            log.info("%s export 시작: %s %s", host, d, log_type)
            mark(mask(cmd))
            t0 = time.time()
            out, ok = run_cmd(chan, cmd, args.export_timeout, raw)
            elapsed = round(time.time() - t0, 1)
            low = out.lower()
            failed = any(k in low for k in ("error", "fail", "invalid syntax", "unknown command"))
            if not ok:
                msg, success = "타임아웃(프롬프트 미복귀)", False
            elif failed:
                msg = " | ".join(l.strip() for l in mask(out).strip().splitlines()[-3:])
                success = False
            else:
                msg, success = "OK", True
            (log.info if success else log.error)(
                "%s export %s: %s %s (%.1fs) %s", host,
                "성공" if success else "실패", d, log_type, elapsed, "" if success else msg)
            results.append((host, d, log_type, success, msg, elapsed))
        chan.send("exit\n")
    except Exception as e:  # 접속/인증 실패 등
        msg = f"{type(e).__name__}: {e}"
        log.error("%s 오류: %s", host, msg)
        raw(f"\n[예외] {msg}\n")
        results.append((host, "-", "-", False, msg, round(time.time() - t_dev, 1)))
    finally:
        client.close()
        raw_fh.close()
    return results


def load_devices(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = [r for r in csv.DictReader(f) if r.get("host", "").strip()]
    for r in rows:
        r["host"] = r["host"].strip()
    return rows


def setup_logging(log_dir, stamp):
    os.makedirs(log_dir, exist_ok=True)
    fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", "%Y-%m-%d %H:%M:%S")
    log.setLevel(logging.INFO)
    for h in (logging.FileHandler(os.path.join(log_dir, f"pan_backup_{stamp}.log"), encoding="utf-8"),
              logging.StreamHandler(sys.stdout)):
        h.setFormatter(fmt)
        log.addHandler(h)


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
    p.add_argument("--log-dir", default="logs", help="로그 저장 폴더 (기본: ./logs)")
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

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    setup_logging(args.log_dir, stamp)
    raw_dir = os.path.join(args.log_dir, "raw", stamp)
    os.makedirs(raw_dir, exist_ok=True)

    devices = load_devices(args.devices)
    log.info("시작: 장비 %d대 × 작업 %d건 (동시 %d) 서버=%s 기간=%s~%s 타입=%s",
             len(devices), len(jobs), args.workers, args.server,
             start.strftime("%Y/%m/%d"), end.strftime("%Y/%m/%d"), ",".join(types))

    all_results = []
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(backup_one, d, jobs, args, raw_dir): d["host"] for d in devices}
        done = 0
        for fut in as_completed(futs):
            all_results.extend(fut.result())
            done += 1
            log.info("진행: 장비 %d/%d 완료 (%s)", done, len(devices), futs[fut])

    csv_path = os.path.join(args.log_dir, f"pan_backup_{stamp}_result.csv")
    with open(csv_path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["host", "date", "log_type", "status", "message", "elapsed_sec"])
        for host, d, t, ok, msg, el in sorted(all_results):
            w.writerow([host, d, t, "OK" if ok else "FAIL", msg, el])

    fails = [r for r in all_results if not r[3]]
    log.info("완료: 성공 %d / 실패 %d", len(all_results) - len(fails), len(fails))
    for host, d, t, _, msg, _ in fails:
        log.info("  실패: %s %s %s - %s", host, d, t, msg)
    log.info("결과 CSV: %s / 원문: %s", csv_path, raw_dir)
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
