from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Enum, JSON
from sqlalchemy.orm import relationship
from app.db.session import Base
import enum
import datetime
from zoneinfo import ZoneInfo

class AnalysisTaskType(str, enum.Enum):
    """분석 작업 종류 정의"""
    REDUNDANCY = "redundancy"               # 정책 중복 분석
    UNUSED = "unused"                       # 미사용 정책 분석
    IMPACT = "impact"                       # 영향도 분석
    UNREFERENCED_OBJECTS = "unreferenced_objects" # 미참조 객체 분석
    RISKY_PORTS = "risky_ports"             # 위험 포트 분석
    OVER_PERMISSIVE = "over_permissive"     # 과다 허용 정책 분석

class AnalysisTaskStatus(str, enum.Enum):
    """분석 작업 상태 정의"""
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    SUCCESS = "success"
    FAILURE = "failure"

class RedundancyPolicySetType(str, enum.Enum):
    """중복 정책 세트 내의 정책 역할 정의"""
    UPPER = "UPPER"  # 상위 정책 (가리는 정책)
    LOWER = "LOWER"  # 하위 정책 (가려지는 정책)

class AnalysisTask(Base):
    """
    개별 분석 작업의 상태 및 이력을 관리하는 모델입니다.
    
    Relations:
        - Device (N:1): 특정 장비에 대한 분석 작업입니다.
    """
    __tablename__ = "analysistasks"
    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id"), nullable=False)
    task_type = Column(Enum(AnalysisTaskType), nullable=False)
    task_status = Column(Enum(AnalysisTaskStatus), nullable=False, default=AnalysisTaskStatus.PENDING)
    
    # 시간 정보
    created_at = Column(DateTime, nullable=False)
    started_at = Column(DateTime)
    completed_at = Column(DateTime)

    device = relationship("Device")

class RedundancyPolicySet(Base):
    """
    중복 분석 결과, 서로 중복되는 정책들의 관계를 저장하는 모델입니다.
    
    Relations:
        - AnalysisTask (N:1): 특정 분석 작업의 결과물입니다.
        - Policy (N:1): 중복 관계에 있는 개별 정책을 참조합니다.
    """
    __tablename__ = "redundancypolicysets"
    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("analysistasks.id", ondelete="CASCADE"), nullable=False)
    
    # 중복 세트 번호 (같은 번호끼리 한 세트)
    set_number = Column(Integer, nullable=False, index=True)
    
    # 정책의 역할 (가리는 정책 vs 가려지는 정책)
    type = Column(Enum(RedundancyPolicySetType), nullable=False)
    
    policy_id = Column(Integer, ForeignKey("policies.id", ondelete="CASCADE"), nullable=False)

    task = relationship("AnalysisTask")
    policy = relationship("Policy", back_populates="redundancy_policy_sets")

class AnalysisResult(Base):
    """
    분석 완료 후의 상세 결과 데이터를 JSON 형태로 저장하는 모델입니다.
    
    Relations:
        - Device (N:1): 특정 장비에 대한 분석 결과입니다.
    """
    __tablename__ = 'analysis_results'

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey('devices.id'), nullable=False, index=True)
    
    # 분석 종류 (redundancy, unused 등)
    analysis_type = Column(String, nullable=False, index=True)
    
    # 상세 결과 (JSON 구조)
    result_data = Column(JSON, nullable=False)
    
    # 생성 및 업데이트 시간
    created_at = Column(DateTime, default=lambda: datetime.datetime.now(ZoneInfo("Asia/Seoul")).replace(tzinfo=None), onupdate=lambda: datetime.datetime.now(ZoneInfo("Asia/Seoul")).replace(tzinfo=None))

    device = relationship("Device")
