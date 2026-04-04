#!/usr/bin/env python3
"""
초기 관리자 계정 생성 스크립트

사용법:
    python3 firewall_manager/create_admin.py
    python3 firewall_manager/create_admin.py --username admin --password mypassword
"""
import argparse
import asyncio
import sys
from pathlib import Path

# Ensure app package is importable
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.core.auth import hash_password
from app.db.session import SessionLocal
from app.models.user import User
from sqlalchemy import select


async def create_admin(username: str, password: str) -> None:
    async with SessionLocal() as db:
        result = await db.execute(select(User).where(User.username == username))
        existing = result.scalar_one_or_none()
        if existing:
            print(f"[!] 사용자 '{username}' 이미 존재합니다.")
            return

        user = User(
            username=username,
            hashed_password=hash_password(password),
            is_active=True,
            is_admin=True,
        )
        db.add(user)
        await db.commit()
        print(f"[+] 관리자 계정 '{username}' 생성 완료")


def main():
    parser = argparse.ArgumentParser(description="FAT 관리자 계정 생성")
    parser.add_argument("--username", default="admin", help="관리자 아이디 (기본값: admin)")
    parser.add_argument("--password", default=None, help="비밀번호 (미입력 시 프롬프트)")
    args = parser.parse_args()

    password = args.password
    if not password:
        import getpass
        password = getpass.getpass(f"비밀번호 입력 ({args.username}): ")
        confirm = getpass.getpass("비밀번호 확인: ")
        if password != confirm:
            print("[!] 비밀번호가 일치하지 않습니다.")
            sys.exit(1)

    if len(password) < 8:
        print("[!] 비밀번호는 8자 이상이어야 합니다.")
        sys.exit(1)

    asyncio.run(create_admin(args.username, password))


if __name__ == "__main__":
    main()
