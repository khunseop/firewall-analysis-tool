import json
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app import crud, schemas
from app.core.auth import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.services.analysis.common import load_active_policies_with_members
from app.services.policy_builder import object_gap
from app.services.policy_builder.cli_generator import (
    generate_address_object_command,
    generate_field_append_command,
    generate_field_delete_command,
    generate_move_command,
    generate_policy_set_command,
    generate_rule_delete_command,
    generate_service_object_command,
)
from app.services.policy_builder.insertion_analyzer import analyze_insertion
from app.services.policy_builder.virtual_policy import resolve_virtual_policies, wrap_existing_policy_as_virtual

router = APIRouter()


async def _get_palo_alto_device(db: AsyncSession, device_id: int):
    device = await crud.device.get_device(db, device_id=device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    if (device.vendor or "").lower() != "paloalto":
        raise HTTPException(status_code=400, detail="이 기능은 Palo Alto 장비에서만 지원됩니다.")
    return device


@router.get("/{device_id}/pending-changes", response_model=List[schemas.PendingPolicyChange])
async def list_pending_changes(
    device_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """Policies 편집모드에서 저장된 대기중 변경사항을 전체 조회합니다(새로고침 후 그리드 복원용)."""
    await _get_palo_alto_device(db, device_id)
    return await crud.pending_policy_change.get_by_device(db, device_id)


@router.post("/{device_id}/pending-changes", response_model=schemas.PendingPolicyChange)
async def add_pending_change(
    device_id: int,
    request: schemas.PendingPolicyChangeCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """편집모드에서의 생성/수정/삭제/이동 액션 1건을 대기중 변경사항으로 저장합니다."""
    await _get_palo_alto_device(db, device_id)
    return await crud.pending_policy_change.create(db, device_id, request, current_user.id)


@router.delete("/{device_id}/pending-changes/{change_id}", response_model=schemas.Msg)
async def remove_pending_change(
    device_id: int,
    change_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """대기중 변경사항 1건을 취소(삭제)합니다."""
    await _get_palo_alto_device(db, device_id)
    change = await crud.pending_policy_change.get_by_id(db, change_id)
    if not change or change.device_id != device_id:
        raise HTTPException(status_code=404, detail="변경사항을 찾을 수 없습니다.")
    await crud.pending_policy_change.delete_by_id(db, change)
    return {"msg": "삭제되었습니다."}


@router.delete("/{device_id}/pending-changes", response_model=schemas.Msg)
async def clear_pending_changes(
    device_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """장비의 모든 대기중 변경사항을 초기화합니다."""
    await _get_palo_alto_device(db, device_id)
    await crud.pending_policy_change.clear_by_device(db, device_id)
    return {"msg": "초기화되었습니다."}


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


async def _load_defaults(db: AsyncSession) -> dict:
    defaults_setting = await crud.settings.get_setting(db, "policy_builder_defaults")
    if not defaults_setting:
        return {}
    try:
        return json.loads(defaults_setting.value)
    except (ValueError, TypeError):
        return {}


async def _reference_rule_name(db: AsyncSession, reference_policy_id: Optional[int]) -> Optional[str]:
    if reference_policy_id is None:
        return None
    reference_policy = await crud.policy.get_policy(db, policy_id=reference_policy_id)
    if not reference_policy:
        raise HTTPException(status_code=400, detail=f"기준 정책 ID {reference_policy_id}를 찾을 수 없습니다.")
    return reference_policy.rule_name


@router.post("/{device_id}/plan", response_model=schemas.BulkPolicyPlanResponse)
async def plan_bulk_policy(
    device_id: int,
    request: schemas.BulkPolicyPlanRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """
    Policies 편집모드에서 저장된 모든 대기중 변경사항(생성/수정/삭제/이동)을 모아
    부족한 오브젝트 생성 CLI, 정책 생성/수정/삭제/이동 CLI를 만들고, 삽입·재배치 시
    충돌 여부와 배치 미리보기를 반환합니다.
    """
    await _get_palo_alto_device(db, device_id)
    vsys = request.vsys
    warnings: list = []

    changes = await crud.pending_policy_change.get_by_device(db, device_id)
    create_changes = [c for c in changes if c.change_type == "create"]
    object_changes = [c for c in changes if c.change_type == "new_object"]
    modify_changes = [c for c in changes if c.change_type == "modify"]
    delete_changes = [c for c in changes if c.change_type == "delete"]
    move_changes = [c for c in changes if c.change_type == "move"]

    # --- 신규 생성 (create) --- payload에는 NewPolicyRow 필드 + position/reference_policy_id가
    # 함께 들어있으므로, 후자는 제거하고 NewPolicyRow를 재구성한다.
    new_policies = []
    for i, c in enumerate(create_changes):
        row_fields = {k: v for k, v in c.payload.items() if k not in ("position", "reference_policy_id", "row_index")}
        new_policies.append(schemas.NewPolicyRow(**row_fields, row_index=i))

    new_objects = [schemas.NewObjectSpec(**c.payload) for c in object_changes]

    # 붙여넣은 정책명이 이미 존재하는 활성 정책과 겹치면, PAN-OS의 `set`은 신규 생성이 아니라
    # 기존 정책에 값을 append하는 것과 동일하다 — "새 위치로 삽입"이라는 개념 자체가 성립하지 않으므로
    # 삽입 충돌 검증/이동 명령 생성 대상에서 제외하고 경고로 알린다.
    existing_active_policies = await crud.policy.get_all_active_policies_by_device(db, device_id)
    existing_rule_names = {p.rule_name for p in existing_active_policies}
    duplicate_rule_names = {row.rule_name for row in new_policies if row.rule_name in existing_rule_names}
    for name in sorted(duplicate_rule_names):
        warnings.append(
            f"'{name}'은(는) 이미 존재하는 정책명입니다 — 이 이름으로 신규 생성하면 새 위치로 삽입되는 게 아니라 "
            "기존 정책에 값이 추가(append)됩니다. 위치 이동/삽입 충돌 검증 대상에서는 제외했습니다. "
            "정말 기존 정책을 수정하려는 것이라면 '정책 수정' 기능을, 위치를 옮기려는 것이라면 체크박스로 "
            "기존 정책을 선택해 '선택 이동'을 사용하세요."
        )
    insertable_policies = [row for row in new_policies if row.rule_name not in duplicate_rule_names]

    all_missing_objects = await object_gap.find_missing_objects(db, device_id, new_policies)
    # modify로 추가되는 토큰들도 갭 검사 대상에 포함
    modify_gap_rows = []
    for i, c in enumerate(modify_changes):
        diffs = c.payload or {}
        modify_gap_rows.append(schemas.NewPolicyRow(
            row_index=1000 + i, rule_name=f"modify-{c.id}",
            source=",".join(diffs.get("source", {}).get("added", [])),
            destination=",".join(diffs.get("destination", {}).get("added", [])),
            service=",".join(diffs.get("service", {}).get("added", [])),
        ))
    if modify_gap_rows:
        all_missing_objects += await object_gap.find_missing_objects(db, device_id, modify_gap_rows)

    filled_keys = {f"{obj.object_kind}:{obj.name}" for obj in new_objects}
    seen_missing_keys: set = set()
    missing_objects = []
    for item in all_missing_objects:
        key = f"{item.object_kind}:{item.name}"
        if key in filled_keys or key in seen_missing_keys:
            continue
        seen_missing_keys.add(key)
        missing_objects.append(item)

    object_commands = []
    for obj in new_objects:
        if obj.object_kind == "address":
            command, error = generate_address_object_command(obj, vsys)
        else:
            command, error = generate_service_object_command(obj, vsys)
        object_commands.append(schemas.GeneratedCommand(row_index=0, kind="object", command=command, error=error))

    if missing_objects:
        warnings.append(
            f"아직 값이 입력되지 않은 신규 오브젝트가 {len(missing_objects)}건 있습니다 — "
            "정책 생성 CLI가 존재하지 않는 오브젝트를 참조할 수 있습니다."
        )

    defaults = await _load_defaults(db)

    policy_commands = []
    for row in new_policies:
        command, error, counts = generate_policy_set_command(row, vsys, defaults)
        policy_commands.append(schemas.GeneratedCommand(
            row_index=row.row_index, kind="policy", command=command, error=error, counts=counts or None,
        ))

    conflicts: list = []
    preview_before: list = []
    preview_after: list = []

    # --- 신규 생성 배치의 삽입 위치 (모든 create 행이 같은 위치를 공유, 중복 정책명은 제외) ---
    move_commands = []
    if create_changes and insertable_policies:
        first_payload = create_changes[0].payload
        move_target = schemas.MoveTarget(
            position=first_payload.get("position", "bottom"),
            reference_policy_id=first_payload.get("reference_policy_id"),
        )
        try:
            virtual_policies = await resolve_virtual_policies(db, device_id, insertable_policies, new_objects)
            insertion_conflicts, insertion_before, insertion_after, insertion_warnings = await analyze_insertion(
                db, device_id, virtual_policies, move_target,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        conflicts += insertion_conflicts
        preview_before += insertion_before
        preview_after += insertion_after
        warnings.extend(insertion_warnings)

        reference_rule_name = await _reference_rule_name(db, move_target.reference_policy_id)
        for row in insertable_policies:
            command, error = generate_move_command(row.rule_name, move_target, reference_rule_name, vsys)
            move_commands.append(schemas.GeneratedCommand(row_index=row.row_index, kind="move", command=command, error=error))

    # --- 기존 정책 이동 (move) ---
    for c in move_changes:
        real_policies = await load_active_policies_with_members(db, device_id)
        target_policy = next((p for p in real_policies if p.id == c.target_policy_id), None)
        if not target_policy:
            warnings.append(f"이동 대상 정책(ID {c.target_policy_id})을 찾을 수 없어 건너뜁니다.")
            continue
        move_target = schemas.MoveTarget(
            position=c.payload.get("position", "bottom"),
            reference_policy_id=c.payload.get("reference_policy_id"),
        )
        try:
            virtual = wrap_existing_policy_as_virtual(target_policy)
            move_conflicts, move_before, move_after, move_warnings = await analyze_insertion(
                db, device_id, [virtual], move_target, exclude_policy_ids={target_policy.id},
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        conflicts += move_conflicts
        preview_before += move_before
        preview_after += move_after
        warnings.extend(move_warnings)

        reference_rule_name = await _reference_rule_name(db, move_target.reference_policy_id)
        command, error = generate_move_command(target_policy.rule_name, move_target, reference_rule_name, vsys)
        move_commands.append(schemas.GeneratedCommand(row_index=c.id, kind="move", command=command, error=error))

    # --- 기존 정책 수정 (modify: set append + delete) ---
    modify_commands = []
    for c in modify_changes:
        target_policy = await crud.policy.get_policy(db, policy_id=c.target_policy_id) if c.target_policy_id else None
        if not target_policy:
            warnings.append(f"수정 대상 정책(ID {c.target_policy_id})을 찾을 수 없어 건너뜁니다.")
            continue
        has_added_values = any((diff or {}).get("added") for diff in (c.payload or {}).values())
        if has_added_values:
            command, error, counts = generate_field_append_command(target_policy.rule_name, c.payload, vsys)
            modify_commands.append(schemas.GeneratedCommand(row_index=c.id, kind="modify", command=command, error=error, counts=counts or None))
        for field, diff in (c.payload or {}).items():
            for value in diff.get("removed", []):
                del_command, del_error = generate_field_delete_command(target_policy.rule_name, field, value, vsys)
                modify_commands.append(schemas.GeneratedCommand(row_index=c.id, kind="modify", command=del_command, error=del_error))

    # --- 기존 정책 삭제 (delete) ---
    delete_commands = []
    for c in delete_changes:
        target_policy = await crud.policy.get_policy(db, policy_id=c.target_policy_id) if c.target_policy_id else None
        if not target_policy:
            warnings.append(f"삭제 대상 정책(ID {c.target_policy_id})을 찾을 수 없어 건너뜁니다.")
            continue
        command, error = generate_rule_delete_command(target_policy.rule_name, vsys)
        delete_commands.append(schemas.GeneratedCommand(row_index=c.id, kind="delete", command=command, error=error))

    return schemas.BulkPolicyPlanResponse(
        missing_objects=missing_objects,
        object_commands=object_commands,
        policy_commands=policy_commands,
        move_commands=move_commands,
        modify_commands=modify_commands,
        delete_commands=delete_commands,
        conflicts=conflicts,
        preview_before=preview_before,
        preview_after=preview_after,
        warnings=warnings,
    )
