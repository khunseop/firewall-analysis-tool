# FAT: Firewall Analysis Tool

## 목차

1. [프로젝트 개요](#1-프로젝트-개요)
2. [설치 및 실행](#2-설치-및-실행)
3. [핵심 기능](#3-핵심-기능)
4. [아키텍처](#4-아키텍처)
5. [개발 가이드라인](#5-개발-가이드라인)

---

## 1. 프로젝트 개요

**FAT(Firewall Analysis Tool)**은 여러 방화벽 장비의 정책을 통합 조회하고 분석할 수 있는 **웹 기반 정책 관리 도구**입니다.

### 주요 특징

- **멀티 벤더 지원**: Palo Alto, SECUI (MF2, NGF), Mock (테스트용)
- **폐쇄망 환경**: 오프라인 환경에서 운용 가능
- **통합 조회**: 여러 장비의 정책을 한 번에 검색 및 비교
- **정책 분석**: 중복 정책 자동 탐지 및 분석
- **실시간 동기화**: 백그라운드 동기화 및 WebSocket을 통한 실시간 상태 추적

---

## 2. 설치 및 실행

### 2.1. 사전 요구사항

- Python 3.8 이상
- 가상 환경 관리 도구 (Conda 또는 venv)

### 2.2. 설치 절차

```bash
# 1. 가상 환경 생성 및 활성화
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# 2. 의존성 패키지 설치
pip install -r firewall_manager/requirements.txt

# 3. 데이터베이스 마이그레이션
python3 firewall_manager/migrate.py

# 또는 명시적으로 upgrade head 사용
python3 -m alembic -c firewall_manager/alembic.ini upgrade head
```

> **참고**: DB 마이그레이션은 수동 스크립트로 수행합니다. 이는 uvicorn 실행 시 자동 마이그레이션으로 인해 웹 로그가 멈추는 현상을 방지하기 위함입니다.

### 2.3. 서버 실행

```bash
# 방법 A: app-dir 지정 (권장)
uvicorn app.main:app --reload --app-dir firewall_manager

# 방법 B: 폴더 진입 후 실행
cd firewall_manager && uvicorn app.main:app --reload
```

### 2.4. 접속 정보

- **웹 애플리케이션**: `http://127.0.0.1:8000`
- **Swagger UI**: `http://127.0.0.1:8000/docs`
- **ReDoc**: `http://127.0.0.1:8000/redoc`

### 2.5. 스모크 테스트 (선택)

```bash
python3 firewall_manager/smoke_test.py
```

---

## 3. 핵심 기능

### 3.1. 장비 관리

#### 주요 기능

- **CRUD 작업**: 장비 정보(이름, IP, 벤더, 인증정보, 설명) 관리
- **연결 테스트**: `POST /devices/{id}/test-connection`으로 실제 접속 테스트
- **백그라운드 동기화**: FastAPI BackgroundTasks로 비동기 처리
- **실시간 상태 추적**: WebSocket을 통한 실시간 진행 상태 및 단계 표시
  - 동기화 시작부터 완료까지 모든 단계를 실시간으로 UI에 반영
  - 장비 목록 페이지와 대시보드에서 동시에 상태 업데이트
  - 자동 재연결 기능으로 네트워크 오류 시에도 안정적 동작

#### 고급 기능

**HA Peer IP 지원 (Palo Alto)**
- `ha_peer_ip` 필드로 HA 구성 장비의 IP 등록
- `last_hit_date` 수집 시 양쪽 장비에서 데이터 수집 후 최신 타임스탬프 선택

**SSH를 통한 `last_hit_date` 수집**
- `use_ssh_for_last_hit_date` 옵션으로 API 대신 SSH 사용
- API 방식이 불안정한 환경에서의 대안 제공

#### API 엔드포인트

- `GET /devices` - 장비 목록 조회
- `POST /devices` - 장비 등록
- `PUT /devices/{id}` - 장비 정보 수정
- `DELETE /devices/{id}` - 장비 삭제
- `POST /devices/{id}/test-connection` - 연결 테스트
- `POST /firewall/sync-all/{device_id}` - 전체 동기화 시작
- `GET /firewall/sync/{device_id}/status` - 동기화 상태 조회
- `WS /api/v1/ws/sync-status` - WebSocket 실시간 동기화 상태 업데이트

### 3.2. 정책 및 객체 조회

#### 정책 조회

- **멀티 장비 검색**: 여러 장비의 정책을 동시에 검색
- **고급 필터링**: 정책명, 출발지/목적지 IP, 서비스, 사용자, 애플리케이션 등 다양한 조건으로 검색
- **인덱스 기반 검색**: IP 범위 및 서비스 기반 빠른 검색
- **마지막 매칭일시**: 정책 사용 이력 조회

#### 객체 조회

- **네트워크 객체**: IP 주소, 네트워크 그룹
- **서비스 객체**: 프로토콜/포트, 서비스 그룹
- **객체 상세 정보**: 클릭 시 상세 정보 모달 표시

#### `last_hit_date` 동기화 로직

동기화 오케스트레이터는 벤더에 종속되지 않는 범용 구조로 설계되었습니다.

**Palo Alto**
- **API 방식**: `export_last_hit_date` 메서드로 정책 수집 후 별도 API 호출
- **SSH 방식**: `use_ssh_for_last_hit_date` 활성화 시 `export_last_hit_date_ssh` 메서드 사용
  - `paramiko`의 `invoke_shell`로 대화형 세션 생성
  - 룰별 Hit 정보 파싱

**NGF**
- `export_security_rules` 메서드가 정책 데이터에 사용 이력을 포함하여 반환
- 별도의 `export_last_hit_date` 메서드 불필요

**MF2**
- 현재 미지원

> **장점**: `last_hit_date` 수집 중 오류 발생 시에도 나머지 동기화는 계속 진행되며, 새로운 벤더 추가 시 유연하게 확장 가능

### 3.3. 정책 분석

#### 중복 정책 분석

- **자동 탐지**: 상위 정책이 하위 정책을 완전히 포함하는 경우 자동 탐지
- **백그라운드 처리**: 분석 작업은 백그라운드에서 비동기 실행
- **상태 추적**: 분석 진행 상태 실시간 조회
- **결과 조회**: 완료된 분석 결과를 그리드로 표시

#### API 엔드포인트

- `POST /analysis/redundancy/{device_id}` - 중복 정책 분석 시작
- `GET /analysis/{device_id}/status` - 분석 상태 조회
- `GET /analysis/redundancy/{task_id}/results` - 분석 결과 조회
- `GET /analysis/{device_id}/latest-result` - 최신 분석 결과 조회

---

## 4. 아키텍처

### 4.1. 백엔드 (FastAPI)

#### 디렉토리 구조

```
firewall_manager/app/
├── api/              # API 라우터 및 엔드포인트
│   └── api_v1/
│       └── endpoints/
│           └── websocket.py  # WebSocket 엔드포인트
├── crud/             # 데이터베이스 CRUD 작업
├── models/           # SQLAlchemy 모델
├── schemas/          # Pydantic 스키마
├── services/         # 비즈니스 로직
│   ├── firewall/     # 방화벽 벤더별 Collector
│   ├── sync/         # 동기화 로직
│   ├── analysis/     # 정책 분석 로직
│   ├── websocket_manager.py  # WebSocket 연결 관리
│   └── policy_indexer.py  # 정책 인덱싱
├── core/             # 설정 및 보안
└── db/               # 데이터베이스 세션
```

#### 주요 컴포넌트

**정책 인덱서 (`services/policy_indexer.py`)**
- **Pure Python 기반**: Pandas 대신 순수 Python `set`과 `dict` 사용으로 성능 최적화
- **IP 범위 병합**: 개별 IP/CIDR을 숫자 범위로 변환 후 연속 범위 병합
- **데이터 압축**: DB 저장 공간 절약 및 범위 기반 검색 성능 개선
- **IPv4 전용**: 불필요한 `ip_version` 컬럼 제거

**벤더 Collector (`services/firewall/`)**
- Factory 패턴으로 벤더별 Collector 생성
- `FirewallInterface` 추상 클래스 기반 구현
- 각 벤더별 특화된 데이터 수집 로직

**WebSocket 매니저 (`services/websocket_manager.py`)**
- **연결 관리**: 활성 WebSocket 연결 추적 및 관리
- **브로드캐스트**: 동기화 상태 변경 시 모든 연결된 클라이언트에 실시간 전송
- **자동 정리**: 연결이 끊어진 클라이언트 자동 제거
- **에러 처리**: 브로드캐스트 실패 시에도 DB 업데이트는 계속 진행

### 4.2. 프론트엔드

#### 디렉토리 구조

```
app/frontend/
├── js/
│   ├── api.js                    # API 클라이언트
│   ├── router.js                 # 라우팅
│   ├── main.js                   # 진입점
│   ├── utils/                    # 공통 유틸리티
│   │   ├── grid.js               # 그리드 관련 유틸리티
│   │   ├── modal.js              # 모달 유틸리티
│   │   ├── message.js            # 빈 상태 메시지
│   │   ├── date.js               # 날짜 포맷팅
│   │   ├── dom.js                # DOM 조작
│   │   └── export.js             # 엑셀 내보내기
│   ├── components/               # 재사용 컴포넌트
│   │   ├── navbar.js
│   │   └── objectDetailModal.js
│   └── pages/                    # 페이지별 로직
│       ├── dashboard.js
│       ├── devices.js
│       ├── policies.js
│       ├── objects.js
│       └── analysis.js
├── templates/                     # HTML 템플릿
└── styles/                        # CSS 스타일
```

#### 주요 특징

**공통 유틸리티 모듈화**
- 그리드 높이 조절, 이벤트 핸들러 생성
- 모달 (confirm, alert, form) 공통 처리
- 빈 상태 메시지 표시
- 날짜 포맷팅 및 DOM 조작 유틸리티

**사용자 경험 개선**
- 데이터 없을 때 명확한 안내 메시지 표시
- 그리드와 메시지 박스 자동 토글
- 페이지별 맞춤 메시지:
  - 정책/객체: "장비를 선택하세요"
  - 분석: "분석 내용이 없습니다"
  - 장비/대시보드: "장비를 추가하세요"

**AG Grid 통합**
- 동적 높이 조절 (세로 스크롤 제거)
- 필터링 및 정렬 기능
- 엑셀 내보내기 지원

**WebSocket 실시간 업데이트**
- **자동 연결**: 페이지 로드 시 WebSocket 자동 연결
- **자동 재연결**: 연결 끊김 시 3초 후 자동 재연결 시도
- **실시간 그리드 업데이트**: 동기화 상태 변경 시 그리드 즉시 반영
- **상태별 시각화**: 동기화 상태에 따른 색상 및 점멸 효과
- **다중 페이지 지원**: 장비 목록 페이지와 대시보드에서 동시 사용

### 4.3. 데이터베이스

#### 스키마

- **devices**: 장비 정보 및 동기화 상태
- **policies**: 정책 정보
- **network_objects**: 네트워크 객체
- **network_groups**: 네트워크 그룹
- **services**: 서비스 객체
- **service_groups**: 서비스 그룹
- **policy_address_members**: 정책-주소 인덱스 (범위 병합)
- **policy_service_members**: 정책-서비스 인덱스
- **analysis_tasks**: 분석 작업
- **analysis_results**: 분석 결과

#### 마이그레이션 (Alembic)

**SQLite 특화 가이드라인**

- **`batch_alter_table` 사용**: 컬럼 추가/삭제, 제약조건 변경 시 필수
- **마이그레이션 실패 시 복구**:
  1. `firewall_manager/fat.db` 파일 삭제
  2. `python3 -m alembic -c firewall_manager/alembic.ini upgrade head` 실행
- **마이그레이션 생성 전**: 항상 `upgrade head` 먼저 실행하여 DB 최신 상태 보장

---

## 5. 개발 가이드라인

### 5.1. 코드 스타일

- **백엔드**: PEP 8 준수, 타입 힌트 사용
- **프론트엔드**: ES6+ 모듈 시스템, 함수형 프로그래밍 지향
- **주석**: JSDoc 스타일 주석 사용

### 5.2. 함수 설계 원칙

- **단일 책임 원칙**: 각 함수는 하나의 명확한 역할만 수행
- **재사용성**: 공통 로직은 유틸리티 모듈로 분리
- **에러 처리**: 명확한 에러 메시지 및 사용자 피드백

### 5.3. 성능 최적화

- **병렬 처리**: `Promise.all()`로 여러 장비 데이터 동시 수집
- **인덱싱**: IP 범위 및 서비스 기반 빠른 검색
- **메모리 최적화**: Pandas 대신 순수 Python 자료구조 사용
- **실시간 업데이트**: WebSocket을 통한 폴링 없이 즉시 상태 반영

### 5.4. 확장성

- **벤더 추가**: `FirewallInterface` 구현 및 Factory에 등록
- **분석 유형 추가**: `services/analysis/`에 새 분석 로직 추가
- **API 확장**: 새로운 엔드포인트는 `api/api_v1/endpoints/`에 추가
- **WebSocket 확장**: `websocket_manager`에 새로운 브로드캐스트 메서드 추가 가능

---

## 참고 문서

- [DATABASE.md](./DATABASE.md) - 데이터베이스 스키마 상세
- [CURRENT_ARCHITECTURE.md](./CURRENT_ARCHITECTURE.md) - 아키텍처 개요
- [SETUP.md](./SETUP.md) - 상세 설치 가이드
