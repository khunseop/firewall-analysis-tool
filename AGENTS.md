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

3.  **데이터베이스 마이그레이션**
    - 서버를 실행하기 전, 항상 다음 명령을 통해 데이터베이스 스키마를 최신 상태로 유지해야 합니다.
    ```bash
    # (최초 생성 시) DB를 최신 상태로 생성 및 업그레이드
    python3 firewall_manager/migrate.py

    # 또는 명시적으로 upgrade head 사용 가능
    python3 -m alembic -c firewall_manager/alembic.ini upgrade head
    ```

4.  **서버 실행**
    - 프로젝트 루트에서 아래 중 하나를 실행합니다.
    ```bash
    # 방법 A: app-dir 지정 (권장)
    uvicorn app.main:app --reload --app-dir firewall_manager

    # 방법 B: 폴더 진입 후 실행
    (cd firewall_manager && uvicorn app.main:app --reload)
    ```
    - 문서:
      - Swagger UI: `http://127.0.0.1:8000/docs`
      - ReDoc: `http://127.0.0.1:8000/redoc`

5.  **(선택) 스모크 테스트**
    - 로컬 확인용 간단 테스트 스크립트:
    ```bash
    python3 firewall_manager/smoke_test.py
    ```

---

## 2. 핵심 기능

### 2.2. 장비 관리
- **목표:** 방화벽 장비의 등록 정보 및 정책 동기화를 관리합니다.
- **세부 기능:**
  - 장비 정보(이름, IP, 벤더, 인증정보, 설명)를 CRUD 형태로 관리합니다.
  - **`POST /devices/{id}/test-connection`**: 등록된 장비에 실제 접속(`connect` 및 `disconnect`)을 시도하여 연결 가능 여부를 테스트합니다.
  - **백그라운드 동기화:** FastAPI BackgroundTasks로 데이터 동기화를 비동기 처리합니다.
  - **동기화 상태 추적:** `devices` 테이블의 `last_sync_status` (`in_progress | success | failure`)와 `last_sync_step` (`"객체 수집 중"`, `"정책 인덱싱 중"` 등)을 통해 상세한 진행 상태를 기록합니다. `last_sync_at`은 동기화가 완료된 시점에만 업데이트됩니다.
  - **`GET /firewall/sync/{device_id}/status`**: 특정 장비의 마지막 동기화 상태, 단계, 시간을 조회합니다.
  - **`POST /firewall/sync-all/{device_id}`**: 장비의 모든 데이터를 순서대로 수집하여 백그라운드 동기화를 시작합니다. 완료 후 자동으로 정책 인덱스가 리빌드됩니다.
  - **`POST /firewall/parse-index/{device_id}`**: 저장된 정책을 기반으로 인덱스 테이블을 재구성합니다. (현재는 `sync-all`에 통합됨)

---

### 2.3. 정책 및 객체 조회
- **`last_hit_date` 동기화 로직:**
  - 동기화 오케스트레이터는 벤더에 종속되지 않는 범용적인 구조로 설계되었습니다.
  - 각 벤더의 Collector 객체에 `export_last_hit_date` 메서드가 있는지 동적으로 확인하여(`hasattr`) 호출합니다.
  - **Palo Alto:** `export_last_hit_date`를 구현하여 정책 수집 후 별도 API로 사용 이력을 조회하고 데이터를 병합합니다.
  - **NGF:** `export_security_rules` 메서드가 정책 데이터에 사용 이력을 포함하여 반환하므로, `export_last_hit_date` 메서드를 구현하지 않습니다.
  - **MF2:** 미지원.
  - 이 구조 덕분에, `last_hit_date` 수집 중 오류가 발생해도 로깅 후 동기화의 나머지 부분은 계속 진행되며, 향후 새로운 벤더를 추가할 때 유연하게 확장할 수 있습니다.

---

## 4. 아키텍처 및 개발 가이드라인

### 4.1. 백엔드 (FastAPI)
- **디렉토리 구조**: `api`, `crud`, `models`, `schemas`, `services`, `core`, `db` 로 구성.
- **`services/policy_indexer.py` 성능 최적화:**
    - **Pure Python 기반 리팩토링:** 초기 버전은 Pandas DataFrame을 사용하여 정책 멤버를 분석했으나, 현재는 메모리 및 속도 최적화를 위해 순수 Python의 `set`과 `dict`를 사용하는 방식으로 완전히 리팩토링되었습니다. 이를 통해 그룹 확장(flattening) 과정의 성능이 대폭 향상되었습니다.
    - **IP 주소 범위 병합:** 인덱싱 과정에서 개별 IP 주소와 CIDR을 숫자 범위로 변환한 뒤, 연속적인 범위들을 하나로 병합하여 `policy_address_members` 테이블에 저장합니다. 이 데이터 압축 기법을 통해 DB 저장 공간을 획기적으로 줄이고 범위 기반 검색 쿼리의 성능을 개선했습니다.
    - **스키마 최적화:** IPv4 환경만 지원하는 요구사항에 맞춰 불필요한 `ip_version` 컬럼을 `policy_address_members` 모델과 테이블에서 제거했습니다.

- **Alembic 및 SQLite 사용 가이드라인:**
    - **`batch_alter_table` 사용:** SQLite는 `ALTER TABLE`의 기능 제약이 많아, 컬럼 추가/삭제, 제약조건 변경 시 Alembic이 자동 생성한 마이그레이션 스크립트가 실패할 수 있습니다. 이러한 작업은 반드시 `op.batch_alter_table()` 컨텍스트 매니저를 사용하도록 스크립트를 수동으로 수정해야 합니다.
    - **마이그레이션 실패 시 복구:** Alembic 마이그레이션이 실패하여 DB가 불안정한 상태(`table already exists` 등)가 되면, 다음 절차로 복구하는 것이 가장 안정적입니다.
      1.  `firewall_manager/fat.db` 데이터베이스 파일을 삭제합니다.
      2.  `python3 -m alembic -c firewall_manager/alembic.ini upgrade head` 명령을 실행하여 모든 마이그레이션을 처음부터 다시 적용하고 깨끗한 DB를 생성합니다.
    - **마이그레이션 생성 전:** 새로운 마이그레이션을 생성(`--autogenerate`)하기 전에는, 항상 `upgrade head`를 먼저 실행하여 DB가 최신 상태임을 보장해야 합니다.

---
> 📘 **참고:** 문서의 간결성을 위해 변경되지 않은 섹션은 생략했습니다. 위 내용은 기존 `AGENTS.md` 파일에 병합되어야 할 추가 및 수정 사항입니다.
