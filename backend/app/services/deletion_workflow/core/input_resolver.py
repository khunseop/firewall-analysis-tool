"""
태스크 입력 파일 자동 리졸버.

위저드(workflow_wizard.py) 순서 기준:

Phase 1:
  0  → DB 추출 (output_0: 정책+사용이력+객체 Excel)
  1  → task_0.output_0              (정책파일 신청정보 파싱)
  17 → task_0.output_0              (중복정책 분석 — FAT DB 자동)
  19 → task_17.output_0             (중복결과 신청정보 파싱 = Task 1 second run)
  3  → task_1.output_0 + ext:MIS    (MIS ID 매핑)
  2  → task_3.output_0              (신청번호 추출)

Phase 2:
  4  → ext:GSAMS                    (신청정보 가공)
  5  → task_3.output_0 + task_4.output_0 (신청정보 매핑)
  15 → task_4.output_0              (자동연장 탐지)
  6/7→ task_5.output_0              (예외처리, 벤더 자동선택)
  13 → task_6or7.output_0 + task_12.output_0 (사용이력 반영)
  8  → task_13.output_0             (하단 최신정책 검증)
  9  → task_19.output_0 + task_6or7.output_0 (중복정책 분류)
  11 → task_9.output_0 (공지) + task_9.output_1 (삭제) (만료셋 예외처리)
       추가: task_13 or task_8 output (정책 원본)
  10 → task_6or7.output_0 + task_9.output_0 (중복상태 업데이트)
  18 → task_8.output_0 + ext:yaml   (중복 예외 반영)
  14 → task_8.output_0              (미사용 상태 업데이트)
  16 → task_14.output_0             (통보대상 분류)

히트카운트:
  12 → task_0.output_0 + ext(선택): HA Secondary  (히트카운트 병합)
"""

from typing import Dict, List, Optional, Tuple

from app.models.deletion_workflow import DeletionWorkflowFile


class MissingInputError(Exception):
    """필수 입력 파일이 없을 때 발생"""


def _vendor_task_id(vendor: str) -> int:
    """paloalto → 6, 그 외 → 7"""
    return 6 if vendor and vendor.lower() == "paloalto" else 7


def _get(
    files: Dict[Tuple[int, str], DeletionWorkflowFile],
    task_id: int,
    slot: str,
) -> Optional[DeletionWorkflowFile]:
    return files.get((task_id, slot))


def _require(
    files: Dict[Tuple[int, str], DeletionWorkflowFile],
    task_id: int,
    slot: str,
    label: str,
) -> DeletionWorkflowFile:
    f = _get(files, task_id, slot)
    if f is None:
        raise MissingInputError(f"필수 파일 없음: Task {task_id} / {slot} ({label})")
    return f


