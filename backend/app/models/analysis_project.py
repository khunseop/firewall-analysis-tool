from sqlalchemy import Column, Integer, String, DateTime, Date, ForeignKey, LargeBinary, UniqueConstraint
from sqlalchemy.orm import relationship
from app.db.session import Base
import datetime


class AnalysisProject(Base):
    """프로젝트형 분석 모듈(예: deletion_workflow)의 프로젝트.

    module_type으로 어느 모듈에 속하는지 구분한다. 여러 모듈이 이 테이블을 공유하며,
    파이프라인 실행 로직 자체는 각 모듈의 서비스 패키지(예: services/deletion_workflow/)에
    남아있고 이 테이블은 "프로젝트가 무엇인가"(이름/상태/기준일/파일)만 다룬다.
    """
    __tablename__ = "analysis_projects"

    id = Column(Integer, primary_key=True, index=True)
    module_type = Column(String, nullable=False, index=True)  # 예: "deletion_workflow"
    device_id = Column(Integer, ForeignKey("devices.id"), nullable=False)
    name = Column(String, nullable=False)
    status = Column(String, default="draft", nullable=False)  # draft/running/completed
    memo = Column(String, nullable=True)
    reference_date = Column(Date, nullable=True)  # 기준일: None이면 실행 시점 현재 날짜 사용

    created_at = Column(DateTime, nullable=False, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    device = relationship("Device")
    files = relationship("AnalysisProjectFile", cascade="all, delete-orphan", back_populates="project")


class AnalysisProjectFile(Base):
    __tablename__ = "analysis_project_files"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("analysis_projects.id", ondelete="CASCADE"), nullable=False)
    task_id = Column(Integer, nullable=False)    # 모듈 내부 단계 번호 (모듈마다 의미가 다름)
    slot = Column(String, nullable=False)         # output_0 / output_1 / external_1 / external_2
    filename = Column(String, nullable=False)
    file_data = Column(LargeBinary, nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.datetime.utcnow)

    # 이 파일을 생성한 분석 실행(AnalysisTask)에 대한 참조. 이력 추적용이며,
    # 이 컬럼 추가 이전에 생성된 기존 파일과의 호환을 위해 nullable이다.
    analysis_task_id = Column(Integer, ForeignKey("analysistasks.id", ondelete="SET NULL"), nullable=True)

    project = relationship("AnalysisProject", back_populates="files")

    __table_args__ = (
        UniqueConstraint("project_id", "task_id", "slot", name="uq_project_task_slot"),
    )
