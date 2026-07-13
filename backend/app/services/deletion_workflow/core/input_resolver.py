"""
태스크 입력 파일 자동 리졸버.

위저드 실행 순서 (태스크 ID = 실행 순번):

Phase 0 (데이터 추출):
  0  → DB 추출 (output_0: 정책+사용이력+객체 Excel)
  1  → task_0.output_0 + ext(선택): HA Secondary  (히트카운트 병합)

Phase 1:
  2  → task_0.output_0              (정책파일 신청정보 파싱)
  3  → task_0.output_0              (중복정책 분석 — FAT DB 자동)
  4  → task_3.output_0              (중복결과 신청정보 파싱)
  5  → task_2.output_0 + ext:MIS    (MIS ID 매핑, 선택 — CSV 없으면 스킵 가능)
  6  → task_5.output_0(or task_2.output_0) (신청번호 추출)

Phase 2 (위저드 순서):
  7  → ext:GSAMS                    (신청정보 가공)
  8  → task_5.output_0(or task_2.output_0) + task_7.output_0 (신청정보 매핑)
  9  → task_8.output_0 + task_7.output_0 (자동연장 탐지 + 날짜 업데이트)
  10/11 → task_9.output_0           (예외처리, 벤더 자동선택)
  12 → task_10or11.output_0 + task_1.output_0 (사용이력 반영)
  13 → task_12.output_0             (하단 최신정책 검증)
  14 → task_4.output_0 + task_13.output_0 (중복정책 분류)  ← 미사용여부 포함 정책 파일 사용
  15 → task_14.output_0 + task_13.output_0 (만료셋 예외처리)
  16 → task_13.output_0 + task_15.output_2(or task_14.output_2) (중복상태 업데이트)  ← 미사용여부 포함 정책 파일 사용
  17 → task_16.output_0 + task_15.output_3(or ext:yaml) (중복 예외 반영)
  18 → task_17.output_0             (통보대상 분류)

Phase 3:
  19 → task_18.output_N(장기미사용, 파일명으로 탐색) + task_14.output_1(삭제) +
       task_14.output_0(공지) + task_7.output_0(Conv) (자동연장예외파일 생성)
"""

from typing import Dict, List, Optional, Tuple

from app.models.deletion_workflow import DeletionWorkflowFile


class MissingInputError(Exception):
    """필수 입력 파일이 없을 때 발생"""


