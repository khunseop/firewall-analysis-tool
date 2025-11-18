from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship
from app.db.session import Base
from datetime import datetime
from zoneinfo import ZoneInfo


class DeletionWorkflow(Base):
    """정책 삭제 워크플로우 상태 관리 모델"""
    __tablename__ = "deletion_workflows"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id"), nullable=False, index=True)
    current_step = Column(Integer, default=1, nullable=False)  # 1-7
    status = Column(String, nullable=False, default="pending")  # 'pending', 'in_progress', 'completed', 'paused', 'failed'
    master_file_path = Column(String, nullable=True)  # 마스터 파일 경로
    
    # 각 단계별 결과 파일 경로 저장 (JSON)
    # 예: {"1": "/path/to/step1.xlsx", "2": "/path/to/step2.xlsx"}
    step_files = Column(JSON, nullable=True, default=dict)
    
    # 최종 결과 파일 경로들 (JSON)
    # 예: {"master": "/path/to/master.xlsx", "final": ["/path/to/file1.xlsx", ...]}
    final_files = Column(JSON, nullable=True, default=dict)
    
    created_at = Column(DateTime, default=lambda: datetime.now(ZoneInfo("Asia/Seoul")).replace(tzinfo=None), nullable=False)
    updated_at = Column(DateTime, default=lambda: datetime.now(ZoneInfo("Asia/Seoul")).replace(tzinfo=None), onupdate=lambda: datetime.now(ZoneInfo("Asia/Seoul")).replace(tzinfo=None), nullable=False)
    
    device = relationship("Device", backref="deletion_workflows")

