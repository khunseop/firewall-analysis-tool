#!/usr/bin/env python3
"""Palo Alto 방화벽 다수 장비의 로그를 FTP 백업 서버로 일괄 export 한다.

장비별로 SSH 접속 후 아래 순서로 실행:
  1) set cli pager off
  2) set cli timeout idle never
  3) ftp export log <type> start-time equal <D>@00:00:00 end-time equal <D>@23:59:59 to <id>:<pw>@<server>
  4) export 는 job 으로 등록되므로 `show jobs id N` 이 FIN 이 될 때까지 세션을 유지하며 폴링

사용 예:
  python scripts/pan_log_backup.py -d devices.csv --date 2026/11/12 --background
  python scripts/pan_log_backup.py --status          # 실행 중/종료된 작업 상태 확인

devices.csv (헤더 포함) — 장비마다 백업 서버/기간/로그종류까지 지정 가능:
  host,username,password,server,ftp_user,ftp_pw,start_date,start_time,end_date,end_time,log_types
  10.1.1.1,admin,secret,10.0.0.50,backup,pw1,2026/11/12,09:00,2026/11/12,18:00,traffic
  10.1.1.2,admin,secret,10.0.0.51,backup,pw2,2026/11/10,,2026/11/12,,traffic;threat

필수는 host,username,password. 나머지 컬럼은 생략하거나 행에서 비워 두면 명령줄 값
(--server/--ftp-user/--ftp-pw(환경변수 BACKUP_PW)/--start-date/--start-time/--end-date/
--end-time/--log-types)을, 그것도 없으면 기본값을 사용한다.
log_types 를 CSV 안에서 여러 개 쓸 땐 쉼표 대신 세미콜론(;) 또는 따옴표로 감싼 쉼표 사용.
장비당 1행 (host 중복 불가).

여러 로그 타입: --log-types traffic,threat,system

기간 지정 (날짜/시각 각각, 시각은 HH:MM[:SS]):
  --start-date 2026/11/12 --start-time 09:00 --end-date 2026/11/12 --end-time 18:30
  생략 시: 시작날짜=어제, 종료날짜=시작날짜, 시작시각=00:00:00, 종료시각=23:59:59
  (--date 는 --start-date 의 별칭)
  여러 날에 걸치면 하루씩 나눠 export (첫날은 시작시각부터, 마지막 날은 종료시각까지,
  중간 날은 종일). 나누지 않고 1건으로 보내려면 --no-split.
장비 수만큼 동시 접속(기본). 제한하려면 --workers N. export 대기 기본 최대 12시간.

로그 산출물 (기본 ./logs, --log-dir 로 변경):
  logs/pan_backup_YYYYMMDD_HHMMSS.log        시각이 붙은 진행/결과 기록 (+ 주기적 요약 한 줄)
  logs/pan_backup_YYYYMMDD_HHMMSS_result.csv 작업별 결과 (host,date,log_type,status,message,elapsed_sec)
  logs/raw/YYYYMMDD_HHMMSS/<host>.txt        장비 CLI 응답 원문 (FTP 비밀번호는 *** 마스킹)
  logs/pan_backup_status.json                실시간 상태 (5초마다 갱신, --status 가 읽음)
"""
import argparse
import csv
import json
import logging
import os
import re
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta

import paramiko

PROMPT_RE = re.compile(r"[\w.\-@()]+[>#]\s*$")  # admin@PA-FW01> / admin@PA-FW01#
JOBID_RE = re.compile(r"job\s*(?:id)?\D{0,40}?(\d+)", re.I)  # "enqueued with jobid 123" 등
log = logging.getLogger("pan_backup")
STATUS_FILE = "pan_backup_status.json"


