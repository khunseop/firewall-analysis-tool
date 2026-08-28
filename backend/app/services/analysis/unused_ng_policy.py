"""
"미사용 NG 정책" 분석 엔진.

다른 quick 분석 엔진(unused.py 등)과 달리 이 엔진은 FAT DB 조회만으로 끝나지 않고,
사용이력(hit_count/first_hit_date/last_hit_date/unused_days)을 얻기 위해 장비에
라이브로 접속한다(Devices 페이지 "직접 추출"과 동일한 벤더 컬렉터 사용, HA Peer 병합
포함). 벤더가 값을 채우지 못하면(NGF 등) 또는 매칭 실패 시 해당 셀은 '-'로 표시한다.

행 필터링은 하지 않는다 — 활성 정책 전량에 신청정보·사용이력·시작일/경과일·AD/NG
정책 여부 컬럼을 부가해 그대로 반환한다(미사용 판단은 사용자가 Excel에서 직접 함).
"""
import asyncio
import datetime
import logging
import re
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import crud
from app.core.executors import CPU_EXECUTOR, IO_EXECUTOR
from app.models import AnalysisTask
from app.models.policy import Policy
from app.services.deletion_workflow.config_bridge import load_config_dict
from app.services.deletion_workflow.core.config_manager import ConfigManager
from app.services.deletion_workflow.processors.request_parser import RequestParser
from app.services.sync.collector import create_collector_from_device

logger = logging.getLogger(__name__)

# Rule Name에서 시작일을 추출하는 패턴: F + 날짜 8자리(YYYYMMDD) + 일련번호 + "-"
# 예: "F20260827123-any" → "20260827"
_RULE_NAME_DATE_RE = re.compile(r'F(\d{8})\d+-')
_DEFAULT_START_DATE = datetime.date(1900, 1, 1)

# 사용이력 라이브 수집 타임아웃(초). Devices 페이지 "직접 추출" 다이얼로그의 기본값과 동일.
_USAGE_COLLECT_TIMEOUT = 600


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
    """RequestParser가 채운 Start Date 값을 date로 변환. 실패 시 1900-01-01."""
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
    """라이브 수집 결과의 컬럼명을 소문자로 정규화해 대소문자 불일치를 방어한다."""
    usage_df = usage_df.copy()
    usage_df.columns = [str(c).strip().lower() for c in usage_df.columns]
    return usage_df


def _sanitize(v: Any) -> Any:
    """pandas/numpy 스칼라를 jsonable_encoder가 다룰 수 있는 순수 파이썬 값으로 변환."""
    if isinstance(v, np.integer):
        return int(v)
    if isinstance(v, np.floating):
        return None if np.isnan(v) else float(v)
    if isinstance(v, float) and np.isnan(v):
        return None
    return v


def merge_and_enrich(
    policy_df: pd.DataFrame,
    usage_df: pd.DataFrame,
    reference_date: Optional[datetime.date],
) -> pd.DataFrame:
    """사용이력 병합 + 시작일/경과일 + AD/NG 정책여부 컬럼 추가."""
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
        df = df.merge(usage_subset.drop(columns=['rule_name']), on='__merge_key__', how='left')
        df = df.drop(columns=['__merge_key__'])
        for col in usage_cols.values():
            df[col] = df[col].fillna('-') if col in df.columns else '-'
    else:
        for col in usage_cols.values():
            df[col] = '-'

    # 2) 시작일 / 경과일 — End Date 다음 위치에 삽입
    start_dates, elapsed_days = [], []
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


