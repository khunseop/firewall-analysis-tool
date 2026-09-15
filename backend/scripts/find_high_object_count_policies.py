"""
임시 스크립트: 출발지/목적지에 객체(주소)가 많이 나열된 정책을 찾는다.

- "객체수" 판정: Policy.source / Policy.destination 필드는 콤마로 구분된 객체명(또는 IP) 나열이므로,
  콤마 기준으로 split한 토큰 개수를 그대로 객체수로 센다 (그룹 내부 재귀 확장은 하지 않음 —
  정책에 실제로 나열된 항목 수가 많은 것 자체가 관리 포인트이기 때문).
- 정렬 기준(--sort-by): max(기본, 출발지/목적지 중 큰 값) | source | destination | total(합산)
- 정책이 많으면 한 번에 다 메모리에 올리지 않도록 --batch-size 단위로 나눠서 조회

실행 (프로젝트 루트에서):
    python backend/scripts/find_high_object_count_policies.py \
        [--min-count 10] [--top 50] [--device-id 1] [--sort-by max] \
        [--csv out.csv] [--batch-size 500]
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
from app.models import Policy


def split_tokens(value: str) -> list[str]:
    if not value:
        return []
    return [t.strip() for t in value.split(',') if t.strip()]


FIELDNAMES = [
    "device", "rule_name", "seq", "source_count", "destination_count",
]


def row_from_policy(policy: Policy, src_count: int, dst_count: int) -> dict:
    return {
        "device": policy.device.name if policy.device else policy.device_id,
        "rule_name": policy.rule_name,
        "seq": policy.seq,
        "source_count": src_count,
        "destination_count": dst_count,
    }


async def main(min_count: int, top: int, device_id: int | None, sort_by: str, csv_path: str | None, batch_size: int):
    async with SessionLocal() as db:
        rows: list[dict] = []
        total_scanned = 0
        last_id = 0

        while True:
            stmt = (
                select(Policy)
                .where(Policy.is_active == True, Policy.id > last_id)  # noqa: E712
                .options(selectinload(Policy.device))
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

                src_count = len(split_tokens(policy.source))
                dst_count = len(split_tokens(policy.destination))

                if max(src_count, dst_count) < min_count:
                    continue

                rows.append(row_from_policy(policy, src_count, dst_count))

            db.expunge_all()
            print(f"-- {total_scanned}건 스캔, 지금까지 {len(rows)}건 매치 --")

        def sort_key(row: dict):
            if sort_by == "source":
                return row["source_count"]
            if sort_by == "destination":
                return row["destination_count"]
            if sort_by == "total":
                return row["source_count"] + row["destination_count"]
            return max(row["source_count"], row["destination_count"])

        rows.sort(key=sort_key, reverse=True)
        if top:
            rows = rows[:top]

        print(f"\n조회된 정책(is_active=True) 총: {total_scanned}건")
        print(f"객체수 >= {min_count} 매치: {len(rows)}건 (정렬 기준: {sort_by})\n")
        print(f"{'장비명':<20} {'정책명':<30} {'출발지수':>8} {'목적지수':>8}")
        for r in rows:
            print(f"{str(r['device']):<20} {str(r['rule_name']):<30} {r['source_count']:>8} {r['destination_count']:>8}")

        if csv_path:
            with open(csv_path, 'w', newline='', encoding='utf-8-sig') as f:
                writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
                writer.writeheader()
                writer.writerows(rows)
            print(f"\nCSV 저장: {csv_path}")


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--min-count', type=int, default=10, help='출발지/목적지 객체수 최소 임계치 (기본 10)')
    parser.add_argument('--top', type=int, default=0, help='상위 N건만 출력 (0이면 전체, 기본 0)')
    parser.add_argument('--device-id', type=int, default=None, help='특정 장비만 조회 (미지정 시 전체 연동 장비)')
    parser.add_argument('--sort-by', choices=['max', 'source', 'destination', 'total'], default='max', help='정렬 기준 (기본 max)')
    parser.add_argument('--csv', type=str, default=None, help='CSV 저장 경로')
    parser.add_argument('--batch-size', type=int, default=500, help='한 번에 조회할 정책 개수 (기본 500)')
    args = parser.parse_args()

    asyncio.run(main(args.min_count, args.top, args.device_id, args.sort_by, args.csv, args.batch_size))
