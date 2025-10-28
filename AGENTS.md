# FAT Agent: FIREWALL ANALYSIS TOOL

## 1. 프로젝트 개요

**FAT(Firewall Analysis Tool)**은 여러 방화벽 장비의 정책을 통합 조회하고 분석할 수 있는 **웹 기반 정책 관리 도구**입니다.
본 문서는 FAT의 **Agent 구성요소**에 대한 명세를 정의하며, 주로 **정책 데이터 수집 및 동기화 로직**을 다룹니다.
이 시스템은 **폐쇄망(Offline)** 환경에서 운용되며, **Palo Alto**와 **SECUI (MF2, NGF)** 등 멀티 벤더를 기본 지원하며, 테스트를 위한 **Mock** 벤더도 포함합니다.

---

## 1.5. 설치 및 실행 가이드

본 애플리케이션은 `.env` 생성은 자동 처리되지만, DB 마이그레이션은 이제 수동 스크립트로 수행합니다. 이는 uvicorn 실행 시 자동 마이그레이션으로 인해 웹 로그가 멈추는 현상을 방지하기 위함입니다.

1.  **가상 환경 생성 및 활성화**
    - 프로젝트 루트에서 가상 환경을 생성하고 활성화합니다. (Conda 또는 venv 권장)

2.  **의존성 패키지 설치**
    ```bash
    pip install -r firewall_manager/requirements.txt
    ```

3.  **서버 실행 (자동 설정 포함)**
    - 프로젝트 루트에서 아래 중 하나를 실행합니다.
    ```bash
    # 방법 A: app-dir 지정 (권장)
    uvicorn app.main:app --reload --app-dir firewall_manager

    # 방법 B: 폴더 진입 후 실행
    (cd firewall_manager && uvicorn app.main:app --reload)
    ```
    - 최초 실행 시 다음이 자동 수행됩니다:
      - 프로젝트 루트에 `.env` 자동 생성 (없을 경우)
        - 기본값: `DATABASE_URL=sqlite+aiosqlite:///<프로젝트루트>/fat.db`
        - 기본값: `ENCRYPTION_KEY=<자동생성된 Fernet 키>`
      - Alembic 자동 마이그레이션은 앱 시작 시 더 이상 실행되지 않습니다.
        - 서버 실행 전 아래 수동 스크립트를 통해 DB 스키마를 반영하세요.
        ```bash
        # 최신으로 업그레이드
        python3 firewall_manager/migrate.py

        # 명시적 업그레이드
        python3 firewall_manager/migrate.py upgrade head
        ```
    - 문서:
      - Swagger UI: `http://127.0.0.1:8000/docs`
      - ReDoc: `http://127.0.0.1:8000/redoc`

4.  **(선택) 수동 설정/운영 환경 권장 설정**
    - 자동 생성 대신 직접 `.env`를 관리하려면 프로젝트 루트에 아래 형식으로 생성하세요.
    ```env
    DATABASE_URL=sqlite+aiosqlite:///absolute/path/to/fat.db
    ENCRYPTION_KEY=<고정 Fernet 키>
    ```
    - 보안 주의: `ENCRYPTION_KEY`는 암호화/복호화의 기준 키입니다. 운영 환경에서는 반드시 안전하게 고정·관리하세요. 키가 변경되면 기존에 암호화된 값 복호화가 불가능합니다.
    - (선택) 수동 마이그레이션 고급 사용:
    ```bash
    # 현재 리비전 확인/히스토리/다운그레이드 예시
    python3 firewall_manager/migrate.py current
    python3 firewall_manager/migrate.py history base:head
    python3 firewall_manager/migrate.py downgrade -1
    ```

5.  **(선택) 스모크 테스트**
    - 로컬 확인용 간단 테스트 스크립트:
    ```bash
    python firewall_manager/smoke_test.py
    ```
    - `/docs`, `/redoc`, 오픈API 스키마 응답, `devices` 테이블 존재 여부를 확인합니다.

---

## 2. 핵심 기능

### 2.1. 대시보드
- **목표:** 각 방화벽의 정책 동기화 상태와 분석 결과를 한눈에 파악합니다.
- **설명:** 초기 버전에서는 방화벽의 CPU, 메모리 등 리소스 사용률은 조회하지 않습니다.
  정책 관리와 분석 중심의 화면을 제공합니다.
