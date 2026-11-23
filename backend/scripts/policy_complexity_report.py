"""
정책 복잡도 리포트: 정책별 출발지/목적지/서비스 단일객체 수와 그 곱(복잡도)을 장비별 CSV로 만든다.

- 그룹 객체는 중첩 그룹까지 재귀로 펼쳐 단일(leaf) 객체 수에 모두 포함한다.
- 각 항목마다 두 가지 수를 낸다.
    *_cnt     : 중복 제거한 단일객체 수 (같은 객체가 여러 그룹에 있어도 1개)
    *_cnt_raw : 중복 제거 안 한 수 (그룹 안에서 나온 횟수를 그대로 합산)
  complexity     = src_cnt * dst_cnt * svc_cnt
  complexity_raw = src_cnt_raw * dst_cnt_raw * svc_cnt_raw
- 'any'는 객체 1개로 계산하고, *_any 컬럼으로 별도 표시한다.
- 비어 있는 그룹은 0개, 객체/그룹 어디에도 없는 토큰(직접 입력한 IP 등)은 1개로 센다.
- 대상: is_active=True 정책 전체 (enable 컬럼으로 비활성 룰 구분 가능).

출력 (--out-dir, 기본 backend/exports/policy_complexity/):
    <장비명>.csv   장비별 정책 목록 (복잡도 내림차순)
    summary.csv    장비별 통계 + 전체 합계 행

실행 (프로젝트 루트에서):
    .venv/bin/python backend/scripts/policy_complexity_report.py [--device-id 1] [--out-dir DIR] [--top 20]
"""
import argparse
import asyncio
import csv
import os
import re
import sys
from statistics import mean, median

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models import Device, NetworkGroup, NetworkObject, Policy, Service, ServiceGroup

POLICY_FIELDS = [
    "device", "seq", "rule_name", "enable", "action",
    "src_cnt", "dst_cnt", "svc_cnt", "complexity",
    "src_cnt_raw", "dst_cnt_raw", "svc_cnt_raw", "complexity_raw",
    "src_any", "dst_any", "svc_any",
]


def split_tokens(value: str | None) -> list[str]:
    return [t.strip() for t in (value or "").split(",") if t.strip()]


class GroupCounter:
    """그룹을 재귀로 펼쳐 단일객체 수를 센다. 그룹별 결과는 메모이제이션한다."""

    def __init__(self, group_map: dict[str, list[str]]):
        self.group_map = group_map
        self._leaves: dict[str, frozenset[str]] = {}
        self._raw: dict[str, int] = {}

    def leaves(self, name: str, path: frozenset[str] = frozenset()) -> frozenset[str]:
        """name을 펼친 단일객체 이름 집합 (중복 제거)."""
        if name not in self.group_map:
            return frozenset([name])
        if name in self._leaves:
            return self._leaves[name]
        if name in path:  # 순환 참조 보호
            return frozenset()
        result: set[str] = set()
        for m in self.group_map[name]:
            result |= self.leaves(m, path | {name})
        # 순환 때문에 잘린 결과는 캐시하지 않는다 (path 의존)
        if not path:
            self._leaves[name] = frozenset(result)
        return frozenset(result)

    def raw(self, name: str, path: frozenset[str] = frozenset()) -> int:
        """name을 펼친 단일객체 수 (중복 제거 안 함)."""
        if name not in self.group_map:
            return 1
        if name in self._raw:
            return self._raw[name]
        if name in path:
            return 0
        total = sum(self.raw(m, path | {name}) for m in self.group_map[name])
        if not path:
            self._raw[name] = total
        return total

    def count(self, field: str | None) -> tuple[int, int, bool]:
        """정책 필드(콤마 구분)의 (중복제거 수, raw 수, any 여부)."""
        tokens = split_tokens(field)
        is_any = any(t.lower() == "any" for t in tokens)
        distinct: set[str] = set()
        raw = 0
        for t in tokens:
            distinct |= self.leaves(t)
            raw += self.raw(t)
        return len(distinct), raw, is_any


def safe_filename(name: str) -> str:
    return re.sub(r'[\\/:*?"<>|\s]+', "_", name).strip("_") or "device"