class StatusBoard:
    """장비별 실시간 상태를 모아 JSON 으로 주기 저장하고, 주기적으로 요약을 로그에 남긴다."""

    def __init__(self, path, totals, heartbeat):
        """totals: {host: 해당 장비의 작업 건수}"""
        self.path, self.heartbeat = path, heartbeat
        self.lock = threading.Lock()
        self.stop = threading.Event()
        self.meta = {"pid": os.getpid(), "started": time.time(), "finished": False,
                     "total_jobs": sum(totals.values())}
        self.devs = {h: {"state": "대기", "session": "-", "done": 0, "failed": 0,
                         "total": n, "current": "", "job_id": "", "job_status": "",
                         "start": None, "end": None, "updated": time.time(), "msg": ""}
                     for h, n in totals.items()}

    def set(self, host, **kw):
        with self.lock:
            self.devs[host].update(kw, updated=time.time())

    def get(self, host):
        with self.lock:
            return dict(self.devs[host])

    def write(self):
        with self.lock:
            data = {"meta": self.meta, "devices": self.devs}
            tmp = self.path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False)
            os.replace(tmp, self.path)

    def summary(self):
        with self.lock:
            counts = {}
            for d in self.devs.values():
                counts[d["state"]] = counts.get(d["state"], 0) + 1
            lost = sum(1 for d in self.devs.values() if d["session"] == "끊김")
        return ", ".join(f"{k} {v}" for k, v in sorted(counts.items())) + f" | 세션 끊김 {lost}"

    def run(self):
        last_hb = time.time()
        while not self.stop.wait(5):
            self.write()
            if time.time() - last_hb >= self.heartbeat:
                log.info("[요약] %s", self.summary())
                last_hb = time.time()
        self.write()


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


def wait_job(chan, job_id, args, raw, host, board):
    """`show jobs id N` 를 폴링하며 작업이 끝날 때까지 세션을 유지. (성공여부, 메시지) 반환."""
    row_re = re.compile(rf"\b{job_id}\b\s+\S+\s+(ACT|FIN|PEND)\s+(\S+)")
    deadline = time.time() + args.export_timeout
    last_status = None
    while time.time() < deadline:
        raw(f"\n===== [{datetime.now():%H:%M:%S}] show jobs id {job_id} =====\n")
        out, ok = run_cmd(chan, f"show jobs id {job_id}", 30, raw)
        m = row_re.search(out)
        if m:
            status, result = m.group(1), m.group(2)
            board.set(host, job_status=status if status != "FIN" else f"FIN/{result}")
            if status != last_status:
                log.info("%s job %s 상태: %s", host, job_id, status)
                last_status = status
            if status == "FIN":
                if result == "OK":
                    return True, "OK"
                detail = " | ".join(l.strip() for l in out.strip().splitlines()[-4:])
                return False, f"job {job_id} 결과 {result}: {detail}"
        time.sleep(args.poll_interval)
    return False, f"job {job_id} 타임아웃({args.export_timeout}s 내 FIN 안 됨, 마지막 상태 {last_status})"


