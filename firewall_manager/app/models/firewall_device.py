from sqlalchemy import Column, Integer, String
from app.database import Base

class FirewallDevice(Base):
    __tablename__ = "firewall_devices"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True, nullable=False, unique=True)
    hostname = Column(String, nullable=False, unique=True)
    vendor = Column(String, nullable=False)
    username = Column(String, nullable=False)
    password = Column(String, nullable=False)  # 실제 운영 환경에서는 암호화 필요