async def _collect_usage_live(device, loop: asyncio.AbstractEventLoop) -> pd.DataFrame:
    """장비에 라이브 접속해 사용이력을 수집한다. Devices 페이지 "직접 추출"(hit_dates)과
    동일한 벤더 컬렉터를 사용하되, 파이프라인 실행 로직은 모듈 간 공통화하지 않는다는
    원칙에 따라 이 모듈 전용으로 독립 작성한다. HA Peer가 있으면 last_hit_date 기준
    최신값으로 병합한다. 벤더가 미지원이면(NGF 등) 빈/부분 DataFrame이 반환될 수 있다.
    """
    use_ssh = bool(device.use_ssh_for_last_hit_date)
    collector = create_collector_from_device(device)

    def _method():
        return collector.export_last_hit_date_ssh(timeout=_USAGE_COLLECT_TIMEOUT) if use_ssh else collector.export_last_hit_date()

    await loop.run_in_executor(IO_EXECUTOR, collector.connect)
    try:
        main_df = await asyncio.wait_for(
            loop.run_in_executor(IO_EXECUTOR, _method), timeout=_USAGE_COLLECT_TIMEOUT
        )
    finally:
        try:
            await loop.run_in_executor(IO_EXECUTOR, collector.disconnect)
        except Exception:
            pass

    if not device.ha_peer_ip:
        return main_df

    ha_collector = create_collector_from_device(device, use_ha_ip=True)
    ha_df: pd.DataFrame | None = None
    try:
        await loop.run_in_executor(IO_EXECUTOR, ha_collector.connect)

        def _ha_method():
            return ha_collector.export_last_hit_date_ssh(timeout=_USAGE_COLLECT_TIMEOUT) if use_ssh else ha_collector.export_last_hit_date()

        ha_df = await asyncio.wait_for(
            loop.run_in_executor(IO_EXECUTOR, _ha_method), timeout=_USAGE_COLLECT_TIMEOUT
        )
    except Exception as e:
        logger.warning(f"HA peer 사용이력 수집 실패 ({device.ha_peer_ip}): {e}")
    finally:
        try:
            await loop.run_in_executor(IO_EXECUTOR, ha_collector.disconnect)
        except Exception:
            pass

    if ha_df is None or ha_df.empty:
        return main_df

    combined = pd.concat([main_df, ha_df])
    if "last_hit_date" in combined.columns:
        combined["last_hit_date"] = pd.to_datetime(combined["last_hit_date"], errors="coerce")
        subset = ["vsys", "rule_name"] if "vsys" in combined.columns else ["rule_name"]
        combined = combined.sort_values("last_hit_date", ascending=False, na_position="last")
        combined = combined.drop_duplicates(subset=subset, keep="first")
    return combined


class UnusedNgPolicyAnalyzer:
    """미사용 NG 정책 분석: 활성 정책 전량 + 신청정보 + 사용이력 + AD/NG 여부를 부가한다."""

    def __init__(self, db_session: AsyncSession, task: AnalysisTask, reference_date: Optional[datetime.date] = None):
        self.db = db_session
        self.task = task
        self.device_id = task.device_id
        self.reference_date = reference_date

    async def _get_policies(self) -> List[Policy]:
        result = await self.db.execute(
            select(Policy)
            .where(Policy.device_id == self.device_id, Policy.is_active == True)
            .order_by(Policy.vsys, Policy.seq)
        )
        return result.scalars().all()

    async def analyze(self) -> List[Dict[str, Any]]:
        device = await crud.device.get_device(self.db, device_id=self.device_id)
        if not device:
            raise ValueError("장비를 찾을 수 없습니다.")

        policies = await self._get_policies()
        if not policies:
            raise ValueError("동기화된 정책 데이터가 없습니다. 먼저 동기화를 실행하세요.")

        policy_df = pd.DataFrame([{
            "Vsys": p.vsys, "Seq": p.seq, "Rule Name": p.rule_name,
            "Enable": "Y" if p.enable else "N", "Action": p.action, "Source": p.source,
            "User": p.user, "Destination": p.destination, "Service": p.service,
            "Application": p.application, "Security Profile": p.security_profile,
            "Category": p.category, "Description": p.description,
        } for p in policies])

        config_dict = await load_config_dict(self.db)
        loop = asyncio.get_event_loop()

        def _parse_step():
            parser = RequestParser(ConfigManager(config_dict=config_dict))
            df = policy_df.copy()
            for index, row in df.iterrows():
                result = parser.parse_request_info(row.get('Rule Name'), row.get('Description'))
                for key, value in result.items():
                    df.at[index, key] = value
            return df

        parsed_df = await loop.run_in_executor(CPU_EXECUTOR, _parse_step)

        usage_df = await _collect_usage_live(device, loop)

        def _merge_step():
            return merge_and_enrich(parsed_df, usage_df, self.reference_date)

        result_df = await loop.run_in_executor(CPU_EXECUTOR, _merge_step)

        return [{k: _sanitize(v) for k, v in row.items()} for row in result_df.to_dict('records')]