- 추후 버전에서는 자원 모니터링 기능을 확장할 수 있습니다.

---

### 2.2. 장비 관리
- **목표:** 방화벽 장비의 등록 정보 및 정책 동기화를 관리합니다.
- **세부 기능:**
  - 장비 정보(이름, IP, 벤더, 인증정보, 설명)를 CRUD 형태로 관리합니다.
  - **`POST /devices/{id}/test-connection`**: 등록된 장비에 실제 접속(`connect` 및 `disconnect`)을 시도하여 연결 가능 여부를 테스트합니다. (보안 강화를 위해 비밀번호 로깅 제거)
  - **백그라운드 동기화:** FastAPI BackgroundTasks로 데이터 동기화를 비동기 처리합니다. 요청 시 즉시 `in_progress`로 상태를 기록하고, 실제 동기화는 백그라운드 태스크에서 수행됩니다.
  - **동기화 상태 추적:** `devices.last_sync_status`에 `in_progress | success | failure`를 기록합니다. `last_sync_at`은 동기화가 완료된 시점에만 업데이트되어 마지막 "완료된" 동기화 시간을 의미합니다.
  - **`GET /firewall/sync/{device_id}/status`**: 특정 장비의 마지막 동기화 상태와 시간을 조회합니다.
  - **`POST /firewall/sync-all/{device_id}`**: 장비의 모든 데이터 타입을 순서대로 수집하여 백그라운드 동기화를 시작합니다. 완료 후 자동으로 정책 인덱스가 리빌드됩니다.
  - **`POST /firewall/parse-index/{device_id}`**: 저장된 정책을 기반으로 인덱스 테이블(`policy_address_members`, `policy_service_members`)을 재구성합니다.

---

### 2.3. 정책 및 객체 조회
- **목표:** 방화벽 정책을 통합된 인터페이스에서 조회하고 필터링합니다.
- **세부 기능:**
  - **`GET /firewall/{device_id}/policies`**: 특정 장비의 보안 정책 목록을 조회합니다.
  - **`GET /firewall/{device_id}/network-objects`**: 특정 장비의 네트워크 객체 목록을 조회합니다.
  - 출발지, 목적지, 서비스, 액션, 주석 등 다양한 필드 기반 검색을 제공합니다.
  - 특정 네트워크 대역이나 포트 범위를 지정하여 정책을 조회할 수 있습니다.
  - 정책 데이터는 SQLite에 저장되며, 각 벤더별 파싱 로직은 독립 모듈로 분리됩니다.
  - 동기화 시 객체별 활성/삭제는 Overwrite-and-Log 규칙으로 처리합니다.
    - 신규: DB에 존재하지 않으면 생성
    - 업데이트: 키 필드(`policies.rule_name`, 그 외 `name`) 기준으로 비교 후 변경 시 업데이트 및 변경 로그 기록
    - 삭제: 소스에 존재하지 않는 DB 항목은 삭제 처리하고 변경 로그 기록
    - 마지막 조회 갱신: 기존 항목이 소스에서 확인되면 `last_seen_at`을 현재 시각으로 갱신하고 `is_active=True`로 유지합니다.
  - **멀티벤더 지원:** Palo Alto, SECUI (MF2, NGF) 방화벽의 정책 구조 차이를 추상화하여 통합된 데이터 모델로 관리합니다.
  - 정책 직접 생성/배포 기능은 제공하지 않습니다.

---

### 2.4. 정책 및 객체 분석
- **목표:** 정책 품질 향상 및 비효율 식별
- **세부 기능:**
  - **중복 정책 분석**: 동일한 조건(출발지·목적지·서비스·액션)을 가진 정책 식별
  - **Shadow 정책 분석**: 상위 정책에 의해 항상 무시되는 정책 탐지
  - **광범위 정책 탐지**: 출발지/목적지/서비스가 'any' 혹은 전체 대역인 정책 식별
  - **미사용 정책 분석**: 일정 기간 트래픽 로그에 매칭되지 않은 정책 표시
  - **미참조 객체 분석**: 사용되지 않는 네트워크, 서비스, 유저 객체 식별
  - 분석 결과를 CSV 또는 Excel로 내보내기 지원

