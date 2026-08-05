"""
PAN-OS `set`/`move` CLI 명령어 텍스트 생성 순수 로직.

사내 SecToolkit 프로젝트의 PaloAltoService.generate_command를 이식했습니다
(문서: /Users/hoon/Code/SecToolkit/docs/paloalto-cli-generator.md).
장비에 직접 반영하지 않고, 사용자가 검토 후 실행할 CLI 텍스트만 만듭니다.
"""

import re
from typing import Dict, Optional, Tuple

from app.schemas.policy_builder import MoveTarget, NewObjectSpec, NewPolicyRow

_MULTI_VALUE_FIELDS = [
    ("from", "from_zone"),
    ("source", "source"),
    ("source-user", "source_user"),
    ("to", "to_zone"),
    ("destination", "destination"),
    ("service", "service"),
    ("application", "application"),
]


def _quote_if_needed(value: str) -> str:
    return f'"{value}"' if " " in value else value


def _split_multi_value(raw: str) -> list:
    return [item.strip() for item in re.split(r"[,\n]", raw or "") if item.strip()]


def _format_list_value(raw: str) -> str:
    """1개면 값 그대로, 2개 이상이면 PAN-OS 리스트 문법 `[ a b c ]`."""
    items = _split_multi_value(raw)
    if not items:
        return ""
    quoted = [_quote_if_needed(item) for item in items]
    return quoted[0] if len(quoted) == 1 else "[ " + " ".join(quoted) + " ]"


def generate_policy_set_command(row: NewPolicyRow, vsys: Optional[str]) -> Tuple[Optional[str], Optional[str], Dict[str, int]]:
    """
    신규 정책 1건에 대한 `set rulebase security rules ...` 명령을 생성합니다.

    Returns: (command, error, counts) — error가 있으면 command는 None.
    """
    if not row.rule_name.strip():
        return None, "rule_name이 비어 있습니다.", {}

    parts = ["set"]
    if vsys:
        parts += ["vsys", vsys]
    parts += ["rulebase", "security", "rules", _quote_if_needed(row.rule_name.strip())]

    # disabled는 항상 명시(재활성화 누락 방지)
    parts += ["disabled", "yes" if row.disabled else "no"]
    parts += ["action", (row.rule_action or "allow").strip().lower()]

    counts: Dict[str, int] = {}
    for cli_name, field_name in _MULTI_VALUE_FIELDS:
        raw = getattr(row, field_name)
        items = _split_multi_value(raw)
        if not items:
            continue
        counts[field_name] = len(items)
        parts += [cli_name, _format_list_value(raw)]

    if row.description.strip():
        parts += ["description", _quote_if_needed(row.description.strip())]
    if row.log_end.strip():
        parts += ["log-end", row.log_end.strip().lower()]
    if row.log_setting.strip():
        parts += ["log-setting", _quote_if_needed(row.log_setting.strip())]

    return " ".join(parts), None, counts


def generate_move_command(rule_name: str, move_target: MoveTarget, reference_rule_name: Optional[str], vsys: Optional[str]) -> Tuple[Optional[str], Optional[str]]:
    """`move rulebase security rules ...` 명령을 생성합니다."""
    if not rule_name.strip():
        return None, "rule_name이 비어 있습니다."

    parts = ["move"]
    if vsys:
        parts += ["vsys", vsys]
    parts += ["rulebase", "security", "rules", _quote_if_needed(rule_name.strip())]

    if move_target.position in ("top", "bottom"):
        parts.append(move_target.position)
    else:
        if not reference_rule_name:
            return None, "이동 기준 정책 이름을 확인할 수 없습니다."
        parts += [move_target.position, _quote_if_needed(reference_rule_name)]

    return " ".join(parts), None


def generate_address_object_command(obj: NewObjectSpec, vsys: Optional[str]) -> Tuple[Optional[str], Optional[str]]:
    """`set address "<name>" ip-netmask|ip-range|fqdn <value>` 명령을 생성합니다."""
    if not obj.name.strip():
        return None, "오브젝트 이름이 비어 있습니다."
    if not obj.ip_address or not obj.ip_address.strip():
        return None, "주소 값(IP/CIDR/FQDN)이 비어 있습니다."

    parts = ["set"]
    if vsys:
        parts += ["vsys", vsys]
    parts += ["address", _quote_if_needed(obj.name.strip())]

    address_type = obj.address_type or "ip-mask"
    value = obj.ip_address.strip()
    if address_type == "ip-range":
        parts += ["ip-range", value]
    elif address_type == "fqdn":
        parts += ["fqdn", value]
    else:
        parts += ["ip-netmask", value]

    if obj.description.strip():
        parts += ["description", _quote_if_needed(obj.description.strip())]

    return " ".join(parts), None


def generate_service_object_command(obj: NewObjectSpec, vsys: Optional[str]) -> Tuple[Optional[str], Optional[str]]:
    """`set service "<name>" protocol tcp|udp port <port>` 명령을 생성합니다."""
    if not obj.name.strip():
        return None, "오브젝트 이름이 비어 있습니다."
    protocol = (obj.protocol or "").strip().lower()
    if protocol not in ("tcp", "udp"):
        return None, "protocol은 tcp 또는 udp만 지원합니다."
    if not obj.port or not obj.port.strip():
        return None, "포트 값이 비어 있습니다."

    parts = ["set"]
    if vsys:
        parts += ["vsys", vsys]
    parts += ["service", _quote_if_needed(obj.name.strip()), "protocol", protocol, "port", obj.port.strip()]

    if obj.description.strip():
        parts += ["description", _quote_if_needed(obj.description.strip())]

    return " ".join(parts), None
