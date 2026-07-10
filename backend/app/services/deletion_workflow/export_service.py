"""FAT DB 데이터를 fpat 호환 Excel(bytes)로 변환하는 서비스 로직.

엔드포인트(deletion_workflow.py)에서 분리된 DB 조회 → DataFrame → xlsx 변환부.
"""
import asyncio
import datetime
import io
import logging
from typing import Tuple

import pandas as pd
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import crud
from app.models.policy import Policy
from app.models.network_object import NetworkObject
from app.models.network_group import NetworkGroup
from app.models.service import Service
from app.models.service_group import ServiceGroup
from app.models.analysis import AnalysisTask, AnalysisTaskType, AnalysisTaskStatus


logger = logging.getLogger(__name__)


class ExportDataError(ValueError):
    """내보낼 데이터가 없을 때 발생합니다 (엔드포인트에서 404로 매핑)."""


def df_to_xlsx_bytes(sheets: dict) -> bytes:
    """sheets = {sheet_name: DataFrame} → in-memory xlsx bytes (동기 — executor에서 호출)."""
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        for sheet_name, df in sheets.items():
            if df is not None and not df.empty:
                df.to_excel(writer, sheet_name=sheet_name, index=False)
    return buf.getvalue()


async def build_device_export(
    db: AsyncSession, device, reference_date: datetime.date = None
) -> Tuple[bytes, str]:
    """장비의 정책/객체/사용이력을 fpat 호환 xlsx로 변환합니다.

    반환: (xlsx bytes, 파일명). 동기화된 정책이 없으면 ExportDataError.
    """
    device_id = device.id

    policies_result = await db.execute(
        select(Policy)
        .filter(Policy.device_id == device_id, Policy.is_active == True)
        .order_by(Policy.vsys, Policy.seq)
    )
    policies = policies_result.scalars().all()
    if not policies:
        raise ExportDataError(
            f"장비 {device.name}에 동기화된 정책 데이터가 없습니다. 먼저 동기화를 실행하세요."
        )

    today = reference_date or datetime.date.today()
    policy_rows = [{
        "Vsys": p.vsys, "Seq": p.seq, "Rule Name": p.rule_name,
        "Enable": "Y" if p.enable else "N", "Action": p.action, "Source": p.source,
        "User": p.user, "Destination": p.destination, "Service": p.service,
        "Application": p.application, "Security Profile": p.security_profile,
        "Category": p.category, "Description": p.description,
    } for p in policies]

    # usage 시트 (last_hit_date → Last Hit Date + Unused Days)
    usage_rows = [{
        "Vsys": p.vsys,
        "Rule Name": p.rule_name,
        "Last Hit Date": p.last_hit_date.strftime("%Y-%m-%d") if p.last_hit_date else None,
        "Unused Days": (today - p.last_hit_date.date()).days if p.last_hit_date else None,
    } for p in policies]

    addr_result = await db.execute(
        select(NetworkObject).filter(NetworkObject.device_id == device_id, NetworkObject.is_active == True)
    )
    address_rows = [{"Name": o.name, "Type": o.type, "IP Address": o.ip_address, "Description": o.description}
                    for o in addr_result.scalars().all()]

    ag_result = await db.execute(
        select(NetworkGroup).filter(NetworkGroup.device_id == device_id, NetworkGroup.is_active == True)
    )
    ag_rows = [{"Group Name": g.name, "Entry": g.members, "Description": g.description}
               for g in ag_result.scalars().all()]

    svc_result = await db.execute(
        select(Service).filter(Service.device_id == device_id, Service.is_active == True)
    )
    svc_rows = [{"Name": s.name, "Protocol": s.protocol, "Port": s.port, "Description": s.description}
                for s in svc_result.scalars().all()]

    sg_result = await db.execute(
        select(ServiceGroup).filter(ServiceGroup.device_id == device_id, ServiceGroup.is_active == True)
    )
    sg_rows = [{"Group Name": g.name, "Entry": g.members, "Description": g.description}
               for g in sg_result.scalars().all()]

    sheets = {"policy": pd.DataFrame(policy_rows), "usage": pd.DataFrame(usage_rows)}
    if address_rows:
        sheets["address"] = pd.DataFrame(address_rows)
    if ag_rows:
        sheets["address_group"] = pd.DataFrame(ag_rows)
    if svc_rows:
        sheets["service"] = pd.DataFrame(svc_rows)
    if sg_rows:
        sheets["service_group"] = pd.DataFrame(sg_rows)

    content = await asyncio.get_running_loop().run_in_executor(None, lambda: df_to_xlsx_bytes(sheets))
    filename = f"{today.strftime('%Y-%m-%d')}_{device.ip_address}_policy.xlsx"
    return content, filename


