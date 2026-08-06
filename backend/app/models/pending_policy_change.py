from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, JSON, Index
from sqlalchemy.orm import relationship
from app.db.session import Base
import datetime
from zoneinfo import ZoneInfo


class PendingPolicyChange(Base):
    """
    Policies 편집모드에서 만든 대기중(생성/수정/삭제/이동) 변경사항을 영속 저장하는 모델입니다.

    실제 장비나 `policies` 테이블에는 전혀 반영되지 않습니다 — 사용자가 화면을
    새로고침해도 편집 중이던 내용을 잃지 않도록 보관하는 용도이며, 최종적으로는
    CLI 텍스트 생성(`/policy-builder/{device_id}/plan`)의 입력으로만 쓰입니다.

    Relations:
        - Device (N:1): 특정 장비에 대한 대기중 변경사항입니다.
        - Policy (N:1, optional): modify/delete/move 대상 기존 정책 (create는 NULL).
    """
    __tablename__ = "pending_policy_changes"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id"), nullable=False)

    # 'create' | 'modify' | 'delete' | 'move'
    change_type = Column(String, nullable=False)

    # modify/delete/move 대상 기존 정책 (create는 NULL)
    target_policy_id = Column(Integer, ForeignKey("policies.id"), nullable=True)

    # 프론트가 생성한 임시 식별자 (create 행을 추적하기 위함, 예: "draft-3")
    client_key = Column(String, nullable=False)

    # 종류별 상세 내용 (예: create=신규 정책 필드+배치 위치, modify=필드별 added/removed 토큰,
    # delete={}, move=목표 위치)
    payload = Column(JSON, nullable=False)

    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(
        DateTime,
        default=lambda: datetime.datetime.now(ZoneInfo("Asia/Seoul")).replace(tzinfo=None),
        nullable=False,
    )

    device = relationship("Device")
    target_policy = relationship("Policy")

    __table_args__ = (
        Index("ix_pending_policy_changes_device", "device_id"),
    )
