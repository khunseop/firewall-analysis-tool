from sqlalchemy import Column, String
from app.db.session import Base

class Settings(Base):
    """
    시스템 전역 설정을 Key-Value 형태로 저장하는 모델입니다.
    """
    __tablename__ = "settings"

    # 설정 키 (예: 'slack_webhook_url')
    key = Column(String, primary_key=True, index=True)
    
    # 설정 값 (JSON 문자열 또는 일반 문자열)
    value = Column(String, nullable=False)
    
    # 설정 항목 설명
    description = Column(String, nullable=True)

