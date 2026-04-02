from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship
from app.db.session import Base
from datetime import datetime
from zoneinfo import ZoneInfo


class DeletionWorkflow(Base):
    """
    미사용 정책 삭제를 위한 다단계 워크플로우 상태를 관리하는 모델입니다.
    
    데이터 수집부터 대상 선정, 승인, 실제 삭제 및 최종 결과 생성까지의 
    전 과정을 단계별로 추적하고 관련 결과 파일 경로를 저장합니다.

    Relations:
        - Device (N:1): 특정 장비에 대한 삭제 워크플로우입니다.
    """
    __tablename__ = "deletion_workflows"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id"), nullable=False, index=True)
    
    # 현재 진행 중인 단계 (1-7)
    current_step = Column(Integer, default=1, nullable=False)
    
    # 워크플로우 전체 상태 (pending, in_progress, completed, paused, failed)
    status = Column(String, nullable=False, default="pending")
    
    # 워크플로우 기준 마스터 파일 (Excel) 경로
    master_file_path = Column(String, nullable=True)
    
    # 각 단계별 중간 결과 파일 경로 (JSON)
    # 예: {"1": "/path/to/step1.xlsx", "2": "/path/to/step2.xlsx"}
    step_files = Column(JSON, nullable=True, default=dict)
    
    # 최종 결과 보고서 파일 경로들 (JSON)
    # 예: {"master": "/path/to/master.xlsx", "final": ["/path/to/file1.xlsx", ...]}
    final_files = Column(JSON, nullable=True, default=dict)
    
    # 생성 및 업데이트 시간
    created_at = Column(DateTime, default=lambda: datetime.now(ZoneInfo("Asia/Seoul")).replace(tzinfo=None), nullable=False)
    updated_at = Column(DateTime, default=lambda: datetime.now(ZoneInfo("Asia/Seoul")).replace(tzinfo=None), onupdate=lambda: datetime.now(ZoneInfo("Asia/Seoul")).replace(tzinfo=None), nullable=False)
    
    device = relationship("Device", backref="deletion_workflows")