def backup_one(dev, args, raw_dir, board):
    """한 장비에서 모든 (날짜, 로그타입) 작업 수행.

    결과 리스트 [(host, date, log_type, ok, message, elapsed_sec)] 반환.
    """
    host = dev["host"]
    results = []
    server, ftp_user, secret = dev["server"], dev["ftp_user"], dev["ftp_pw"]

    def mask(text):
        return text.replace(secret, "***")

    raw_fh = open(os.path.join(raw_dir, f"{host}.txt"), "a", encoding="utf-8")

    def raw(text):
        raw_fh.write(mask(text))
        raw_fh.flush()

    def mark(text):  # 원문 파일 안의 구분선
        raw(f"\n===== [{datetime.now():%H:%M:%S}] {text} =====\n")

    def fail_all(msg):  # 접속 단계 실패
        board.set(host, state="실패", session="끊김", msg=msg, end=time.time())
        return [(host, "-", "-", False, msg, round(time.time() - t_dev, 1))]

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    t_dev = time.time()
    board.set(host, state="접속중", start=t_dev)
    try:
        log.info("%s 접속 시도", host)
        client.connect(
            host, port=args.port, username=dev["username"], password=dev["password"],
            look_for_keys=False, allow_agent=False, timeout=args.connect_timeout,
        )
        transport = client.get_transport()
        transport.set_keepalive(30)  # 장시간 대기 중 SSH 세션 유지
        log.info("%s 접속 성공", host)
        board.set(host, state="설정중", session="연결")
        chan = client.invoke_shell(width=250, height=1000)
        out, ok = read_until_prompt(chan, 30, raw)  # 로그인 배너 소비
        if not ok:
            log.error("%s 로그인 프롬프트 확인 실패", host)
            return fail_all("로그인 프롬프트 확인 실패")

        for cmd in ("set cli pager off", "set cli timeout idle never"):
            mark(cmd)
            out, ok = run_cmd(chan, cmd, 15, raw)
            if not ok:
                log.error("%s '%s' 응답 없음", host, cmd)
                return fail_all(f"'{cmd}' 응답 없음")
        log.info("%s CLI 설정 완료 (pager off, timeout idle never)", host)

        for s_dt, e_dt, log_type in dev["jobs"]:
            d = span_label(s_dt, e_dt)
            cmd = (
                f"ftp export log {log_type} start-time equal {s_dt:%Y/%m/%d@%H:%M:%S} "
                f"end-time equal {e_dt:%Y/%m/%d@%H:%M:%S} to "
                f"{ftp_user}:{secret}@{server}"
            )
            log.info("%s export 시작: %s %s → %s", host, d, log_type, server)
            board.set(host, state="export중", current=f"{d} {log_type}", job_id="", job_status="")
            mark(mask(cmd))
            t0 = time.time()
            out, ok = run_cmd(chan, cmd, 60, raw)  # export 는 job 등록 후 바로 프롬프트 복귀
            low = out.lower()
            failed = any(k in low for k in ("error", "fail", "invalid syntax", "unknown command"))
            m = JOBID_RE.search(out)
            if not ok:
                msg, success = "명령 응답 없음(프롬프트 미복귀)", False
            elif failed:
                msg = " | ".join(l.strip() for l in mask(out).strip().splitlines()[-3:])
                success = False
            elif not m:
                # job id 를 못 찾으면 완료 여부를 확인할 수 없음 → 성공으로 단정하지 않는다
                msg = "job id 확인 불가(완료 여부 미확인): " + " | ".join(
                    l.strip() for l in mask(out).strip().splitlines()[-3:])
                success = False
            else:
                job_id = m.group(1)
                log.info("%s job %s 등록됨, 완료까지 세션 유지: %s %s", host, job_id, d, log_type)
                board.set(host, job_id=job_id, job_status="등록")
                success, msg = wait_job(chan, job_id, args, raw, host, board)
            elapsed = round(time.time() - t0, 1)
            (log.info if success else log.error)(
                "%s export %s: %s %s (%.1fs) %s", host,
                "성공" if success else "실패", d, log_type, elapsed, "" if success else msg)
            results.append((host, d, log_type, success, msg, elapsed))
            cur = board.get(host)
            board.set(host, done=cur["done"] + (1 if success else 0),
                      failed=cur["failed"] + (0 if success else 1),
                      msg="" if success else msg)
        chan.send("exit\n")
        cur = board.get(host)
        board.set(host, state="완료" if cur["failed"] == 0 else "실패(일부)",
                  session="종료", end=time.time())
    except Exception as e:  # 접속/인증 실패, 세션 끊김 등
        cur = board.get(host)
        msg = f"{type(e).__name__}: {e}"
        if cur["job_id"]:
            msg += f" (세션 끊김 시점 job {cur['job_id']}; 장비에서는 계속 진행 중일 수 있으니 show jobs 로 확인)"
        log.error("%s 오류: %s", host, msg)
        raw(f"\n[예외] {msg}\n")
        results.append((host, cur["current"] or "-", "-", False, msg, round(time.time() - t_dev, 1)))
        board.set(host, state="실패", session="끊김", msg=msg, end=time.time())
    finally:
        client.close()
        raw_fh.close()
    return results


