import pandas as pd
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import Any, List

from app import schemas


def normalize_last_hit_value(value: Any) -> datetime | None:
    """
    Robustly normalize any vendor-provided last-hit value to a timezone-naive
    Python datetime object (in Asia/Seoul timezone) or None.

    This function is designed to handle various inputs including strings,
    numeric timestamps, pandas Timestamps, NaT, and None, and guarantees
    that the output is *always* either a standard Python datetime or None.
    """
    if value in (None, "", "-") or pd.isna(value):
        return None

    try:
        # Attempt to convert to a pandas Timestamp, which handles many formats.
        # errors='coerce' will turn unparseable formats into NaT.
        ts = pd.to_datetime(value, errors="coerce")

        # If conversion results in NaT (Not a Time), it's an invalid date.
        if pd.isna(ts):
            return None

        # Convert numeric timestamps (e.g., milliseconds from Java/JS).
        # A simple numeric check isn't enough, as '20230101' could be parsed as a number.
        # pd.to_datetime handles most reasonable formats, but we can add specific numeric handling if needed.
        # For now, we trust pd.to_datetime and then ensure it's a python object.

        # Ensure the final output is a python datetime object, not a pandas Timestamp.
        py_dt = ts.to_pydatetime()

        # If timezone information is present, convert to Asia/Seoul and make it naive.
        if py_dt.tzinfo:
            py_dt = py_dt.astimezone(ZoneInfo("Asia/Seoul")).replace(tzinfo=None)

        return py_dt

    except (ValueError, TypeError):
        # Catch any other unexpected conversion errors.
        return None


def coerce_timestamp_to_py_datetime(value: Any) -> Any:
    """Ensure pandas Timestamp is converted to native python datetime."""
    try:
        import pandas as _pd
        if _pd.isna(value):  # Handle NaT
            return None
        if isinstance(value, _pd.Timestamp):
            return value.to_pydatetime()
    except Exception:
        pass
    return value


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
            if v is None:
                return None
            if isinstance(v, bool):
                return v

            # 정수/실수 타입 처리: 1 또는 1.0만 True로 간주
            if isinstance(v, int):
                return v == 1
            if isinstance(v, float):
                return v == 1.0

            # 문자열 타입 처리
            try:
                s = str(v).strip().lower()
            except Exception:
                return None  # 변환 불가 시 None 반환

            if s in {"y", "yes", "true", "1", "on", "enabled"}:
                return True
            if s in {"n", "no", "false", "0", "off", "disabled"}:
                return False

            # 그 외의 모든 경우는 정의되지 않은 상태로 처리
            return None
        df["enable"] = df["enable"].apply(_to_bool)

    # 3) Policy-specific fixes
    if "rule_name" in df.columns or "rule name" in df.columns:
        if "rule name" in df.columns and "rule_name" not in df.columns:
            df = df.rename(columns={"rule name": "rule_name"})
        if "last_hit_date" in df.columns:
            df["last_hit_date"] = df["last_hit_date"].apply(normalize_last_hit_value)
        if "rule_name" in df.columns:
            def _normalize_rule_name(v):
                try:
                    if v is None:
                        return None
                    s = str(v).strip()
                    if s == "" or s.lower() in {"nan", "none", "-"}:
                        return None
                    return s
                except Exception:
                    return None
            df["rule_name"] = df["rule_name"].apply(_normalize_rule_name)
            df = df[df["rule_name"].notna()]

    # 4) Preserve raw numeric fields in sync stage
    if pydantic_model is schemas.ServiceCreate and not df.empty and "protocol" in df.columns:
        df["protocol"] = df["protocol"].apply(lambda x: str(x).lower() if x is not None else x)

    if not df.empty:
        df = df.where(pd.notna(df), None)
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
        if value is None:
            return None
        if isinstance(value, str):
            s = value.strip()
            return None if s == "" else s
        if isinstance(value, float) and (value != value):  # NaN check
            return None
        return value
    except Exception:
        return value


def normalize_bool(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int,)):
        if value == 0:
            return False
        if value == 1:
            return True
    if isinstance(value, float):
        if value == 0.0:
            return False
        if value == 1.0:
            return True
    try:
        s = str(value).strip().lower()
    except Exception:
        return None
    if s in {"y", "yes", "true", "1", "on", "enabled"}:
        return True
    if s in {"n", "no", "false", "0", "off", "disabled"}:
        return False
    return None
