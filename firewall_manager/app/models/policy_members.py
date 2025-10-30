from sqlalchemy import Column, Integer, BigInteger, String, ForeignKey, Index
from sqlalchemy.orm import relationship
from app.db.session import Base


class PolicyAddressMember(Base):
    __tablename__ = "policy_address_members"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id"), nullable=False)
    policy_id = Column(Integer, ForeignKey("policies.id"), nullable=False)
    direction = Column(String, nullable=False)  # 'source' or 'destination'
    token_type = Column(String, nullable=True)  # 'ipv4_range'
    ip_version = Column(Integer, nullable=True)  # 4
    ip_start = Column(BigInteger, nullable=True)
    ip_end = Column(BigInteger, nullable=True)

    policy = relationship("Policy")
    device = relationship("Device")

    __table_args__ = (
        Index("ix_policy_addr_members_lookup", "device_id", "direction", "ip_version", "ip_start", "ip_end"),
        Index("ix_policy_addr_members_policy", "policy_id"),
    )


class PolicyServiceMember(Base):
    __tablename__ = "policy_service_members"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id"), nullable=False)
    policy_id = Column(Integer, ForeignKey("policies.id"), nullable=False)
    token = Column(String, nullable=False)  # original token string
    token_type = Column(String, nullable=True)  # any | proto_port | unknown
    protocol = Column(String, nullable=True)
    port_start = Column(Integer, nullable=True)
    port_end = Column(Integer, nullable=True)

    policy = relationship("Policy")
    device = relationship("Device")

    __table_args__ = (
        Index("ix_policy_svc_members_lookup", "device_id", "protocol", "port_start", "port_end"),
        Index("ix_policy_svc_members_policy", "policy_id"),
    )