def load_devices(path, args):
    """CSV 로드. server/ftp_user/ftp_pw 는 행 값이 우선, 비어 있으면 CLI 인자로 대체."""
    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = [r for r in csv.DictReader(f) if (r.get("host") or "").strip()]
    errors, seen = [], set()
    for r in rows:
        r["host"] = r["host"].strip()
        if r["host"] in seen:
            errors.append(f"{r['host']}: host 가 중복되었습니다 (장비당 1행, 기간이 여러 날이면 시작/종료로 지정)")
        seen.add(r["host"])
        for key, default in (("server", args.server), ("ftp_user", args.ftp_user),
                             ("ftp_pw", args.ftp_pw)):
            r[key] = (r.get(key) or "").strip() or default
            if not r[key]:
                errors.append(f"{r['host']}: '{key}' 값이 없습니다 (CSV 컬럼 또는 인자로 지정)")
        # 기간/로그타입: 행 값 우선, 비어 있으면 명령줄 값(또는 기본값)
        opt = {k: (r.get(k) or "").strip() or getattr(args, k)
               for k in ("start_date", "start_time", "end_date", "end_time", "log_types")}
        try:
            spans = build_spans(argparse.Namespace(no_split=args.no_split, **{
                k: v for k, v in opt.items() if k != "log_types"}))
        except SystemExit as e:
            errors.append(f"{r['host']}: {e}")
            continue
        types = [t.strip() for t in opt["log_types"].replace(";", ",").split(",") if t.strip()]
        r["jobs"] = [(s, e, t) for s, e in spans for t in types]
    if errors:
        sys.exit("장비 목록 오류:\n  " + "\n  ".join(errors))
    return rows


def setup_logging(log_dir, stamp):
    os.makedirs(log_dir, exist_ok=True)
    fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", "%Y-%m-%d %H:%M:%S")
    log.setLevel(logging.INFO)
    for h in (logging.FileHandler(os.path.join(log_dir, f"pan_backup_{stamp}.log"), encoding="utf-8"),
              logging.StreamHandler(sys.stdout)):
        h.setFormatter(fmt)
        log.addHandler(h)


def span_label(s, e):
    """결과/로그/상태표에 쓰는 구간 표기. 같은 날이면 날짜를 한 번만 표시."""
    if s.date() == e.date():
        return f"{s:%Y/%m/%d %H:%M:%S}~{e:%H:%M:%S}"
    return f"{s:%Y/%m/%d %H:%M:%S}~{e:%Y/%m/%d %H:%M:%S}"


def parse_time(text, name):
    for fmt in ("%H:%M:%S", "%H:%M"):
        try:
            return datetime.strptime(text, fmt).time()
        except ValueError:
            pass
    sys.exit(f"{name} 형식 오류: '{text}' (HH:MM:SS 또는 HH:MM)")


def build_spans(args):
    """(시작, 종료) 구간 목록. 기본은 날짜별 분할, --no-split 이면 구간 전체를 1건으로."""
    def pdate(text, name):
        try:
            return datetime.strptime(text, "%Y/%m/%d").date()
        except ValueError:
            sys.exit(f"{name} 형식 오류: '{text}' (YYYY/MM/DD)")

    sd = pdate(args.start_date, "--start-date") if args.start_date else (datetime.now() - timedelta(days=1)).date()
    ed = pdate(args.end_date, "--end-date") if args.end_date else sd
    st = parse_time(args.start_time, "--start-time")
    et = parse_time(args.end_time, "--end-time")
    start, end = datetime.combine(sd, st), datetime.combine(ed, et)
    if end <= start:
        sys.exit(f"종료({end:%Y/%m/%d %H:%M:%S})가 시작({start:%Y/%m/%d %H:%M:%S})보다 늦어야 합니다")
    if args.no_split or sd == ed:
        return [(start, end)]
    spans = []
    for i in range((ed - sd).days + 1):
        day = sd + timedelta(days=i)
        s = start if day == sd else datetime.combine(day, datetime.min.time())
        e = end if day == ed else datetime.combine(day, datetime.max.time().replace(microsecond=0))
        spans.append((s, e))
    return spans


