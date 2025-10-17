from pydantic_settings import BaseSettings
from pathlib import Path

# .env 파일의 절대 경로를 동적으로 계산합니다.
# 이 파일(config.py)의 위치를 기준으로 상위 디렉토리로 세 번 이동하여
# 프로젝트 루트 디렉토리(firewall_manager)에 있는 .env 파일을 찾습니다.
env_path = Path(__file__).parent.parent.parent / ".env"

class Settings(BaseSettings):
    DATABASE_URL: str

    class Config:
        env_file = env_path

settings = Settings()