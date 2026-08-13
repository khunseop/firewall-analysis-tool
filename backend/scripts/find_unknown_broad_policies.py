"""
임시 스크립트: 이력없는(Request Type=Unknown) + 광대역 정책 조회.

- "이력없는(Unknown)" 판정: deletion_workflow RequestParser와 동일한 로직
  (Policy.rule_name + Policy.description을 Settings의 deletion_workflow_config 정규식으로 파싱)
- "광대역" 판정: 출발지 또는 목적지 주소의 병합된 IP 범위 크기가 --threshold(기본 65536 = /16) 이상
  (any는 전체 범위이므로 자동으로 threshold를 넘는다)
- 서비스(포트) 조건은 보지 않음 — 요청에 따라 주소만 판정

실행 (프로젝트 루트에서):
    python backend/scripts/find_unknown_broad_policies.py [--threshold 65536] [--device-id 1] [--csv out.csv]
"""
import argparse
import asyncio
import csv
import ipaddress
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.db.session import SessionLocal
from app.models import Policy, Device
from app.services.deletion_workflow.config_bridge import load_config_dict
from app.services.deletion_workflow.core.config_manager import ConfigManager
from app.services.deletion_workflow.processors.request_parser import RequestParser


def merge_ranges(ranges):
    if not ranges:
        return []
    ranges = sorted(ranges)
    merged = [ranges[0]]
    for start, end in ranges[1:]:
        last_start, last_end = merged[-1]
        if start <= last_end + 1:
            merged[-1] = (last_start, max(last_end, end))
        else:
            merged.append((start, end))
    return merged


def range_size(direction_ranges):
    merged = merge_ranges(direction_ranges)
    return sum(end - start + 1 for start, end in merged)


async def main(threshold: int, device_id: int | None, csv_path: str | None):
    async with SessionLocal() as db:
        config_dict = await load_config_dict(db)
        config = ConfigManager(config_dict=config_dict)
        parser = RequestParser(config)

        stmt = (
            select(Policy)
            .where(Policy.is_active == True)  # noqa: E712
            .options(
                selectinload(Policy.address_members),
                selectinload(Policy.device),
            )
        )
        if device_id is not None:
            stmt = stmt.where(Policy.device_id == device_id)

        result = await db.execute(stmt)
        policies = result.scalars().all()

        rows = []
        for policy in policies:
            info = parser.parse_request_info(policy.rule_name, policy.description)
            if info.get("Request Type") != "Unknown":
                continue

            src_ranges = [
                (m.ip_start, m.ip_end)
                for m in policy.address_members
                if m.direction == 'source' and m.ip_start is not None and m.ip_end is not None
            ]
            dst_ranges = [
                (m.ip_start, m.ip_end)
                for m in policy.address_members
                if m.direction == 'destination' and m.ip_start is not None and m.ip_end is not None
            ]
            src_size = range_size(src_ranges)
            dst_size = range_size(dst_ranges)

            if max(src_size, dst_size) < threshold:
                continue

            rows.append({
                "device": policy.device.name if policy.device else policy.device_id,
                "rule_name": policy.rule_name,
                "seq": policy.seq,
                "action": policy.action,
                "source": policy.source,
                "destination": policy.destination,
                "service": policy.service,
                "description": policy.description or "",
                "source_range_size": src_size,
                "destination_range_size": dst_size,
            })

        rows.sort(key=lambda r: max(r["source_range_size"], r["destination_range_size"]), reverse=True)

        print(f"조회된 정책(is_active=True): {len(policies)}건")
        print(f"이력없음(Unknown) + 광대역(threshold={threshold}) 정책: {len(rows)}건\n")
        for r in rows:
            print(
                f"[{r['device']}] {r['rule_name']} (seq={r['seq']}) "
                f"src_size={r['source_range_size']} dst_size={r['destination_range_size']} "
                f"| src={r['source']} dst={r['destination']} svc={r['service']}"
            )

        if csv_path and rows:
            with open(csv_path, 'w', newline='', encoding='utf-8-sig') as f:
                writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
                writer.writeheader()
                writer.writerows(rows)
            print(f"\nCSV 저장: {csv_path}")


if __name__ == '__main__':
    parser_arg = argparse.ArgumentParser()
    parser_arg.add_argument('--threshold', type=int, default=65536, help='광대역 판정 IP 개수 임계치 (기본 65536 = /16)')
    parser_arg.add_argument('--device-id', type=int, default=None, help='특정 장비만 조회 (미지정 시 전체)')
    parser_arg.add_argument('--csv', type=str, default=None, help='CSV 저장 경로')
    args = parser_arg.parse_args()

    asyncio.run(main(args.threshold, args.device_id, args.csv))
