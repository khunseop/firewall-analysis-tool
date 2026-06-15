from sqlalchemy import Column, Integer, String, DateTime, Date, ForeignKey, LargeBinary, UniqueConstraint
from sqlalchemy.orm import relationship
from app.db.session import Base
import datetime


class DeletionWorkflowProject(Base):
    __tablename__ = "deletion_workflow_projects"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id"), nullable=False)
    name = Column(String, nullable=False)
    status = Column(String, default="draft", nullable=False)  # draft/running/completed
    memo = Column(String, nullable=True)
    reference_date = Column(Date, nullable=True)  # 기준일: None이면 실행 시점 현재 날짜 사용
    created_at = Column(DateTime, nullable=False, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    device = relationship("Device")
    files = relationship("DeletionWorkflowFile", cascade="all, delete-orphan", back_populates="project")


class DeletionWorkflowFile(Base):
    __tablename__ = "deletion_workflow_files"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("deletion_workflow_projects.id", ondelete="CASCADE"), nullable=False)
    task_id = Column(Integer, nullable=False)    # 0~14
    slot = Column(String, nullable=False)         # output_0 / output_1 / external_1 / external_2
    filename = Column(String, nullable=False)
    file_data = Column(LargeBinary, nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.datetime.utcnow)

    project = relationship("DeletionWorkflowProject", back_populates="files")

    __table_args__ = (
        UniqueConstraint("project_id", "task_id", "slot", name="uq_project_task_slot"),
    )
