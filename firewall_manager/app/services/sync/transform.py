import pandas as pd
import numpy as np
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import Any, List

from app import schemas


def dataframe_to_pydantic(df: pd.DataFrame, pydantic_model):
    """Converts a Pandas DataFrame to a list of Pydantic models.

    - Normalizes column names to snake_case
    - Converts vendor-specific flags to expected types
    - Ensures critical keys (like policies.rule_name) are present and valid
    """
    # 1) Standardize columns
    df.columns = [col.lower().replace(" ", "_") for col in df.columns]
    df = df.rename(
        columns={
            "group_name": "name",
            "entry": "members",
            "value": "ip_address",
        }
    )

    # 2) Normalize enable to boolean when present
    if "enable" in df.columns:
        def _to_bool(v):
            if v is None: return None
            if isinstance(v, bool): return v
            if isinstance(v, int): return v == 1
            if isinstance(v, float): return v == 1.0
            try:
                s = str(v).strip().lower()
                if s in {"y", "yes", "true", "1", "on", "enabled"}: return True
                if s in {"n", "no", "false", "0", "off", "disabled"}: return False
            except Exception: return None
            return None
        df["enable"] = df["enable"].apply(_to_bool)

    # 3) Policy-specific fixes
    if "rule_name" in df.columns or "rule name" in df.columns:
        if "rule name" in df.columns and "rule_name" not in df.columns:
            df = df.rename(columns={"rule name": "rule_name"})
        if "last_hit_date" in df.columns:
            # UserWarning 해결: 숫자와 문자열을 분리하여 명시적으로 파싱
            numeric_hits = pd.to_numeric(df["last_hit_date"], errors='coerce')
            # 유효한 숫자 타임스탬프만 변환 (Unix timestamp)
            numeric_dates = pd.to_datetime(numeric_hits.dropna(), unit='s')

            # 숫자가 아닌 나머지 값들을 날짜 문자열로 파싱 (format='mixed' 추가)
            string_dates = pd.to_datetime(df.loc[numeric_hits.isna(), "last_hit_date"], errors='coerce', format='mixed')

            # 두 결과를 합쳐서 시리즈 s 생성
            s = pd.concat([numeric_dates, string_dates])

            # 타임존 표준화
            if s.dt.tz is None:
                s = s.dt.tz_localize(ZoneInfo("Asia/Seoul"), ambiguous='infer')
            else:
                s = s.dt.tz_convert(ZoneInfo("Asia/Seoul"))

            # 타임존 정보 제거 (naive)
            s = s.dt.tz_localize(None)

            # to_pydatetime() 호출을 제거하고, Timestamp 객체를 그대로 두어 최종 단계에서 처리
            df["last_hit_date"] = s

        if "rule_name" in df.columns:
            def _normalize_rule_name(v):
                try:
                    if v is None: return None
                    s = str(v).strip()
                    return s if s and s.lower() not in {"nan", "none", "-"} else None
                except Exception: return None
            df["rule_name"] = df["rule_name"].apply(_normalize_rule_name)
            df = df[df["rule_name"].notna()]

    # 4) Preserve raw numeric fields in sync stage
    if pydantic_model is schemas.ServiceCreate and not df.empty and "protocol" in df.columns:
        df["protocol"] = df["protocol"].apply(lambda x: str(x).lower() if x is not None else x)

    # 5) Ensure integer columns with potential missing values are handled correctly
    if "seq" in df.columns:
        df["seq"] = df["seq"].astype("Int64")

    # 6) Final processing: Convert all pandas missing values (NaN, NaT, NA) to None
    if not df.empty:
        # Using astype(object) on columns with mixed types can help, but a more robust
        # final sweep is to convert the entire dataframe before creating records.
        # This is the most reliable way to prevent `ValueError: cannot convert float NaN to integer`.
        df = df.astype(object).replace({pd.NA: None, pd.NaT: None, float('nan'): None})

    records = df.to_dict(orient="records") if not df.empty else []
    return [pydantic_model(**row) for row in records]


def get_singular_name(plural_name: str) -> str:
    if plural_name == "policies":
        return "policy"
    return plural_name[:-1]


def get_key_attribute(data_type: str) -> str:
    return "rule_name" if data_type == "policies" else "name"


def normalize_value(value: Any) -> Any:
    try:
        if value is None: return None
        if isinstance(value, str):
            s = value.strip()
            return None if s == "" else s
        if isinstance(value, float) and (value != value): return None # NaN check
        return value
    except Exception:
        return value


def normalize_bool(value: Any) -> Any:
    if value is None: return None
    if isinstance(value, bool): return value
    if isinstance(value, (int,)):
        if value == 0: return False
        if value == 1: return True
    if isinstance(value, float):
        if value == 0.0: return False
        if value == 1.0: return True
    try:
        s = str(value).strip().lower()
        if s in {"y", "yes", "true", "1", "on", "enabled"}: return True
        if s in {"n", "no", "false", "0", "off", "disabled"}: return False
    except Exception: return None
    return None
