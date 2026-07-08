from sqlalchemy import Column, Integer, String, DateTime, Boolean, Date
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
    
    group = Column(String, nullable=True)  # 장비 그룹 (예: 서울DC, 부산DR)

    # 동기화 관련 상태 필드
    # SyncTask 또는 Collector에서 실시간으로 업데이트합니다.
    last_sync_at = Column(DateTime, nullable=True)
    last_sync_status = Column(String, nullable=True)  # e.g., in_progress, success, failure
    last_sync_step = Column(String, nullable=True)   # e.g., collecting policies, indexing, etc.

    # 대시보드 통계 캐시 — 동기화 완료 시 업데이트됩니다.
    cached_policies = Column(Integer, nullable=True, default=0)
    cached_active_policies = Column(Integer, nullable=True, default=0)
    cached_disabled_policies = Column(Integer, nullable=True, default=0)
    cached_network_objects = Column(Integer, nullable=True, default=0)
    cached_network_groups = Column(Integer, nullable=True, default=0)
    cached_services = Column(Integer, nullable=True, default=0)
    cached_service_groups = Column(Integer, nullable=True, default=0)

    # 상세 정보
    serial_number = Column(String, nullable=True)
    os_name = Column(String, nullable=True)
    os_version = Column(String, nullable=True)
    install_date = Column(Date, nullable=True)

    # 설치 위치
    location_region = Column(String, nullable=True)
    location_building = Column(String, nullable=True)
    location_floor = Column(String, nullable=True)
    location_room = Column(String, nullable=True)
    location_x = Column(String, nullable=True)
    location_y = Column(String, nullable=True)
    location_z = Column(String, nullable=True)

    # 객체 수 임계치 (수기 입력) — 사용량은 cached_* 컬럼과 비교
    policy_threshold = Column(Integer, nullable=True)          # cached_policies와 비교
    network_object_threshold = Column(Integer, nullable=True)  # cached_network_objects + cached_network_groups와 비교
    service_threshold = Column(Integer, nullable=True)         # cached_services + cached_service_groups와 비교
