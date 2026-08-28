""""미사용 NG 정책" 파이프라인의 순수 가공 로직.

②신청번호파싱은 deletion_workflow의 RequestParser.parse_request_info(순수 함수,
파일 I/O 없음)를 그대로 재사용한다. ④통합가공은 이 모듈 전용 신규 로직이다.
"""
import datetime
import re
from typing import Optional

import pandas as pd

from app.services.deletion_workflow.core.config_manager import ConfigManager
from app.services.deletion_workflow.processors.request_parser import RequestParser

# Rule Name에서 시작일을 추출하는 패턴: F + 날짜 8자리(YYYYMMDD) + 일련번호 + "-"
# 예: "F20260827123-any" → "20260827"
_RULE_NAME_DATE_RE = re.compile(r'F(\d{8})\d+-')

_DEFAULT_START_DATE = datetime.date(1900, 1, 1)


def parse_and_add_request_info(df: pd.DataFrame, config_dict: dict) -> pd.DataFrame:
    """②신청번호파싱: Rule Name/Description에서 신청정보를 추출해 컬럼을 추가한다.

    request_parser.py의 RequestParser.parse_request_info()를 그대로 재사용 —
    파일 입출력 없는 순수 함수이므로 FileManager/WorkspaceRunner 없이 직접 호출한다.
    """
    parser = RequestParser(ConfigManager(config_dict=config_dict))
    df = df.copy()

    for index, row in df.iterrows():
        result = parser.parse_request_info(row.get('Rule Name'), row.get('Description'))
        for key, value in result.items():
            df.at[index, key] = value

    return df


def _parse_rule_name_date(rule_name) -> datetime.date:
    """Rule Name에서 F(YYYYMMDD)... 패턴의 날짜를 추출. 실패 시 1900-01-01."""
    if not isinstance(rule_name, str):
        return _DEFAULT_START_DATE
    match = _RULE_NAME_DATE_RE.search(rule_name)
    if not match:
        return _DEFAULT_START_DATE
    try:
        return datetime.datetime.strptime(match.group(1), '%Y%m%d').date()
    except ValueError:
        return _DEFAULT_START_DATE


def _parse_start_date_column(value) -> datetime.date:
    """②단계가 채운 Start Date 컬럼 값(문자열 'YYYY-MM-DD' 등)을 date로 변환. 실패 시 1900-01-01."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return _DEFAULT_START_DATE
    try:
        parsed = pd.to_datetime(value)
        if pd.isnull(parsed):
            return _DEFAULT_START_DATE
        return parsed.date()
    except (ValueError, TypeError):
        return _DEFAULT_START_DATE


def _normalize_usage_columns(usage_df: pd.DataFrame) -> pd.DataFrame:
    """③업로드 파일의 컬럼명을 소문자로 정규화해 대소문자 불일치를 방어한다."""
    usage_df = usage_df.copy()
    usage_df.columns = [str(c).strip().lower() for c in usage_df.columns]
    return usage_df


def merge_and_enrich(
    policy_df: pd.DataFrame,
    usage_df: pd.DataFrame,
    reference_date: Optional[datetime.date],
) -> pd.DataFrame:
    """④통합가공: 사용이력 병합 + 시작일/경과일 + AD/NG 정책여부 컬럼 추가.

    행 필터링은 하지 않는다 — 입력된 정책을 전량 그대로 출력한다.
    """
    df = policy_df.copy()
    today = reference_date or datetime.date.today()

    # 1) 사용이력 병합 (Rule Name ↔ rule_name, 대소문자 정규화 후 매칭)
    usage = _normalize_usage_columns(usage_df)
    usage_cols = {
        'hit_count': 'Hit Count',
        'first_hit_date': 'First Hit Date',
        'last_hit_date': 'Last Hit Date',
        'unused_days': 'Unused Days',
    }
    available = [c for c in usage_cols if c in usage.columns]
    if 'rule_name' in usage.columns and available:
        usage_subset = usage[['rule_name'] + available].rename(columns=usage_cols)
        usage_subset = usage_subset.drop_duplicates(subset=['rule_name'])
        df['__merge_key__'] = df['Rule Name'].astype(str).str.strip()
        usage_subset['__merge_key__'] = usage_subset['rule_name'].astype(str).str.strip()
        df = df.merge(
            usage_subset.drop(columns=['rule_name']),
            on='__merge_key__', how='left',
        )
        df = df.drop(columns=['__merge_key__'])
    else:
        for col in usage_cols.values():
            df[col] = None

    # 2) 시작일 / 경과일 — End Date 다음 위치에 삽입
    start_dates = []
    elapsed_days = []
    for _, row in df.iterrows():
        from_rule_name = _parse_rule_name_date(row.get('Rule Name'))
        from_start_date = _parse_start_date_column(row.get('Start Date'))
        start_date = min(from_rule_name, from_start_date)
        start_dates.append(start_date.isoformat())
        elapsed_days.append((today - start_date).days)

    end_date_pos = df.columns.get_loc('End Date') + 1 if 'End Date' in df.columns else len(df.columns)
    df.insert(end_date_pos, '시작일', start_dates)
    df.insert(end_date_pos + 1, '경과일', elapsed_days)

    # 3) AD 정책 여부 / NG 정책 여부 — Action 다음 위치에 삽입
    def _ad_flag(user_value) -> str:
        return 'N' if isinstance(user_value, str) and 'any' in user_value else 'Y'

    def _ng_flag(source_value, dest_value) -> str:
        for v in (source_value, dest_value):
            if isinstance(v, str) and 'NG_' in v:
                return 'Y'
        return 'N'

    ad_flags = df.apply(lambda r: _ad_flag(r.get('User')), axis=1)
    ng_flags = df.apply(lambda r: _ng_flag(r.get('Source'), r.get('Destination')), axis=1)

    action_pos = df.columns.get_loc('Action') + 1 if 'Action' in df.columns else len(df.columns)
    df.insert(action_pos, 'AD 정책 여부', ad_flags)
    df.insert(action_pos + 1, 'NG 정책 여부', ng_flags)

    return df
