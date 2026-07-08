"""삭제 워크플로우 태스크 메타데이터."""
import os

# fpat.yaml 경로 (프로젝트 루트 기준)
_FPAT_YAML = os.path.abspath(os.path.join(
    os.path.dirname(__file__),    # services/deletion_workflow/
    '..', '..', '..', '..',       # → 프로젝트 루트
    'fpat', 'fpat.yaml'
))

# 태스크별 메타데이터 (태스크 ID = 위저드 실행 순번)
TASK_META = {
    # Phase 0
    1:  {"name": "히트카운트병합",        "input_count": 1, "description": "HA Primary + Secondary 히트카운트 병합 (선택)"},
    # Phase 1
    2:  {"name": "신청정보파싱",          "input_count": 1, "description": "정책 파일 신청정보 파싱"},
    4:  {"name": "중복결과신청정보파싱",  "input_count": 1, "description": "중복분석 결과 파일 신청정보 파싱"},
    5:  {"name": "MISID매핑",             "input_count": 2, "description": "정책 Excel + MIS CSV → MIS ID 추가"},
    6:  {"name": "신청번호추출",          "input_count": 1, "description": "고유 신청 ID 추출"},
    # Phase 2
    7:  {"name": "신청정보취합",          "input_count": 1, "description": "GSAMS 신청정보 취합"},
    8:  {"name": "신청정보매핑",          "input_count": 2, "description": "정책 Excel + GSAMS → 신청정보 매핑"},
    9:  {"name": "자동연장탐지",          "input_count": 1, "description": "자동연장 날짜 업데이트"},
    10: {"name": "예외처리_PaloAlto",     "input_count": 1, "description": "PaloAlto 정책 예외 분류"},
    11: {"name": "예외처리_SECUI",        "input_count": 1, "description": "SECUI/MF2 정책 예외 분류"},
    12: {"name": "사용이력반영",          "input_count": 2, "description": "예외처리 결과 + 히트카운트 → 사용이력 반영"},
    13: {"name": "하단최신정책검증",      "input_count": 1, "description": "하단 최신 정책 검증 및 분류"},
    14: {"name": "중복정책분류",          "input_count": 2, "description": "중복결과(파싱) + 예외처리 → 공지/삭제 분류"},
    15: {"name": "중복만료셋예외처리",    "input_count": 4, "description": "정책원본 + 중복정리/공지/삭제 파일 → 만료셋 예외 분류"},
    16: {"name": "중복정책상태업데이트",  "input_count": 2, "description": "예외처리 + 분류결과 → 중복여부 반영"},
    17: {"name": "중복예외반영",          "input_count": 2, "description": "중복상태 파일 + YAML(선택) → 중복 예외 반영"},
    18: {"name": "통보대상분류",          "input_count": 1, "description": "정책 Excel → 유형별 공지파일 생성"},
}


def fpat_yaml_path() -> str:
    """fpat.yaml 경로를 반환합니다. 없으면 빈 문자열 반환."""
    return _FPAT_YAML if os.path.exists(_FPAT_YAML) else ""
