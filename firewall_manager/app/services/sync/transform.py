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

        if "rule_name" in df.columns:
            if "last_hit_date" in df.columns:
                def _parse_hit_date(v):
                    if v is None or pd.isna(v) or v == '-':
                        return None
                    try:
                        # Try parsing as a numeric timestamp first
                        dt = pd.to_datetime(v, unit='s', errors='raise')
                        # pandas Timestamp를 Python datetime으로 변환
                        return dt.to_pydatetime() if hasattr(dt, 'to_pydatetime') else dt
                    except (ValueError, TypeError):
                        try:
                            # Fallback to parsing as a date string
                            dt = pd.to_datetime(v, errors='coerce')
                            if pd.isna(dt):
                                return None
                            # pandas Timestamp를 Python datetime으로 변환
                            return dt.to_pydatetime() if hasattr(dt, 'to_pydatetime') else dt
                        except Exception:
                            return None
                df["last_hit_date"] = df["last_hit_date"].apply(_parse_hit_date)

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

    # 4b) Calculate ip_start and ip_end for network objects
    if pydantic_model is schemas.NetworkObjectCreate and not df.empty and "ip_address" in df.columns:
        from app.services.normalize import parse_ipv4_numeric
        def _parse_ip_numeric(ip_str):
            if pd.isna(ip_str) or ip_str is None:
                return (None, None, None)
            version, start, end = parse_ipv4_numeric(str(ip_str))
            return (version, start, end)
        
        ip_numeric = df["ip_address"].apply(_parse_ip_numeric)
        df["ip_version"] = ip_numeric.apply(lambda x: x[0])
        df["ip_start"] = ip_numeric.apply(lambda x: x[1])
        df["ip_end"] = ip_numeric.apply(lambda x: x[2])

    # 4c) Calculate port_start and port_end for services
    if pydantic_model is schemas.ServiceCreate and not df.empty and "port" in df.columns:
        from app.services.normalize import parse_port_numeric
        def _parse_port_numeric(port_str):
            if pd.isna(port_str) or port_str is None:
                return (None, None)
            start, end = parse_port_numeric(str(port_str))
            return (start, end)
        
        port_numeric = df["port"].apply(_parse_port_numeric)
        df["port_start"] = port_numeric.apply(lambda x: x[0])
        df["port_end"] = port_numeric.apply(lambda x: x[1])

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
