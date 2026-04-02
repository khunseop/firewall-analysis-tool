from sqlalchemy import Column, Integer, String, DateTime, Boolean
from app.db.session import Base

class Device(Base):
    """
    방화벽 장비 정보를 저장하는 모델입니다.
    
    Attributes:
        id (int): 기본 키
        name (str): 장비 식별 이름 (Unique)
        ip_address (str): 장비 IP 주소 (Unique)
        vendor (str): 제조사 (e.g., Palo Alto, Fortinet)
        username (str): 접속 계정
        password (str): 암호화된 접속 비밀번호
        description (str): 장비 설명
        ha_peer_ip (str): HA 구성 시 상대 피어 IP
        use_ssh_for_last_hit_date (str): Last Hit Date 수집 시 SSH 사용 여부
        collect_last_hit_date (bool): Last Hit Date 수집 활성화 여부
        model (str): 장비 상세 모델명
        last_sync_at (datetime): 마지막 동기화 완료 시간
        last_sync_status (str): 마지막 동기화 상태 (in_progress, success, failure)
        last_sync_step (str): 마지막 동기화 진행 단계
    """
    __tablename__ = "devices"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True, nullable=False, unique=True)
    ip_address = Column(String, nullable=False, unique=True)
    vendor = Column(String, nullable=False)
    username = Column(String, nullable=False)
    password = Column(String, nullable=False)
    description = Column(String, nullable=True)
    ha_peer_ip = Column(String, nullable=True)
    use_ssh_for_last_hit_date = Column(Boolean, nullable=True, default=False)
    collect_last_hit_date = Column(Boolean, nullable=True, default=True)
    model = Column(String, nullable=True)
    
    # 동기화 관련 상태 필드
    # SyncTask 또는 Collector에서 실시간으로 업데이트합니다.
    last_sync_at = Column(DateTime, nullable=True)
    last_sync_status = Column(String, nullable=True)  # e.g., in_progress, success, failure
    last_sync_step = Column(String, nullable=True)   # e.g., collecting policies, indexing, etc.
