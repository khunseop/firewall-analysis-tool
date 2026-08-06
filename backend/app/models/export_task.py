from sqlalchemy import Column, Integer, String, DateTime, Boolean, JSON
from app.db.session import Base


class ExportTask(Base):
    """
    Devices 페이지 "직접 추출" 요청을 백그라운드에서 처리하기 위한 작업 상태 테이블입니다.
    단건/다건(병합 포함) 요청 모두 한 행으로 관리하며, 진행 상태는 WebSocket으로 브로드캐스트됩니다.
    """
    __tablename__ = "export_tasks"

    id = Column(Integer, primary_key=True, index=True)
    device_ids = Column(JSON, nullable=False)  # list[int]
    export_type = Column(String, nullable=False)  # policies | objects | hit_dates
    source = Column(String, nullable=False, default="live")  # live | db
    merge = Column(Boolean, nullable=False, default=False)
    use_ssh = Column(Boolean, nullable=False, default=False)
    timeout_seconds = Column(Integer, nullable=False, default=600)

    status = Column(String, nullable=False, default="pending")  # pending | in_progress | success | failure
    step = Column(String, nullable=True)
    progress_current = Column(Integer, nullable=False, default=0)
    progress_total = Column(Integer, nullable=False, default=0)
    error_message = Column(String, nullable=True)

    result_file_path = Column(String, nullable=True)
    result_filename = Column(String, nullable=True)

    requested_by_user_id = Column(Integer, nullable=True)
    requested_by_username = Column(String, nullable=True)

    created_at = Column(DateTime, nullable=False)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
