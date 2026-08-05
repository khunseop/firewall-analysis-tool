from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app import crud, schemas
from app.core.auth import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.services.policy_builder import object_gap
from app.services.policy_builder.cli_generator import (
    generate_address_object_command,
    generate_move_command,
    generate_policy_set_command,
    generate_service_object_command,
)
from app.services.policy_builder.insertion_analyzer import analyze_insertion
from app.services.policy_builder.virtual_policy import resolve_virtual_policies

router = APIRouter()


async def _get_palo_alto_device(db: AsyncSession, device_id: int):
    device = await crud.device.get_device(db, device_id=device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    if (device.vendor or "").lower() != "paloalto":
        raise HTTPException(status_code=400, detail="이 기능은 Palo Alto 장비에서만 지원됩니다.")
    return device


@router.post("/{device_id}/object-gaps", response_model=schemas.ObjectGapCheckResponse)
async def check_object_gaps(
    device_id: int,
    request: schemas.ObjectGapCheckRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """
    신규 정책들이 참조하는 주소/서비스 오브젝트 중 장비 DB에 아직 없는 것을 찾습니다.
    """
    await _get_palo_alto_device(db, device_id)
    missing_objects = await object_gap.find_missing_objects(db, device_id, request.new_policies)
    return schemas.ObjectGapCheckResponse(missing_objects=missing_objects)


@router.post("/{device_id}/plan", response_model=schemas.BulkPolicyPlanResponse)
async def plan_bulk_policy(
    device_id: int,
    request: schemas.BulkPolicyPlanRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """
    신규 정책 대량 생성 요청을 받아 (1) 부족한 오브젝트 생성 CLI, (2) 정책 생성 CLI,
    (3) 목표 위치로 이동하는 CLI를 생성하고, 삽입 시 충돌 여부와 최종 배치 미리보기를 반환합니다.
    """
    await _get_palo_alto_device(db, device_id)

    all_missing_objects = await object_gap.find_missing_objects(db, device_id, request.new_policies)
    filled_keys = {f"{obj.object_kind}:{obj.name}" for obj in request.new_objects}
    # 사용자가 값을 입력한 신규 오브젝트는 잔여 갭에서 제외 — object_commands가 이미 그 생성 CLI를 담당
    missing_objects = [item for item in all_missing_objects if f"{item.object_kind}:{item.name}" not in filled_keys]

    warnings = []
    object_commands = []
    for obj in request.new_objects:
        if obj.object_kind == "address":
            command, error = generate_address_object_command(obj, request.vsys)
        else:
            command, error = generate_service_object_command(obj, request.vsys)
        object_commands.append(schemas.GeneratedCommand(row_index=0, kind="object", command=command, error=error))

    if missing_objects:
        warnings.append(
            f"아직 값이 입력되지 않은 신규 오브젝트가 {len(missing_objects)}건 있습니다 — "
            "정책 생성 CLI가 존재하지 않는 오브젝트를 참조할 수 있습니다."
        )

    policy_commands = []
    for row in request.new_policies:
        command, error, counts = generate_policy_set_command(row, request.vsys)
        policy_commands.append(schemas.GeneratedCommand(
            row_index=row.row_index, kind="policy", command=command, error=error, counts=counts or None,
        ))

    try:
        virtual_policies = await resolve_virtual_policies(db, device_id, request.new_policies, request.new_objects)
        conflicts, preview_before, preview_after, insertion_warnings = await analyze_insertion(
            db, device_id, virtual_policies, request.move_target,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    warnings.extend(insertion_warnings)

    reference_rule_name = None
    if request.move_target.reference_policy_id is not None:
        reference_policy = await crud.policy.get_policy(db, policy_id=request.move_target.reference_policy_id)
        if not reference_policy:
            raise HTTPException(status_code=400, detail=f"기준 정책 ID {request.move_target.reference_policy_id}를 찾을 수 없습니다.")
        reference_rule_name = reference_policy.rule_name

    move_commands = []
    for row in request.new_policies:
        command, error = generate_move_command(row.rule_name, request.move_target, reference_rule_name, request.vsys)
        move_commands.append(schemas.GeneratedCommand(row_index=row.row_index, kind="move", command=command, error=error))

    return schemas.BulkPolicyPlanResponse(
        missing_objects=missing_objects,
        object_commands=object_commands,
        policy_commands=policy_commands,
        move_commands=move_commands,
        conflicts=conflicts,
        preview_before=preview_before,
        preview_after=preview_after,
        warnings=warnings,
    )
