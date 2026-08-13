"""
임시 스크립트: 이력없는(Request Type=Unknown) + 광대역 정책 조회.

- "이력없는(Unknown)" 판정: deletion_workflow RequestParser와 동일한 로직
  (Policy.rule_name + Policy.description을 Settings의 deletion_workflow_config 정규식으로 파싱)
- "광대역" 판정: 출발지 또는 목적지 주소의 병합된 IP 범위 크기가 --threshold(기본 65536 = /16) 이상
  (any는 전체 범위이므로 자동으로 threshold를 넘는다)
- 서비스(포트) 조건은 보지 않음 — 요청에 따라 주소만 판정
- 정책이 많으면 한 번에 다 메모리에 올리지 않도록 --batch-size 단위로 나눠서 조회하고,
  결과가 나오는 대로 CSV에 즉시 append(flush) — 중간에 죽어도 그때까지 결과는 파일에 남아있음

실행 (프로젝트 루트에서):
    python backend/scripts/find_unknown_broad_policies.py [--threshold 65536] [--device-id 1] [--csv out.csv] [--batch-size 500]
"""
import argparse
import asyncio
import csv
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


FIELDNAMES = [
    "device", "rule_name", "seq", "action", "source", "destination",
    "service", "description", "source_range_size", "destination_range_size",
]


def row_from_policy(policy, src_size, dst_size):
    return {
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
    }


async def main(threshold: int, device_id: int | None, csv_path: str | None, batch_size: int):
    async with SessionLocal() as db:
        config_dict = await load_config_dict(db)
        config = ConfigManager(config_dict=config_dict)
        parser = RequestParser(config)

        csv_file = None
        writer = None
        if csv_path:
            csv_file = open(csv_path, 'w', newline='', encoding='utf-8-sig')
            writer = csv.DictWriter(csv_file, fieldnames=FIELDNAMES)
            writer.writeheader()

        total_scanned = 0
        total_matched = 0
        last_id = 0

        try:
            while True:
                stmt = (
                    select(Policy)
                    .where(Policy.is_active == True, Policy.id > last_id)  # noqa: E712
                    .options(
                        selectinload(Policy.address_members),
                        selectinload(Policy.device),
                    )
                    .order_by(Policy.id)
                    .limit(batch_size)
                )
                if device_id is not None:
                    stmt = stmt.where(Policy.device_id == device_id)

                result = await db.execute(stmt)
                batch = result.scalars().all()
                if not batch:
                    break

                for policy in batch:
                    last_id = policy.id
                    total_scanned += 1

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

                    total_matched += 1
                    row = row_from_policy(policy, src_size, dst_size)
                    print(
                        f"[{row['device']}] {row['rule_name']} (seq={row['seq']}) "
                        f"src_size={src_size} dst_size={dst_size} "
                        f"| src={row['source']} dst={row['destination']} svc={row['service']}"
                    )
                    if writer:
                        writer.writerow(row)

                if writer:
                    csv_file.flush()

                # 배치가 끝날 때마다 세션 identity map을 비워 메모리 누적 방지
                db.expunge_all()

                print(f"-- {total_scanned}건 처리, 지금까지 {total_matched}건 매치 (누적 저장됨) --")
        finally:
            if csv_file:
                csv_file.close()

        print(f"\n조회된 정책(is_active=True) 총: {total_scanned}건")
        print(f"이력없음(Unknown) + 광대역(threshold={threshold}) 정책 총: {total_matched}건")
        if csv_path:
            print(f"CSV 저장(중간 저장 포함): {csv_path}")


if __name__ == '__main__':
    parser_arg = argparse.ArgumentParser()
    parser_arg.add_argument('--threshold', type=int, default=65536, help='광대역 판정 IP 개수 임계치 (기본 65536 = /16)')
    parser_arg.add_argument('--device-id', type=int, default=None, help='특정 장비만 조회 (미지정 시 전체)')
    parser_arg.add_argument('--csv', type=str, default=None, help='CSV 저장 경로')
    parser_arg.add_argument('--batch-size', type=int, default=500, help='한 번에 조회할 정책 개수 (기본 500)')
    args = parser_arg.parse_args()

    asyncio.run(main(args.threshold, args.device_id, args.csv, args.batch_size))
