"""
임시 스크립트: 특정 장비의 정책/객체에서 "동일한 값" 중복을 검사.

두 가지를 검사합니다.
1) 정책 필드 내 중복: 한 정책의 Source/Destination/Service 필드 안에 같은 토큰이
   두 번 이상 나열된 경우 (예: "Host_1, Host_1, Host_2") — 입력 오류/청소 대상
2) 객체 값 중복: 이름은 다르지만 실제 값(IP 범위, 프로토콜/포트)이 동일한
   NetworkObject / Service 객체 — 중복 정의된 객체 (그룹 객체는 검사 대상 아님)

실행 (프로젝트 루트에서):
    python backend/scripts/find_duplicate_values.py --device-name "NGF-FW-01" [--csv-prefix out]
"""
import argparse
import asyncio
import csv
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.db.session import SessionLocal
from app.models import Device, Policy, NetworkObject, Service


def split_tokens(value: str) -> list[str]:
    if not value:
        return []
    return [t.strip() for t in value.split(',') if t.strip()]


async def find_device(db, device_name: str) -> Device | None:
    result = await db.execute(select(Device).where(Device.name == device_name))
    device = result.scalar_one_or_none()
    if device:
        return device

    # 정확히 일치하는 게 없으면 후보 이름을 보여줌
    result = await db.execute(select(Device.name).where(Device.name.ilike(f"%{device_name}%")))
    candidates = [row[0] for row in result.all()]
    if candidates:
        print(f"'{device_name}' 장비를 찾을 수 없습니다. 혹시 이 중 하나인가요?: {candidates}")
    else:
        print(f"'{device_name}' 장비를 찾을 수 없고, 유사한 이름도 없습니다.")
    return None


async def check_policy_field_duplicates(db, device: Device) -> list[dict]:
    """정책 하나의 Source/Destination/Service 필드 안에서 같은 토큰이 중복 나열된 경우를 찾는다."""
    result = await db.execute(
        select(Policy).where(Policy.device_id == device.id, Policy.is_active == True)  # noqa: E712
    )
    policies = result.scalars().all()

    rows = []
    for policy in policies:
        for field_name, raw_value in [
            ("source", policy.source),
            ("destination", policy.destination),
            ("service", policy.service),
        ]:
            tokens = split_tokens(raw_value)
            seen = defaultdict(int)
            for t in tokens:
                seen[t] += 1
            dups = [t for t, cnt in seen.items() if cnt > 1]
            for t in dups:
                rows.append({
                    "rule_name": policy.rule_name,
                    "seq": policy.seq,
                    "field": field_name,
                    "duplicated_value": t,
                    "count": seen[t],
                    "raw_field_value": raw_value,
                })
    return rows


async def check_network_object_duplicates(db, device: Device) -> list[dict]:
    """이름은 다르지만 같은 IP 범위를 가리키는 NetworkObject를 찾는다."""
    result = await db.execute(
        select(NetworkObject).where(NetworkObject.device_id == device.id, NetworkObject.is_active == True)  # noqa: E712
    )
    objects = result.scalars().all()

    groups: dict[tuple, list[NetworkObject]] = defaultdict(list)
    for obj in objects:
        if obj.ip_start is not None and obj.ip_end is not None:
            key = ("ip", obj.ip_start, obj.ip_end)
        else:
            # ip_start/ip_end가 없는 경우(fqdn 등) 원본 문자열로 비교
            key = ("raw", (obj.type or "").lower(), (obj.ip_address or "").strip().lower())
        groups[key].append(obj)

    rows = []
    for key, objs in groups.items():
        names = sorted({o.name for o in objs})
        if len(names) <= 1:
            continue
        for o in objs:
            rows.append({
                "name": o.name,
                "value": o.ip_address,
                "type": o.type,
                "duplicate_group_names": ", ".join(names),
            })
    return rows


async def check_service_duplicates(db, device: Device) -> list[dict]:
    """이름은 다르지만 같은 프로토콜/포트를 가리키는 Service를 찾는다."""
    result = await db.execute(
        select(Service).where(Service.device_id == device.id, Service.is_active == True)  # noqa: E712
    )
    services = result.scalars().all()

    groups: dict[tuple, list[Service]] = defaultdict(list)
    for svc in services:
        if svc.port_start is not None and svc.port_end is not None:
            key = ("port", (svc.protocol or "").lower(), svc.port_start, svc.port_end)
        else:
            key = ("raw", (svc.protocol or "").lower(), (svc.port or "").strip().lower())
        groups[key].append(svc)

    rows = []
    for key, svcs in groups.items():
        names = sorted({s.name for s in svcs})
        if len(names) <= 1:
            continue
        for s in svcs:
            rows.append({
                "name": s.name,
                "protocol": s.protocol,
                "port": s.port,
                "duplicate_group_names": ", ".join(names),
            })
    return rows


def write_csv(path: str, rows: list[dict]):
    if not rows:
        return
    with open(path, 'w', newline='', encoding='utf-8-sig') as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


async def main(device_name: str, csv_prefix: str | None):
    async with SessionLocal() as db:
        device = await find_device(db, device_name)
        if not device:
            return

        print(f"장비: {device.name} (id={device.id})\n")

        policy_dups = await check_policy_field_duplicates(db, device)
        print(f"[1] 정책 필드 내 중복 토큰: {len(policy_dups)}건")
        for r in policy_dups:
            print(f"  {r['rule_name']} (seq={r['seq']}) [{r['field']}] '{r['duplicated_value']}' x{r['count']} | 원본: {r['raw_field_value']}")

        net_dups = await check_network_object_duplicates(db, device)
        print(f"\n[2] 네트워크 객체 값 중복: {len(net_dups)}건 (그룹 수 기준 아님, 개별 객체 행 수)")
        for r in net_dups:
            print(f"  {r['name']} = {r['value']} ({r['type']}) | 동일 그룹: {r['duplicate_group_names']}")

        svc_dups = await check_service_duplicates(db, device)
        print(f"\n[3] 서비스 객체 값 중복: {len(svc_dups)}건")
        for r in svc_dups:
            print(f"  {r['name']} = {r['protocol']}/{r['port']} | 동일 그룹: {r['duplicate_group_names']}")

        if csv_prefix:
            write_csv(f"{csv_prefix}_policy_field_dups.csv", policy_dups)
            write_csv(f"{csv_prefix}_network_object_dups.csv", net_dups)
            write_csv(f"{csv_prefix}_service_dups.csv", svc_dups)
            print(f"\nCSV 저장: {csv_prefix}_policy_field_dups.csv / _network_object_dups.csv / _service_dups.csv")


if __name__ == '__main__':
    arg_parser = argparse.ArgumentParser()
    arg_parser.add_argument('--device-name', type=str, required=True, help='검사할 장비 이름 (정확히 일치)')
    arg_parser.add_argument('--csv-prefix', type=str, default=None, help='CSV 저장 경로 접두사 (예: out -> out_policy_field_dups.csv 등)')
    args = arg_parser.parse_args()

    asyncio.run(main(args.device_name, args.csv_prefix))
