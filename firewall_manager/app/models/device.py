from sqlalchemy import Column, Integer, String
from app.db.session import Base

class Device(Base):
    __tablename__ = "devices"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True, nullable=False, unique=True)
    ip_address = Column(String, nullable=False, unique=True)
    vendor = Column(String, nullable=False)
    username = Column(String, nullable=False)
    password = Column(String, nullable=False)  # Note: In a real app, this should be encrypted
    description = Column(String, nullable=True)