def _vendor_task_id(vendor: str) -> int:
    """paloalto → 10, 그 외 → 11"""
    return 10 if vendor and vendor.lower() == "paloalto" else 11


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
        task_id: 실행할 태스크 번호 (0-18 순번)
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

    # ── Phase 0 ──────────────────────────────────────────────────────────────
    if task_id == 1:
        # 히트카운트 병합: DB 추출 파일 + HA Secondary (선택)
        policy = _require(project_files, 0, "output_0", "DB 추출 파일")
        ha_sec = _get(project_files, 1, "external_1")  # 선택
        return collect(policy, ha_sec)

    # ── Phase 1 ──────────────────────────────────────────────────────────────
    if task_id == 2:
        # 정책파일 신청정보 파싱
        f = _require(project_files, 0, "output_0", "DB 추출 파일")
        return collect(f)

    if task_id == 4:
        # 중복결과 신청정보 파싱
        f = _require(project_files, 3, "output_0", "중복분석 결과 파일")
        return collect(f)

    if task_id == 5:
        # MIS ID 매핑: 정책 파싱 결과 + MIS CSV
        policy = _require(project_files, 2, "output_0", "정책 파싱 결과")
        mis    = _require(project_files, 5, "external_1", "MIS CSV 파일")
        return collect(policy, mis)

    if task_id == 6:
        # 신청번호 추출: MIS ID 매핑 결과 우선, 없으면(Task 5 스킵) task_2 결과로 대체
        f = _get(project_files, 5, "output_0") or _require(
            project_files, 2, "output_0", "정책 파싱 결과"
        )
        return collect(f)

    # ── Phase 2 ──────────────────────────────────────────────────────────────
    if task_id == 7:
        # 신청정보 가공: GSAMS Excel (외부)
        f = _require(project_files, 7, "external_1", "GSAMS Excel 파일")
        return collect(f)

    if task_id == 8:
        # 신청정보 매핑: 정책(MIS업데이트 결과 우선, 없으면 task_2 결과) + GSAMS
        policy = _get(project_files, 5, "output_0") or _require(
            project_files, 2, "output_0", "정책 파싱 결과"
        )
        gsams  = _require(project_files, 7, "output_0", "GSAMS 처리 결과")
        return collect(policy, gsams)

    if task_id == 9:
        # 자동연장 탐지 + 날짜 업데이트: 정책파일(task_8) + GSAMS conv(task_7)
        policy = _require(project_files, 8, "output_0", "신청정보 매핑 결과")
        gsams  = _require(project_files, 7, "output_0", "GSAMS 처리 결과")
        return collect(policy, gsams)

    if task_id in (10, 11):
        # 예외처리: task_9(자동연장 날짜 업데이트 결과)를 입력으로 사용
        f = _require(project_files, 9, "output_0", "자동연장 날짜 업데이트 결과")
        return collect(f)

    if task_id == 12:
        # 사용이력 반영: 예외처리 결과 + 사용이력 파일
        # external_1 수동 업로드 우선, 없으면 task1/task0 출력으로 fallback
        exc_file = _require(project_files, vt, "output_0", "예외처리 결과")
        hitcount = (
            _get(project_files, 12, "external_1")
            or _get(project_files, 1, "output_0")
            or _get(project_files, 0, "output_0")
        )
        if hitcount is None:
            raise MissingInputError("사용이력 파일이 없습니다. 수동 업로드하거나 Task 1 먼저 실행하세요.")
        return collect(exc_file, hitcount)

    if task_id == 13:
        # 하단 최신정책 검증
        f = _require(project_files, 12, "output_0", "사용이력 반영 결과")
        return collect(f)

    if task_id == 14:
        # 중복정책 분류: 중복결과(파싱) + 하단최신정책 검증 결과
        # task_13을 사용하는 이유: REQUEST_STATUS 조회에 필요한 컬럼이 보존되어 있으며,
        # 이후 Task 16 → 17 → 18 흐름과 동일한 정책 파일 기준을 유지하기 위함
        redundancy = _require(project_files, 4, "output_0", "중복결과 파싱 파일")
        policy     = _require(project_files, 13, "output_0", "하단최신정책 검증 결과")
        return collect(redundancy, policy)

    if task_id == 15:
        # 만료셋 예외처리: 정책원본 + 중복정리 + 중복공지 + 중복삭제
        # Task 14 출력 파일은 알파벳순 정렬: _공지(output_0) < _삭제(output_1) < _정리(output_2)
        policy_src = _require(project_files, 13, "output_0", "하단최신정책 검증 결과")
        summary    = _require(project_files, 14, "output_2", "중복정책 정리 결과")    # 정리 = output_2
        notice     = _get(project_files, 14, "output_0")                             # 공지 = output_0
        delete     = _get(project_files, 14, "output_1")                             # 삭제 = output_1
        files = [policy_src, summary]
        if notice: files.append(notice)
        if delete: files.append(delete)
        return [(f.file_data, f.filename) for f in files]

    if task_id == 16:
        # 중복정책 상태 업데이트
        # policy: task_13(미사용여부 포함) 사용 — task_10/11(예외처리 결과)에는 미사용여부가 없어
        # task_16 → 17 → 18 흐름에서 통보대상 분류(Task 18)가 미사용여부를 읽지 못하는 버그 수정
        # classify: task_15.output_2(만료셋 예외 분리된 정리 파일) 우선 사용.
        #   task_15 출력은 '중복정책정리' + '예외' 2개 시트 구조이며,
        #   pd.read_excel() 기본 동작(첫 시트만 읽기)으로 예외 행이 자동 제외된다.
        #   task_15 미실행 시 task_14.output_2(_정리 원본) fallback.
        policy   = _require(project_files, 13, "output_0", "하단최신정책 검증 결과")
        classify = (
            _get(project_files, 15, "output_2")
            or _require(project_files, 14, "output_2", "중복정책 정리 결과")
        )
        return collect(policy, classify)

    if task_id == 17:
        # 중복 예외 반영: 중복상태 업데이트 결과. 예외 목록은 Settings DB에서 직접 조회.
        policy = _require(project_files, 16, "output_0", "중복정책 상태 업데이트 결과")
        return collect(policy)

    if task_id == 18:
        # 통보대상 분류
        f = _require(project_files, 17, "output_0", "중복 예외 반영 결과")
        return collect(f)

    # ── Phase 3 ──────────────────────────────────────────────────────────────
    if task_id == 19:
        # 자동연장예외파일 생성: 장기미사용(18) + 중복삭제(14) + 중복공지(14) + Conv(7)
        # Task 18은 카테고리별 파일 개수가 가변적이므로 슬롯 인덱스 대신 파일명으로 탐색
        long_unused = None
        idx = 0
        while True:
            f = _get(project_files, 18, f"output_{idx}")
            if f is None:
                break
            if "장기미사용" in f.filename:
                long_unused = f
                break
            idx += 1
        if long_unused is None:
            raise MissingInputError("필수 파일 없음: Task 18 / 장기미사용정책(공지용) 파일")

        duplicate_notice = _require(project_files, 14, "output_0", "중복정책 공지 파일")
        duplicate_delete = _require(project_files, 14, "output_1", "중복정책 삭제 파일")
        conv = _require(project_files, 7, "output_0", "GSAMS 처리 결과(Conv)")
        return collect(long_unused, duplicate_delete, duplicate_notice, conv)

    return []


def get_vendor_task_id(vendor: str) -> int:
    return _vendor_task_id(vendor)
