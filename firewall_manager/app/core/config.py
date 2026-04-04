import os
import secrets
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
    - JWT_SECRET_KEY is generated with secrets if absent
    """
    default_db_url = f"sqlite+aiosqlite:///{(PROJECT_ROOT / 'fat.db').as_posix()}"
    default_enc_key = _generate_fernet_key()
    default_jwt_secret = secrets.token_hex(32)

    existing_lines: list[str] = []
    if ENV_PATH.exists():
        existing_lines = ENV_PATH.read_text(encoding="utf-8").splitlines()

    load_dotenv(dotenv_path=ENV_PATH, override=False)

    db_url = os.getenv("DATABASE_URL") or default_db_url
    enc_key = os.getenv("ENCRYPTION_KEY") or default_enc_key
    jwt_secret = os.getenv("JWT_SECRET_KEY") or default_jwt_secret

    joined = "\n".join(existing_lines)
    needs_write = (
        not ENV_PATH.exists()
        or "DATABASE_URL=" not in joined
        or "ENCRYPTION_KEY=" not in joined
        or "JWT_SECRET_KEY=" not in joined
    )
    if needs_write:
        content = [
            f"DATABASE_URL={db_url}",
            f"ENCRYPTION_KEY={enc_key}",
            f"JWT_SECRET_KEY={jwt_secret}",
        ]
        ENV_PATH.write_text("\n".join(content) + "\n", encoding="utf-8")
        os.chmod(ENV_PATH, 0o600)

    # Warn if .env is world-readable
    if ENV_PATH.exists():
        mode = oct(ENV_PATH.stat().st_mode & 0o777)
        if ENV_PATH.stat().st_mode & 0o044:
            import logging
            logging.getLogger(__name__).warning(
                ".env file permissions are %s — recommend 600 (owner read/write only)", mode
            )

    os.environ.setdefault("DATABASE_URL", db_url)
    os.environ.setdefault("ENCRYPTION_KEY", enc_key)
    os.environ.setdefault("JWT_SECRET_KEY", jwt_secret)


class Settings(BaseSettings):
    DATABASE_URL: str
    ENCRYPTION_KEY: str
    JWT_SECRET_KEY: str
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 480  # 8 hours

    class Config:
        env_file = str(ENV_PATH)


# Prepare environment and then instantiate Settings
_ensure_env_file()
settings = Settings()  # type: ignore[call-arg]