def resolve_inputs(
    task_id: int,
    project_files: Dict[Tuple[int, str], DeletionWorkflowFile],
    vendor: str,
) -> List[Tuple[bytes, str]]:
    """
    프로젝트 파일 맵에서 태스크 입력 파일 목록을 반환합니다.

    Args:
        task_id: 실행할 태스크 번호 (fpat 원본 기준)
        project_files: {(task_id, slot): DeletionWorkflowFile}
        vendor: 장비 벤더

    Returns:
        [(file_bytes, filename), ...] — workspace_runner에 전달할 순서

    Raises:
        MissingInputError: 필수 입력 파일 누락
    """
    vt = _vendor_task_id(vendor)

    def collect(*specs) -> List[Tuple[bytes, str]]:
        result = []
        for f in specs:
            if f is not None:
                result.append((f.file_data, f.filename))
        return result

    # ── Phase 1 ──────────────────────────────────────────────────────────────
    if task_id == 1:
        # 정책파일 신청정보 파싱
        f = _require(project_files, 0, "output_0", "DB 추출 파일")
        return collect(f)

    if task_id == 19:
        # 중복결과 신청정보 파싱 (Task 1 second run)
        f = _require(project_files, 17, "output_0", "중복분석 결과 파일")
        return collect(f)

    if task_id == 3:
        # MIS ID 매핑: 정책 파싱 결과 + MIS CSV
        policy = _require(project_files, 1, "output_0", "정책 파싱 결과")
        mis    = _require(project_files, 3, "external_1", "MIS CSV 파일")
        return collect(policy, mis)

    if task_id == 2:
        # 신청번호 추출
        f = _require(project_files, 3, "output_0", "MIS ID 업데이트 결과")
        return collect(f)

    # ── Phase 2 ──────────────────────────────────────────────────────────────
    if task_id == 4:
        # 신청정보 가공: GSAMS Excel (외부)
        f = _require(project_files, 4, "external_1", "GSAMS Excel 파일")
        return collect(f)

    if task_id == 5:
        # 신청정보 매핑: 정책(MIS업데이트) + GSAMS
        policy = _require(project_files, 3, "output_0", "MIS ID 업데이트 결과")
        gsams  = _require(project_files, 4, "output_0", "GSAMS 처리 결과")
        return collect(policy, gsams)

    if task_id == 15:
        # 자동연장 탐지
        f = _require(project_files, 4, "output_0", "GSAMS 처리 결과")
        return collect(f)

    if task_id in (6, 7):
        # 예외처리 (벤더 자동선택)
        f = _require(project_files, 5, "output_0", "신청정보 매핑 결과")
        return collect(f)

    if task_id == 12:
        # 히트카운트 병합: 정책파일 + HA Secondary (선택)
        policy = _require(project_files, 0, "output_0", "DB 추출 파일")
        ha_sec = _get(project_files, 12, "external_1")  # 선택
        return collect(policy, ha_sec)

    if task_id == 13:
        # 사용이력 반영: 예외처리 결과 + 히트카운트
        exc_file = _require(project_files, vt, "output_0", "예외처리 결과")
        hitcount = _get(project_files, 12, "output_0") or _get(project_files, 0, "output_0")
        if hitcount is None:
            raise MissingInputError("사용이력(hitcount) 파일이 없습니다.")
        return collect(exc_file, hitcount)

    if task_id == 8:
        # 하단 최신정책 검증
        f = _require(project_files, 13, "output_0", "사용이력 반영 결과")
        return collect(f)

    if task_id == 9:
        # 중복정책 분류: 중복결과(파싱) + 예외처리 결과
        redundancy = _require(project_files, 19, "output_0", "중복결과 파싱 파일")
        exc_file   = _require(project_files, vt, "output_0", "예외처리 결과")
        return collect(redundancy, exc_file)

    if task_id == 11:
        # 만료셋 예외처리: 정책원본 + 중복정리 + 중복공지 + 중복삭제
        policy_src = _require(project_files, 8, "output_0", "하단최신정책 검증 결과")
        summary    = _require(project_files, 9, "output_0", "중복정책 분류 결과(공지)")
        notice     = _get(project_files, 9, "output_1")
        delete     = _get(project_files, 9, "output_2")
        files = [policy_src, summary]
        if notice: files.append(notice)
        if delete: files.append(delete)
        return [(f.file_data, f.filename) for f in files]

    if task_id == 10:
        # 중복정책 상태 업데이트
        exc_file = _require(project_files, vt, "output_0", "예외처리 결과")
        classify = _require(project_files, 9, "output_0", "중복정책 분류 결과")
        return collect(exc_file, classify)

    if task_id == 14:
        # 미사용 상태 업데이트
        f = _require(project_files, 8, "output_0", "하단최신정책 검증 결과")
        return collect(f)

    if task_id == 18:
        # 중복 예외 반영: 정책파일 + YAML (선택)
        policy = _require(project_files, 14, "output_0", "미사용 상태 업데이트 결과")
        yaml_f = _get(project_files, 18, "external_1")
        return collect(policy, yaml_f)

    if task_id == 16:
        # 통보대상 분류
        f = _require(project_files, 14, "output_0", "미사용 상태 업데이트 결과")
        return collect(f)

    return []


def get_vendor_task_id(vendor: str) -> int:
    return _vendor_task_id(vendor)
