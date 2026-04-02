# FAT: Firewall Analysis Tool

## 1. 프로젝트 개요 (Overview)

**FAT(Firewall Analysis Tool)**은 멀티 벤더 방화벽 장비의 정책을 통합 관리하고 보안 취약점을 분석하는 전문 도구입니다. 복잡한 방화벽 설정을 정규화하여 가시성을 제공하고, 정책 최적화를 위한 다양한 분석 기능을 제공합니다.

### 핵심 가치
- **통합 관리**: 서로 다른 제조사의 정책을 단일 인터페이스에서 조회 및 검색.
- **정밀 분석**: 중복, 과허용, 미사용 정책 및 위험 포트 사용 여부 탐지.
- **고속 검색**: 인덱싱 엔진을 통한 대규모 정책 데이터의 실시간 범위 검색.

---

## 2. 프로젝트 구조 (Structure)

프로젝트는 크게 **Backend(FastAPI)**와 **Frontend(Vanilla JS)**로 구성되어 있으며, 각 모듈은 독립적인 역할과 문서를 가지고 있습니다.

- **[Service Layer (app/services)](./firewall_manager/app/services/README.md)**: 핵심 비즈니스 로직 및 인덱싱 엔진.
  - **[Sync Service](./firewall_manager/app/services/sync/README.md)**: 장비 데이터 동기화 및 오케스트레이션.
  - **[Firewall Service](./firewall_manager/app/services/firewall/README.md)**: 멀티 벤더(Palo Alto, SECUI 등) 연동 추상화.
  - **[Analysis Service](./firewall_manager/app/services/analysis/README.md)**: 보안 정책 분석 및 결과 도출.
- **[CRUD Layer (app/crud)](./firewall_manager/app/crud/README.md)**: 인덱스 기반 검색 및 효율적인 DB 처리.

---

## 3. 설치 및 실행 (Quick Start)

### 3.1. 의존성 설치
```bash
pip install -r firewall_manager/requirements.txt
```

### 3.2. 데이터베이스 초기화 (수동 마이그레이션)
```bash
python3 firewall_manager/migrate.py
```

### 3.3. 서버 실행
```bash
uvicorn app.main:app --reload --app-dir firewall_manager
```

---

## 4. 주요 문서 (Documentation)

- **[CURRENT_ARCHITECTURE.md](./CURRENT_ARCHITECTURE.md)**: 시스템 전체 아키텍처 및 데이터 흐름 상세.
- **[DATABASE.md](./DATABASE.md)**: 데이터베이스 스키마 및 엔티티 관계(ERD) 안내.
- **[SETUP.md](./SETUP.md)**: 상세 설치 및 환경 설정 가이드.
- **[TODO.md](./TODO.md)**: 현재 작업 현황 및 향후 로드맵.

---

## 5. 기술 스택 (Tech Stack)

- **Backend**: Python 3.10+, FastAPI, SQLAlchemy (Async), Alembic, Pandas.
- **Frontend**: Vanilla JS, Bulma CSS, Ag-Grid, ApexCharts, WebSocket.
- **Database**: SQLite (aiosqlite).
- **Security**: Fernet Symmetric Encryption (Credentials).
