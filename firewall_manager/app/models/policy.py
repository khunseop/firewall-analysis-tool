from sqlalchemy import Column, Integer, String, ForeignKey, Boolean, DateTime
from sqlalchemy.orm import relationship
from app.db.session import Base
from datetime import datetime
from zoneinfo import ZoneInfo

class Policy(Base):
    """
    방화벽 정책 정보를 저장하는 모델입니다.
    
    이 모델은 각 장비(Device)로부터 수집된 개별 보안 정책의 상세 정보를 담고 있습니다.
    고성능 검색을 위해 PolicyAddressMember 및 PolicyServiceMember 모델과 연계됩니다.

    Relations:
        - Device (1:N): 한 장비에 여러 정책이 존재합니다.
        - PolicyAddressMember (1:N): 한 정책에 여러 소스/목적지 IP 정보가 인덱싱됩니다. (N:M 검색 지원용)
        - PolicyServiceMember (1:N): 한 정책에 여러 서비스(포트/프로토콜) 정보가 인덱싱됩니다. (N:M 검색 지원용)
        - RedundancyPolicySet (1:N): 중복 분석 결과와 연계됩니다.
    """
    __tablename__ = "policies"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id"))
    vsys = Column(String, nullable=True)
    seq = Column(Integer, nullable=True)
    rule_name = Column(String, index=True, nullable=False)
    enable = Column(Boolean, nullable=True)
    action = Column(String, nullable=False)
    source = Column(String, nullable=False)
    user = Column(String, nullable=True)
    destination = Column(String, nullable=False)
    service = Column(String, nullable=False)
    application = Column(String, nullable=True)
    security_profile = Column(String, nullable=True)
    category = Column(String, nullable=True)
    description = Column(String, nullable=True)
    
    # 정책 사용이력의 마지막 히트 시간 (동기화 시 수집)
    last_hit_date = Column(DateTime, nullable=True)
    
    # 논리적 삭제 및 활성 상태 관리
    is_active = Column(Boolean, default=True, nullable=False)
    
    # 시스템 시간(한국시간)으로 저장하기 위해 default는 런타임에서 주입
    last_seen_at = Column(DateTime, default=lambda: datetime.now(ZoneInfo("Asia/Seoul")).replace(tzinfo=None), nullable=False)
    
    # 검색 인덱싱 처리 여부 (PolicyAddressMember, PolicyServiceMember 생성 완료 여부)
    is_indexed = Column(Boolean, default=False, nullable=False)

    # ---------------------------
    # 관계 설정 (Relationships)
    # ---------------------------
    device = relationship("Device")
    
    # 정책 검색 최적화를 위한 인덱스 테이블들
    address_members = relationship("PolicyAddressMember", back_populates="policy", cascade="all, delete-orphan")
    service_members = relationship("PolicyServiceMember", back_populates="policy", cascade="all, delete-orphan")
    
    # 분석 관련
    redundancy_policy_sets = relationship("RedundancyPolicySet", back_populates="policy", cascade="all, delete-orphan")
