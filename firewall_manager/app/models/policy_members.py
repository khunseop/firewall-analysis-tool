from sqlalchemy import Column, Integer, BigInteger, String, ForeignKey, Index
from sqlalchemy.orm import relationship
from app.db.session import Base


class PolicyAddressMember(Base):
    """
    보안 정책의 소스/목적지 주소 필드를 개별 IP 주소 범위로 인덱싱한 모델입니다.
    
    정책 검색 시, 복합적으로 구성된 'source' 또는 'destination' 필드를 효율적으로 쿼리하기 위해
    N:M 관계를 풀어서 숫자형(BigInteger) IP 범위로 변환하여 저장합니다.
    
    Relations:
        - Policy (N:1): 여러 인덱스 엔트리가 하나의 정책에 속합니다.
        - Device (N:1): 인덱스 엔트리가 특정 장비에 속합니다.
    """
    __tablename__ = "policy_address_members"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id"), nullable=False)
    policy_id = Column(Integer, ForeignKey("policies.id"), nullable=False)
    
    # 구분 (source, destination)
    direction = Column(String, nullable=False)  # 'source' or 'destination'
    
    # 원본 토큰 (객체 이름 또는 IP)
    token = Column(String, nullable=True)  # original token (for empty groups)
    token_type = Column(String, nullable=True)  # 'ipv4_range' | 'unknown'
    
    # IP 범위 (검색 성능을 위해 정수형으로 변환)
    # IPv4의 경우 BigInteger에 담아 비교 검색을 수행합니다.
    ip_start = Column(BigInteger, nullable=True)
    ip_end = Column(BigInteger, nullable=True)

    policy = relationship("Policy", back_populates="address_members")
    device = relationship("Device")

    # 검색 최적화를 위한 복합 인덱스 구성
    __table_args__ = (
        Index("ix_policy_addr_members_lookup", "device_id", "direction", "ip_start", "ip_end"),
        Index("ix_policy_addr_members_policy", "policy_id"),
    )


class PolicyServiceMember(Base):
    """
    보안 정책의 서비스(포트/프로토콜) 필드를 개별 서비스 정보로 인덱싱한 모델입니다.
    
    복합적인 서비스 필드를 프로토콜별, 포트 범위별로 분리하여 저장함으로써
    특정 포트 번호나 프로토콜이 포함된 정책을 고속으로 검색할 수 있게 합니다.

    Relations:
        - Policy (N:1): 여러 인덱스 엔트리가 하나의 정책에 속합니다.
        - Device (N:1): 인덱스 엔트리가 특정 장비에 속합니다.
    """
    __tablename__ = "policy_service_members"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id"), nullable=False)
    policy_id = Column(Integer, ForeignKey("policies.id"), nullable=False)
    
    # 원본 토큰 (예: 'tcp/80', 'any')
    token = Column(String, nullable=False)  # original token string
    token_type = Column(String, nullable=True)  # any | proto_port | unknown
    
    # 프로토콜 및 포트 범위 (검색 최적화용)
    protocol = Column(String, nullable=True)
    port_start = Column(Integer, nullable=True)
    port_end = Column(Integer, nullable=True)

    policy = relationship("Policy", back_populates="service_members")
    device = relationship("Device")

    # 검색 최적화를 위한 복합 인덱스 구성
    __table_args__ = (
        Index("ix_policy_svc_members_lookup", "device_id", "protocol", "port_start", "port_end"),
        Index("ix_policy_svc_members_policy", "policy_id"),
    )
