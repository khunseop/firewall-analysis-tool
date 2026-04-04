# FAT: Firewall Analysis Tool

웹 기반 멀티 벤더 방화벽 정책 통합 관리 도구.

---

## 목차

1. [프로젝트 개요](#1-프로젝트-개요)
2. [설치 및 실행](#2-설치-및-실행)
3. [핵심 기능](#3-핵심-기능)
4. [아키텍처](#4-아키텍처)
5. [개발 가이드라인](#5-개발-가이드라인)

---

## 1. 프로젝트 개요

**FAT(Firewall Analysis Tool)**은 여러 방화벽 장비의 정책을 통합 조회·분석하는 웹 기반 도구입니다.

| 항목 | 내용 |
|------|------|
| OS | Windows |
| Python | 3.11+ |
| DB | SQLite (`fat.db`) |
| 기본 포트 | 8000 |

### 지원 벤더

| 벤더 | 전송 방식 |
|------|-----------|
| Palo Alto | XML API + SSH (HA 지원) |
| SECUI MF2 | SSH + CLI 파싱 |
| SECUI NGF | REST API |
| Mock | 결정론적 난수 (테스트용) |

---

## 2. 설치 및 실행

```bash
# 의존성 설치
pip install -r firewall_manager/requirements.txt

# DB 마이그레이션
python firewall_manager/migrate.py

# 서버 실행 (프로젝트 루트에서 실행해야 함)
uvicorn app.main:app --reload --app-dir firewall_manager
```

> **주의**: `uvicorn`은 반드시 프로젝트 루트에서 실행하세요. `firewall_manager/` 내부에서 실행하면 안 됩니다.

### DB 마이그레이션 명령어

```bash
python firewall_manager/migrate.py                      # 최신 버전 적용
python firewall_manager/migrate.py current              # 현재 리비전 확인
python firewall_manager/migrate.py history base:head    # 히스토리 조회
```

API 문서: `/docs` (Swagger) · `/redoc`

---

## 3. 핵심 기능

### 3.1. 장비 관리 및 실시간 동기화

- **CRUD 및 연결 테스트**: 장비 정보 관리 및 실시간 연결 상태 확인.
- **동기화 파이프라인**: connect → collect → transform → DB upsert → index → broadcast.
- **HA 지원 (Palo Alto)**: 메인/Peer 장비의 히트 정보를 `asyncio.gather`로 병렬 수집 후 최신 `last_hit_date` 기준으로 병합.
- **WebSocket 브로드캐스트**: 동기화 단계(Connecting, Collecting, Syncing, Indexing 등)를 실시간으로 UI에 반영.

### 3.2. 정책 및 객체 조회

- **인덱스 기반 검색**: IP 범위·포트를 숫자 범위로 변환하여 수만 건 정책을 실시간 조회 (`policy_address_members` / `policy_service_members` 테이블의 overlap 쿼리).
- **그룹 재귀 확장**: DFS 기반 Resolver가 중첩 그룹을 최하위 객체로 전개. 순환 참조 방지를 위한 방문 노드 추적 및 메모이제이션 적용.
- **Last Hit Date**: 벤더별 특화 로직으로 정책 마지막 사용 이력 보강.

### 3.3. 정책 분석 엔진

6개의 비동기 분석 엔진이 `analysistasks` 테이블로 상태를 추적하고, 결과를 JSON으로 저장합니다.

| 엔진 | 파일 | 설명 |
|------|------|------|
| Redundancy | `redundancy.py` | 상위 정책에 가려진 중복/하위 정책 탐지 |
| Unused | `unused.py` | N일간 히트 없는 미사용 정책 식별 |
| Impact | `impact.py` | 정책 이동·삭제 시 트래픽 변화 시뮬레이션 |
| Unreferenced Objects | `unreferenced_objects.py` | 어떤 정책에도 참조되지 않는 객체 식별 |
| Risky Ports | `risky_ports.py` | 위험 포트 DB와 대조하여 취약 서비스 탐지 |
| Over-permissive | `over_permissive.py` | 과도하게 광범위한 정책 탐지 |

### 3.4. 삭제 워크플로우

Config 기반 프로세서 파이프라인으로 삭제 검토 흐름을 처리하고 결과를 Excel로 내보냅니다. (`app/services/deletion_workflow/`)

---

## 4. 아키텍처

```
API Endpoints  (app/api/api_v1/endpoints/)
      ↓
Services       (app/services/)
      ↓
CRUD / DAO     (app/crud/)
      ↓
ORM Models     (app/models/)  ──►  SQLite fat.db  (via Alembic)
```

### 주요 서브시스템

| 서브시스템 | 경로 | 역할 |
|-----------|------|------|
| 멀티 벤더 추상화 | `app/services/firewall/` | Interface → Factory → Vendor. 런타임에 올바른 벤더를 결정. |
| 동기화 파이프라인 | `app/services/sync/` | 전체 동기화 오케스트레이션 및 HA 처리. |
| 정책 인덱서 | `app/services/policy_indexer.py` | 그룹 확장(DFS), IP/포트를 숫자 범위로 변환, bulk 인덱싱. |
| 범위 기반 검색 | `app/crud/crud_policy.py` | `policy_address_members` / `policy_service_members` overlap SQL 쿼리. |
| 분석 엔진 | `app/services/analysis/` | 6개 비동기 엔진. `analysistasks` 테이블로 진행률 추적. |
| 삭제 워크플로우 | `app/services/deletion_workflow/` | Config 기반 프로세서 파이프라인 → Excel 내보내기. |
| 스케줄러 | `app/services/scheduler.py` | APScheduler. 스케줄은 `sync_schedules` 테이블에 영속 저장. |
| WebSocket 매니저 | `app/services/websocket_manager.py` | 동기화·분석 진행 상황을 모든 클라이언트에 브로드캐스트. |

### 프론트엔드

Vanilla JS SPA (`/app` 경로). 프레임워크 없음.

| 라이브러리 | 역할 |
|-----------|------|
| AG-Grid | 대용량 정책 데이터 브라우징 |
| ApexCharts | 차트 / 대시보드 |
| Bulma | CSS 프레임워크 |
| ExcelJS | 클라이언트 사이드 Excel 생성 |
| Tom-Select | 셀렉트 드롭다운 |
| Font Awesome | 아이콘 |

### 상세 문서

| 문서 | 내용 |
|------|------|
| [CURRENT_ARCHITECTURE.md](./CURRENT_ARCHITECTURE.md) | 데이터 흐름 및 전체 시스템 아키텍처 상세 |
| [DATABASE.md](./DATABASE.md) | DB 테이블 명세 |
| [SETUP.md](./SETUP.md) | 상세 설치 및 마이그레이션 가이드 |
| [TODO.md](./TODO.md) | 작업 현황 및 로드맵 |
| [services/README.md](./firewall_manager/app/services/README.md) | 서비스 계층 및 인덱싱 엔진 |
| [sync/README.md](./firewall_manager/app/services/sync/README.md) | 동기화 오케스트레이션 상세 |
| [firewall/README.md](./firewall_manager/app/services/firewall/README.md) | 벤더 추상화 인터페이스 |
| [analysis/README.md](./firewall_manager/app/services/analysis/README.md) | 분석 알고리즘 및 결과 구조 |
| [crud/README.md](./firewall_manager/app/crud/README.md) | 범위 검색 쿼리 및 성능 최적화 |

---

## 5. 개발 가이드라인

### 5.1. 핵심 제약

- **DB 스키마 변경**: 직접 `fat.db` 수정 금지. 반드시 Alembic 마이그레이션을 거칠 것.
- **비밀번호**: `app/core/security.py`의 `encrypt_password` / `decrypt_password`만 사용.
- **프론트엔드**: Vanilla JS만 사용. React, Vue 등 JS 프레임워크 도입 금지.
- **임포트**: `app/` 루트 기준 절대 경로 사용.
  - ✅ `from app.services.sync.tasks import run_sync_all_orchestrator`
  - ❌ `from services.sync.tasks import ...`

### 5.2. 비동기 원칙

- 모든 I/O 작업은 `async/await`로 처리하여 이벤트 루프를 차단하지 않을 것.
- 수만 건 이상의 벌크 연산에는 `bulk_insert_mappings` 사용.

### 5.3. 확장성

- **새 벤더 추가**: `FirewallInterface`를 상속 구현 후 Factory에 등록.
- **새 분석 엔진 추가**: `AnalysisTask`로 상태를 관리하고 결과를 JSON으로 저장.

### 5.4. DB 스키마 변경 체크리스트

1. `app/models/`의 ORM 모델 수정
2. `app/schemas/`의 Pydantic 스키마 동기화
3. `alembic revision --autogenerate -m "변경 설명"` 실행
4. 생성된 마이그레이션 파일 검토
5. `python firewall_manager/migrate.py` 적용
6. `DATABASE.md` 업데이트
