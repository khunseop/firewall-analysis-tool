import os
from pathlib import Path

from dotenv import load_dotenv
from cryptography.fernet import Fernet
from pydantic_settings import BaseSettings


PROJECT_ROOT = Path(__file__).resolve().parents[2]
ENV_PATH = PROJECT_ROOT / ".env"


def _generate_fernet_key() -> str:
    return Fernet.generate_key().decode()


def _ensure_env_file() -> None:
    """Ensure .env exists with required keys; create defaults if missing.

    - DATABASE_URL defaults to an absolute SQLite aiosqlite path under project root
    - ENCRYPTION_KEY is generated with Fernet if absent
    """
    # Base defaults
    default_db_url = f"sqlite+aiosqlite:///{(PROJECT_ROOT / 'fat.db').as_posix()}"
    default_key = _generate_fernet_key()

    existing_lines: list[str] = []
    if ENV_PATH.exists():
        existing_lines = ENV_PATH.read_text(encoding="utf-8").splitlines()

    # Load existing env into process for inspection
    load_dotenv(dotenv_path=ENV_PATH, override=False)

    db_url = os.getenv("DATABASE_URL") or default_db_url
    enc_key = os.getenv("ENCRYPTION_KEY") or default_key

    # Write file if missing or missing keys
    needs_write = (not ENV_PATH.exists()) or ("DATABASE_URL=" not in "\n".join(existing_lines)) or ("ENCRYPTION_KEY=" not in "\n".join(existing_lines))
    if needs_write:
        content = [
            f"DATABASE_URL={db_url}",
            f"ENCRYPTION_KEY={enc_key}",
        ]
        ENV_PATH.write_text("\n".join(content) + "\n", encoding="utf-8")

    # Ensure process env has final values for BaseSettings
    os.environ.setdefault("DATABASE_URL", db_url)
    os.environ.setdefault("ENCRYPTION_KEY", enc_key)

class Settings(BaseSettings):
    DATABASE_URL: str
    ENCRYPTION_KEY: str

    class Config:
        env_file = str(ENV_PATH)


import pytz
from datetime import datetime

# Prepare environment and then instantiate Settings
_ensure_env_file()
settings = Settings()  # type: ignore[call-arg]

SEOUL_TZ = pytz.timezone("Asia/Seoul")

def get_now_in_seoul():
    """Returns the current time in Asia/Seoul timezone."""
    return datetime.now(SEOUL_TZ)
