from pydantic_settings import BaseSettings
import os

class Settings(BaseSettings):
    DATABASE_URL: str

    class Config:
        env_file = ".env"
        # .env 파일이 프로젝트 루트에 있을 경우 경로 조정
        # env_file = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), '.env')


settings = Settings()