#### Last Hit Date 동기화
- NGF: 정책 수집 시 제공되는 Last Hit Date를 그대로 반영합니다. `-` 또는 공란은 미기록(NULL) 처리합니다.
- Palo Alto: 정책 수집 이후 rule-hit-count API를 호출하여 VSYS와 Rule Name으로 매핑, `policies.last_hit_date`를 보강 저장합니다. API 특성상 응답 지연이 발생할 수 있으나, 본 구현은 동기화 파이프라인 내에서 실패하더라도 전체 동기화를 실패 처리하지 않습니다(경고 로그만 남김).
- MF2: 미지원합니다.

---

### 2.5. 정책 변경 이력
- **목표:** 방화벽 정책 변경 내역을 추적 및 비교
- **세부 기능:**
  - **Overwrite-and-Log 방식**: 동기화 시, 최신 데이터로 기존 데이터를 덮어쓰고(Overwrite), 모든 변경(생성/수정/삭제) 내역은 `change_logs` 테이블에 상세히 기록합니다.
  - **상세 로그**: 수정된 항목의 경우, 변경 전(`before`)과 변경 후(`after`) 데이터를 JSON 형태로 저장하여 정확한 변경 내용을 추적할 수 있습니다.
  - `change_logs` 테이블을 통해 특정 장비의 모든 객체 변경 이력을 시간 순으로 조회하고 분석할 수 있습니다.

---

## 7. 동기화 설계 개요

- **엔드포인트**: `POST /api/v1/firewall/sync-all/{device_id}` (권장)
  - 내부용 개별 엔드포인트 `POST /api/v1/firewall/sync/{device_id}/{data_type}`는 Swagger에서 숨김 처리되었습니다.
  - 처리 흐름:
    1) `devices.last_sync_status`를 `in_progress`로 설정 후 커밋
    2) 벤더 콜렉터 생성 및 연결, `export_*`로 원천 데이터를 `DataFrame`으로 수집
    3) DataFrame → Pydantic 변환(`dataframe_to_pydantic`), `device_id` 주입
    4) 백그라운드 태스크로 DB 정합(생성/수정/삭제) + 변경 이력 기록 수행
    5) 모든 동기화 태스크 enqueue 후, 정책 인덱싱 재작성 태스크를 추가로 enqueue
    6) 성공 시 `last_sync_status=success`, 실패 시 `failure`로 갱신. `last_sync_at`은 완료 시에만 갱신

- **키 매핑 규칙**:
  - 정책: `rule_name`
  - 그 외 객체: `name`

- **객체 수명 필드**:
  - 모든 객체 테이블에 `is_active`, `last_seen_at` 존재
  - 소스에 존재한 기존 항목은 `last_seen_at=now()`로 터치, 미존재 항목은 삭제 처리하며 변경 로그에 남김

- **보안**:
  - 장비 비밀번호는 `.env`의 `ENCRYPTION_KEY`로 Fernet 암호화 저장/복호화 사용
  - Mock 벤더는 복호화 실패 시 비밀번호 원문 패스스루 허용(테스트 편의)


---

### 2.6. 정책 테스트 (시뮬레이션)
- **목표:** 특정 트래픽이 어느 정책에 매칭되는지를 테스트
- **세부 기능:**
  - 사용자가 출발지, 목적지, 서비스(포트)를 입력하면, FAT이 저장된 정책 테이블을 기반으로
    어떤 방화벽, 어떤 정책이 해당 트래픽을 처리할지 시뮬레이션합니다.
  - 방화벽별 관리 대역 정보를 사전에 등록하여 정책 매핑 정확도를 향상시킵니다.
  - 결과는 정책 ID, 액션(허용/차단), 매칭 우선순위 등으로 표시됩니다.

---

## 3. 기술 스택

| 구성 요소         | 기술                                   |
| ------------- | ------------------------------------ |
| **환경**        | 폐쇄망(Offline), 로컬 라이브러리 포함            |
| **백엔드**       | FastAPI                              |
| **프론트엔드**     | HTML / CSS / JavaScript (Vanilla JS) |
| **UI 프레임워크** | Bulma / AG-Grid / Tom-select |
| **차트 라이브러리**  | ApexCharts.js                        |
| **데이터베이스**    | SQLite                               |

