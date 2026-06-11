"""
태스크 입력 파일 자동 리졸버.

프로젝트 파일 맵 (task_id, slot) → DeletionWorkflowFile 에서
각 태스크에 필요한 입력 파일을 자동으로 조합합니다.
"""

from typing import Dict, List, Optional, Tuple

from app.models.deletion_workflow import DeletionWorkflowFile


class MissingInputError(Exception):
    """필수 입력 파일이 존재하지 않을 때 발생"""


# (task_id, slot): (source_task_id, source_slot) 매핑
# None → 외부 업로드 파일 (external_1 / external_2)
# "vendor" → 벤더 선택 로직 필요
TASK_INPUT_MAP: Dict[int, List] = {
    # task_id: [(source_task_id, source_slot, required), ...]
    # required=False → 없어도 실행 가능
    1:  [(0, "output_0", True)],
    2:  [(1, "output_0", True)],
    3:  [(1, "output_0", True), (3, "external_1", True)],   # external_1 = MIS CSV
    4:  [(4, "external_1", True)],                           # external_1 = GSAMS Excel
    5:  [(3, "output_0", True), (4, "output_0", True)],
    6:  [(5, "output_0", True)],                             # paloalto 전용
    7:  [(5, "output_0", True)],                             # secui 전용
    8:  [(8, "external_0", True), ("vendor", "output_0", True)],  # external_0 = 중복분석, vendor = 6 or 7
    9:  [("vendor", "output_0", True), (8, "output_1", True)],
    10: [(0, "output_0", True), (10, "external_1", False)],  # external_1 = HA Secondary (선택)
    11: [(9, "output_0", True), (10, "output_0", False)],    # task_10 없으면 task_0 폴백
    12: [(11, "output_0", True), (8, "output_1", True)],
    13: [(12, "output_0", True)],
    14: [(4, "output_0", True)],
}


def _vendor_task_id(vendor: str) -> int:
    """벤더에 따라 6(paloalto) 또는 7(secui/mf2) 반환"""
    if vendor and vendor.lower() == "paloalto":
        return 6
    return 7


def resolve_inputs(
    task_id: int,
    project_files: Dict[Tuple[int, str], DeletionWorkflowFile],
    vendor: str,
) -> List[Tuple[bytes, str]]:
    """
    태스크 입력 파일 목록을 반환합니다.

    Args:
        task_id: 실행할 태스크 번호
        project_files: {(task_id, slot): DeletionWorkflowFile}
        vendor: 장비 벤더 (paloalto / secui / mf2 / ...)

    Returns:
        [(file_bytes, filename), ...] — workspace_runner 에 전달할 순서대로

    Raises:
        MissingInputError: 필수 입력 파일 누락
    """
    vt = _vendor_task_id(vendor)
    specs = TASK_INPUT_MAP.get(task_id)
    if not specs:
        return []

    result: List[Tuple[bytes, str]] = []

    for source_task_id, source_slot, required in specs:
        if source_task_id == "vendor":
            # 벤더별 태스크 출력을 사용
            key = (vt, source_slot)
        else:
            key = (source_task_id, source_slot)

        f = project_files.get(key)

        if f is None:
            # task_11 의 task_10 폴백 처리
            if task_id == 11 and source_task_id == 10 and not required:
                f = project_files.get((0, "output_0"))
            # task_10 의 HA Secondary 선택사항
            elif not required:
                continue

        if f is None:
            if required:
                raise MissingInputError(
                    f"Task {task_id} 실행에 필요한 파일이 없습니다: task {source_task_id} / {source_slot}"
                )
            continue

        result.append((f.file_data, f.filename))

    return result


def get_vendor_task_id(vendor: str) -> int:
    return _vendor_task_id(vendor)