def stats_row(label: str, rows: list[dict], top: int) -> dict:
    cx = [r["complexity"] for r in rows]
    cx_raw = [r["complexity_raw"] for r in rows]
    ranked = sorted(rows, key=lambda r: r["complexity"], reverse=True)[:top]
    return {
        "device": label,
        "policy_count": len(rows),
        "complexity_total": sum(cx),
        "complexity_avg": round(mean(cx), 1) if cx else 0,
        "complexity_median": median(cx) if cx else 0,
        "complexity_max": max(cx) if cx else 0,
        "complexity_raw_total": sum(cx_raw),
        "complexity_raw_max": max(cx_raw) if cx_raw else 0,
        "src_cnt_avg": round(mean(r["src_cnt"] for r in rows), 1) if rows else 0,
        "dst_cnt_avg": round(mean(r["dst_cnt"] for r in rows), 1) if rows else 0,
        "svc_cnt_avg": round(mean(r["svc_cnt"] for r in rows), 1) if rows else 0,
        "any_policy_count": sum(1 for r in rows if r["src_any"] or r["dst_any"] or r["svc_any"]),
        "top_policies": " | ".join(
            f"{r['device']}:{r['rule_name']}({r['complexity']})" if label == "ALL" else f"{r['rule_name']}({r['complexity']})"
            for r in ranked
        ),
    }


SUMMARY_FIELDS = [
    "device", "policy_count", "complexity_total", "complexity_avg", "complexity_median",
    "complexity_max", "complexity_raw_total", "complexity_raw_max",
    "src_cnt_avg", "dst_cnt_avg", "svc_cnt_avg", "any_policy_count", "top_policies",
]


def write_csv(path: str, fields: list[str], rows: list[dict]) -> None:
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)


async def analyze_device(db, device: Device) -> list[dict]:
    did = device.id

    async def names(model, *cols):
        res = await db.execute(select(*cols).where(model.device_id == did, model.is_active == True))  # noqa: E712
        return res.all()

    net_groups = {n: split_tokens(m) for n, m in await names(NetworkGroup, NetworkGroup.name, NetworkGroup.members)}
    svc_groups = {n: split_tokens(m) for n, m in await names(ServiceGroup, ServiceGroup.name, ServiceGroup.members)}
    addr = GroupCounter(net_groups)
    svc = GroupCounter(svc_groups)

    res = await db.execute(
        select(Policy.seq, Policy.rule_name, Policy.enable, Policy.action,
               Policy.source, Policy.destination, Policy.service)
        .where(Policy.device_id == did, Policy.is_active == True)  # noqa: E712
        .order_by(Policy.seq)
    )
    rows = []
    for seq, rule_name, enable, action, source, destination, service in res.all():
        s, s_raw, s_any = addr.count(source)
        d, d_raw, d_any = addr.count(destination)
        v, v_raw, v_any = svc.count(service)
        rows.append({
            "device": device.name, "seq": seq, "rule_name": rule_name, "enable": enable, "action": action,
            "src_cnt": s, "dst_cnt": d, "svc_cnt": v, "complexity": s * d * v,
            "src_cnt_raw": s_raw, "dst_cnt_raw": d_raw, "svc_cnt_raw": v_raw, "complexity_raw": s_raw * d_raw * v_raw,
            "src_any": s_any, "dst_any": d_any, "svc_any": v_any,
        })
    return rows


async def main(device_id: int | None, out_dir: str, top: int) -> None:
    os.makedirs(out_dir, exist_ok=True)
    summary: list[dict] = []
    all_rows: list[dict] = []

    async with SessionLocal() as db:
        stmt = select(Device).order_by(Device.id)
        if device_id is not None:
            stmt = stmt.where(Device.id == device_id)
        devices = (await db.execute(stmt)).scalars().all()

        for device in devices:
            rows = await analyze_device(db, device)
            rows.sort(key=lambda r: r["complexity"], reverse=True)
            path = os.path.join(out_dir, f"{safe_filename(device.name)}.csv")
            write_csv(path, POLICY_FIELDS, rows)
            summary.append(stats_row(device.name, rows, top))
            all_rows.extend(rows)
            print(f"[{device.name}] 정책 {len(rows)}건 -> {path}")

    summary.append(stats_row("ALL", all_rows, top))
    spath = os.path.join(out_dir, "summary.csv")
    write_csv(spath, SUMMARY_FIELDS, summary)
    print(f"\n요약 -> {spath}")


if __name__ == "__main__":
    default_out = os.path.join(os.path.dirname(__file__), "..", "exports", "policy_complexity")
    parser = argparse.ArgumentParser()
    parser.add_argument("--device-id", type=int, default=None, help="특정 장비만 (미지정 시 전체)")
    parser.add_argument("--out-dir", default=default_out, help="CSV 출력 디렉터리")
    parser.add_argument("--top", type=int, default=5, help="summary의 장비별 상위 정책 개수 (기본 5)")
    args = parser.parse_args()
    asyncio.run(main(args.device_id, os.path.abspath(args.out_dir), args.top))