def fmt_dur(sec):
    sec = int(max(sec, 0))
    return f"{sec // 3600}:{sec % 3600 // 60:02d}:{sec % 60:02d}"


def show_status(log_dir, only_problem):
    """status JSON 을 읽어 장비별 표를 출력."""
    path = os.path.join(log_dir, STATUS_FILE)
    if not os.path.exists(path):
        sys.exit(f"상태 파일이 없습니다: {path}")
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    meta, devs = data["meta"], data["devices"]
    now = time.time()
    alive = None
    if os.name == "posix":
        try:
            os.kill(meta["pid"], 0)
            alive = True
        except OSError:
            alive = False
    if meta["finished"]:
        run = "종료됨"
    elif alive is False:
        run = "⚠ 프로세스 없음 (정상 종료 전에 중단됨)"
    else:
        run = "실행 중" if alive else "실행 중(프로세스 확인 불가)"
    counts = {}
    for d in devs.values():
        counts[d["state"]] = counts.get(d["state"], 0) + 1
    print(f"PID {meta['pid']} | {run} | 시작 {datetime.fromtimestamp(meta['started']):%m/%d %H:%M} "
          f"| 경과 {fmt_dur(now - meta['started'])}")
    print("요약: " + ", ".join(f"{k} {v}" for k, v in sorted(counts.items())) + f" (총 {len(devs)}대)\n")
    print(f"{'HOST':<16}{'상태':<10}{'세션':<5}{'완료/전체':<10}{'현재작업':<52}{'JOB':<8}{'JOB상태':<10}{'경과':<9}{'갱신':<8}비고")
    for host, d in sorted(devs.items()):
        if only_problem and d["state"] in ("완료", "대기") and not d["failed"]:
            continue
        el = (d["end"] or now) - d["start"] if d["start"] else 0
        stale = now - d["updated"]
        flag = " ⚠" if (d["state"] == "export중" and stale > 300) else ""
        print(f"{host:<16}{d['state']:<10}{d['session']:<5}{d['done']}/{d['total']:<8}"
              f"{d['current']:<52}{d['job_id']:<8}{d['job_status']:<10}{fmt_dur(el):<9}"
              f"{int(stale)}s전{flag:<4} {d['msg'][:60]}")


