from __future__ import annotations
from typing import List, Optional
from pydantic import BaseModel, Field
from datetime import datetime


class PolicyAnalysisRequest(BaseModel):
    device_ids: List[int] = Field(default_factory=list, description="분석 대상 장비 ID 목록")
    find_duplicates: bool = True
    find_shadow: bool = True
    find_wide: bool = True
    find_unused: bool = True

    # 미사용 정책 기준 (일)
    unused_days: int = 90

    # 광범위 정책 기준: CIDR 최대 프리픽스 (예: 16 => /16 이상 범위를 광범위로 간주)
    wide_cidr_max_prefix: int = 16

    # 선택: 활성 정책만 분석할지 여부
    enabled_only: bool = True


class DuplicateGroup(BaseModel):
    device_id: int
    vsys: Optional[str] = None
    action: Optional[str] = None
    enable: Optional[bool] = None
    key_summary: str  # 조건 요약 (src,dst,svc)
    policy_ids: List[int]
    rule_names: List[str]


class ShadowResult(BaseModel):
    device_id: int
    vsys: Optional[str] = None
    action: Optional[str] = None
    shadowed_policy_id: int
    shadowed_rule_name: str
    by_policy_id: int
    by_rule_name: str


class WideResult(BaseModel):
    device_id: int
    vsys: Optional[str] = None
    policy_id: int
    rule_name: str
    reasons: List[str]


class UnusedResult(BaseModel):
    device_id: int
    vsys: Optional[str] = None
    policy_id: int
    rule_name: str
    last_hit_date: Optional[datetime] = None
    days_since_last_hit: Optional[int] = None


class PolicyAnalysisResponse(BaseModel):
    duplicates: List[DuplicateGroup] = Field(default_factory=list)
    shadowed: List[ShadowResult] = Field(default_factory=list)
    wide: List[WideResult] = Field(default_factory=list)
    unused: List[UnusedResult] = Field(default_factory=list)
