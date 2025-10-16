from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from app.core.config import settings
import os

# .env 파일의 DATABASE_URL을 절대 경로로 변환 (SQLite의 경우)
db_url = settings.DATABASE_URL
if db_url.startswith("sqlite:///"):
    # 프로젝트 루트 디렉토리 기준으로 경로 설정
    # __file__는 database.py의 경로, dirname()을 두번써서 app/의 부모인 firewall_manager/ 디렉토리를 잡는다.
    project_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    db_name = db_url.split("sqlite:///./")[1]
    db_path = os.path.join(project_dir, db_name)
    db_url = f"sqlite:///{db_path}"


engine = create_engine(
    db_url,
    connect_args={"check_same_thread": False} if "sqlite" in db_url else {}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

# 데이터베이스 세션 의존성
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()