def main():
    p = argparse.ArgumentParser(description="Palo Alto 로그 FTP 일괄 백업")
    p.add_argument("-d", "--devices", help="장비 CSV (host,username,password[,server,ftp_user,ftp_pw])")
    p.add_argument("--status", action="store_true", help="실행 상태 표 출력 후 종료")
    p.add_argument("--only-problem", action="store_true", help="--status 와 함께: 완료/대기 장비 숨김")
    p.add_argument("--server", help="기본 백업(FTP) 서버 (CSV의 server 컬럼이 비었을 때 사용)")
    p.add_argument("--ftp-user", help="기본 FTP 계정 (CSV의 ftp_user 가 비었을 때 사용)")
    p.add_argument("--ftp-pw", default=os.environ.get("BACKUP_PW"),
                   help="기본 FTP 비밀번호 (CSV의 ftp_pw 가 비었을 때 사용, 환경변수 BACKUP_PW 가능)")
    p.add_argument("--start-date", "--date", dest="start_date", help="시작 날짜 YYYY/MM/DD (기본: 어제)")
    p.add_argument("--start-time", default="00:00:00", help="시작 시각 HH:MM[:SS] (기본 00:00:00)")
    p.add_argument("--end-date", help="종료 날짜 YYYY/MM/DD (기본: 시작 날짜와 동일)")
    p.add_argument("--end-time", default="23:59:59", help="종료 시각 HH:MM[:SS] (기본 23:59:59)")
    p.add_argument("--no-split", action="store_true",
                   help="여러 날에 걸친 구간을 하루씩 나누지 않고 1건으로 export")
    p.add_argument("--log-types", default="traffic", help="쉼표 구분 (기본: traffic)")
    p.add_argument("--port", type=int, default=22)
    p.add_argument("--workers", type=int, default=0, help="동시 처리 장비 수 (기본 0 = 장비 전체 동시)")
    p.add_argument("--connect-timeout", type=int, default=15)
    p.add_argument("--export-timeout", type=int, default=43200, help="export job 1건 최대 대기(초, 기본 12시간)")
    p.add_argument("--poll-interval", type=int, default=30, help="job 상태 확인 간격(초)")
    p.add_argument("--heartbeat", type=int, default=600, help="로그에 요약 한 줄 남기는 간격(초)")
    p.add_argument("--log-dir", default="logs", help="로그 저장 폴더 (기본: ./logs)")
    p.add_argument("--background", action="store_true",
                   help="백그라운드로 분리 실행 (콘솔/SSH 창을 닫아도 계속 진행)")
    args = p.parse_args()

    if args.status:
        show_status(args.log_dir, args.only_problem)
        return
    if not args.devices:
        p.error("-d/--devices 가 필요합니다 (상태 확인은 --status)")

    if args.background and not os.environ.get("PAN_BG_CHILD"):
        load_devices(args.devices, args)  # CSV 오류는 백그라운드로 보내기 전에 여기서 바로 보여줌
        os.makedirs(args.log_dir, exist_ok=True)
        out_path = os.path.join(args.log_dir, f"pan_backup_stdout_{datetime.now():%Y%m%d_%H%M%S}.out")
        kw = {"start_new_session": True} if os.name == "posix" else {
            "creationflags": subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP}
        with open(out_path, "w") as out_fh:
            proc = subprocess.Popen(
                [sys.executable] + [a for a in sys.argv if a != "--background"],
                stdin=subprocess.DEVNULL, stdout=out_fh, stderr=subprocess.STDOUT,
                env={**os.environ, "PAN_BG_CHILD": "1"}, **kw)
        print(f"백그라운드 실행 시작 (PID {proc.pid}). 이 창은 닫아도 됩니다.")
        print(f"상태 확인: python {sys.argv[0]} --status" + (f" --log-dir {args.log_dir}" if args.log_dir != "logs" else ""))
        print(f"콘솔 출력 파일: {out_path}")
        sys.exit(0)

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    setup_logging(args.log_dir, stamp)
    raw_dir = os.path.join(args.log_dir, "raw", stamp)
    os.makedirs(raw_dir, exist_ok=True)

    devices = load_devices(args.devices, args)
    workers = args.workers or len(devices)
    log.info("시작: 장비 %d대, 작업 총 %d건 (동시 %d)",
             len(devices), sum(len(d["jobs"]) for d in devices), workers)
    for d in devices:  # 장비별 실행 계획을 로그에 남김
        plan = "; ".join(f"{span_label(s, e)} {t}" for s, e, t in d["jobs"])
        log.info("  계획 %s → %s : %s", d["host"], d["server"], plan)

    board = StatusBoard(os.path.join(args.log_dir, STATUS_FILE),
                        {d["host"]: len(d["jobs"]) for d in devices}, args.heartbeat)
    board.write()
    threading.Thread(target=board.run, daemon=True).start()

    all_results = []
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(backup_one, d, args, raw_dir, board): d["host"] for d in devices}
        done = 0
        for fut in as_completed(futs):
            all_results.extend(fut.result())
            done += 1
            log.info("진행: 장비 %d/%d 완료 (%s)", done, len(devices), futs[fut])

    board.meta["finished"] = True
    board.stop.set()
    time.sleep(0.5)
    board.write()

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