async def build_redundancy_export(db: AsyncSession, device_id: int, device) -> Tuple[bytes, str]:
    """FAT DB의 최신 중복 분석 결과를 fpat 호환 xlsx로 변환합니다.

    반환: (xlsx bytes, 파일명). 완료된 분석 결과가 없으면 ExportDataError.
    """
    result = await db.execute(
        select(AnalysisTask)
        .filter(
            AnalysisTask.device_id == device_id,
            AnalysisTask.task_type == AnalysisTaskType.REDUNDANCY,
            AnalysisTask.task_status == AnalysisTaskStatus.SUCCESS,
        )
        .order_by(AnalysisTask.completed_at.desc())
        .limit(1)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise ExportDataError(
            "FAT DB에 완료된 중복 분석 결과가 없습니다. 분석 → 중복 분석을 먼저 실행하세요."
        )

    redundancy_sets = await crud.analysis.get_redundancy_policy_sets_by_task(db=db, task_id=task.id)
    if not redundancy_sets:
        raise ExportDataError("중복 정책 데이터가 없습니다.")

    # policy_id가 가리키는 정책이 이후 동기화로 삭제/재생성되어 고아가 된 행이 있을 수 있다
    # (SQLite FK 미강제로 ondelete=CASCADE가 실제 동작하지 않음). 짝이 깨진 세트를 그대로
    # 내보내면 Upper/Lower 중 한쪽만 남는 것처럼 보이므로, 고아 행이 하나라도 있는
    # set_number는 세트 전체를 제외한다.
    orphaned_set_numbers = {rps.set_number for rps in redundancy_sets if rps.policy is None}
    if orphaned_set_numbers:
        logger.warning(
            f"Task {task.id}: 정책이 삭제/재생성되어 고아가 된 중복 세트 {len(orphaned_set_numbers)}건 "
            f"제외 (set_number={sorted(orphaned_set_numbers)})"
        )

    rows = []
    for rps in redundancy_sets:
        if rps.set_number in orphaned_set_numbers:
            continue
        p = rps.policy
        rows.append({
            "No": rps.set_number,
            "Type": rps.type.value,  # "UPPER" | "LOWER"
            "Vsys": p.vsys, "Seq": p.seq, "Rule Name": p.rule_name,
            "Enable": "Y" if p.enable else "N", "Action": p.action, "Source": p.source,
            "User": p.user, "Destination": p.destination, "Service": p.service,
            "Application": p.application, "Security Profile": p.security_profile,
            "Category": p.category, "Description": p.description,
        })

    if not rows:
        raise ExportDataError("중복 정책 행을 생성할 수 없습니다.")

    content = await asyncio.get_running_loop().run_in_executor(
        None, lambda: df_to_xlsx_bytes({"redundancy": pd.DataFrame(rows)})
    )

    today = datetime.date.today().strftime("%Y-%m-%d")
    device_ip = device.ip_address if device else str(device_id)
    filename = f"{today}_{device_ip}_redundancy.xlsx"
    return content, filename