---

## 4. 아키텍처 및 개발 가이드라인

### 4.1. 백엔드 (FastAPI)
- **디렉토리 구조**: `api`, `crud`, `models`, `schemas`, `services`, `core`, `db` 로 구성. 전체 구조는 아래와 같습니다.
  ```
  firewall_manager/
  ├── alembic/
  ├── app/
  │   ├── api/
  │   │   └── api_v1/
  │   │       ├── endpoints/
  │   │       └── api.py
  │   ├── core/
  │   │   ├── config.py
  │   │   └── security.py
  │   ├── crud/
  │   ├── db/
  │   ├── models/
  │   ├── schemas/
  │   ├── services/
  │   │   └── firewall/
  │   │       ├── vendors/
  │   │       │   ├── paloalto.py
  │   │       │   ├── mf2.py
  │   │       │   ├── ngf.py
  │   │       │   └── mock.py
  │   │       ├── __init__.py
  │   │       ├── interface.py
  │   │       ├── factory.py
  │   │       └── exceptions.py
  │   └── main.py
  ├── alembic.ini
  └── requirements.txt
  ```
  - `api`: API 엔드포인트 및 라우팅 관리
  - `crud`: 데이터베이스 CRUD(Create, Read, Update, Delete) 로직
  - `models`: SQLAlchemy 데이터베이스 모델 정의
  - `schemas`: Pydantic 스키마 (데이터 유효성 검사 및 직렬화)
  - `services`: 핵심 비즈니스 로직 관리.
    - `services/firewall`: 방화벽 연동 및 데이터 수집을 위한 모듈. 팩토리 패턴을 사용하여 벤더별 구현을 관리합니다.
  - `core`: 애플리케이션 설정, 보안 기능(암호화 등) 관리
  - `db`: 데이터베이스 세션 관리 및 초기화
- **오프라인 문서**: FastAPI의 Swagger UI 및 Redoc 문서는 외부 CDN 대신 로컬 정적 파일(`app/static`)을 통해 제공됩니다.
- 비동기 작업은 **FastAPI BackgroundTasks** 기반으로 간단히 처리
- 스키마 변경 시 **Alembic**으로 마이그레이션 관리

### 4.2. 프론트엔드 (Vanilla JS + Bulma)
- SPA 형태로 구성 (`index.html` 진입점)
- `fetch()` API를 통해 백엔드와 통신
- AG-Grid로 정책 조회 및 필터링 구현
- Bulma 모달 및 탭 UI를 활용한 직관적 화면 구성

### 4.3. 데이터베이스
- 데이터베이스 스키마에 대한 자세한 정보는 [DATABASE.md](./DATABASE.md) 파일에서 확인할 수 있습니다.

---

## 5. 보안 및 인증
- **비밀번호 암호화**: 장비 비밀번호와 같이 복호화가 필요한 민감 정보는 **AES 대칭키 암호화**를 사용하여 DB에 저장됩니다.
  - 암호화 키는 `.env` 파일의 `ENCRYPTION_KEY` 변수에 저장되며, 이 파일은 버전 관리에서 제외됩니다.
  - **주의**: `ENCRYPTION_KEY`가 유출되면 모든 암호화된 데이터가 위험에 처하므로, 실운영 환경에서는 Vault 등 별도의 보안 시스템을 통해 키를 관리해야 합니다.
- **단방향 해싱**: 향후 사용자 계정 기능이 추가될 경우, 비밀번호는 **bcrypt**와 같은 단방향 해시 함수를 사용하여 저장해야 합니다.
- JWT 기반 인증(Optional)
- 로그 및 정책 데이터 접근은 관리자 권한으로 제한

---

## 6. 향후 확장 방향
- 자원 모니터링 대시보드 (CPU, 메모리, 세션 등)
- 타사 방화벽 벤더 추가 지원 (Check Point, Fortinet 등)
- 자동 리포트 생성 (PDF, Excel)
- 정책 유효성 검증 기능 강화

---

> 📘 본 문서는 FAT Agent의 구현 및 유지보수 기준 문서입니다.
> 모든 개발자는 본 문서의 아키텍처 및 기능 정의를 기준으로 작업을 진행해야 합니다.
