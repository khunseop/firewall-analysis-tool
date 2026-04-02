# FAT: Firewall Analysis Tool

## 목차
1. [프로젝트 개요](#1-프로젝트-개요)
2. [설치 및 실행](#2-설치-및-실행)
3. [핵심 기능](#3-핵심-기능)
4. [아키텍처 및 상세 문서](#4-아키텍처-및-상상세-문서)
5. [개발 가이드라인](#5-개발-가이드라인)

---

## 1. 프로젝트 개요
**FAT(Firewall Analysis Tool)**은 여러 방화벽 장비의 정책을 통합 조회하고 분석할 수 있는 **웹 기반 정책 관리 도구**입니다. 복잡한 방화벽 설정을 정규화하여 가시성을 제공하고, 정책 최적화를 위한 지능형 분석 기능을 제공합니다.

### 주요 특징
- **멀티 벤더 지원**: Palo Alto, SECUI (MF2, NGF), Mock (테스트용)
- **통합 검색**: 여러 장비의 정책을 IP 범위 및 서비스 조건으로 고속 검색
- **정밀 분석**: 중복 정책 탐지, 미사용 객체 식별, 위험 포트 분석 등
- **실시간 상태**: WebSocket을 통한 동기화 및 분석 상태 실시간 추적

---

## 2. 설치 및 실행

### 2.1. 설치 절차
```bash
# 1. 의존성 패키지 설치
pip install -r firewall_manager/requirements.txt

# 2. 데이터베이스 마이그레이션 (수동)
python3 firewall_manager/migrate.py
```

### 2.2. 서버 실행
```bash
# 방법 A: app-dir 지정 (권장)
uvicorn app.main:app --reload --app-dir firewall_manager

# 방법 B: 폴더 진입 후 실행
(cd firewall_manager && uvicorn app.main:app --reload)
```

---

## 3. 핵심 기능

### 3.1. 장비 관리 및 실시간 동기화
- **CRUD 및 테스트**: 장비 정보 관리 및 실시간 연결 테스트 지원.
- **WebSocket 상태 추적**: 동기화 단계별 진행 상황을 UI에 실시간 반영.
- **HA 지원 (Palo Alto)**: 메인/Peer 장비의 히트 정보를 병렬 수집 및 병합.

### 3.2. 정책 및 객체 조회
- **인덱스 기반 검색**: IP 범위 및 포트 기반의 고속 조회를 위한 멤버 전개 인덱싱.
- **마지막 매칭일시(Last Hit Date)**: 벤더별 특화 로직을 통한 정책 사용 이력 보강.

### 3.3. 정책 분석 엔진
- **Redundancy**: 상위 정책에 의해 가려지는 중복/하위 정책 탐지.
- **Risky Ports**: 수만 개의 위험 포트 DB와 대조하여 취약한 서비스 식별.
- **Impact Analysis**: 정책 이동/삭제 시 트래픽 흐름 변화 예측.

---

## 4. 아키텍처 및 상세 문서

프로젝트의 각 모듈은 독립적인 상세 가이드 문서를 포함하고 있습니다.

- **[Service Layer (app/services)](./firewall_manager/app/services/README.md)**: 서비스 계층 총괄 및 인덱싱 엔진 상세.
  - **[Sync Service](./firewall_manager/app/services/sync/README.md)**: 동기화 오케스트레이션 및 HA 처리 로직.
  - **[Firewall Service](./firewall_manager/app/services/firewall/README.md)**: 벤더별 추상화 인터페이스 및 수집 규격.
  - **[Analysis Service](./firewall_manager/app/services/analysis/README.md)**: 분석 알고리즘 및 결과 JSON 구조.
- **[CRUD Layer (app/crud)](./firewall_manager/app/crud/README.md)**: 범위 검색 쿼리 및 성능 최적화 기법.

### 기타 주요 문서
- **[CURRENT_ARCHITECTURE.md](./CURRENT_ARCHITECTURE.md)**: 데이터 흐름 및 전체 시스템 아키텍처.
- **[DATABASE.md](./DATABASE.md)**: 데이터베이스 상세 테이블 명세서.
- **[SETUP.md](./SETUP.md)**: 상세 설치 및 마이그레이션 가이드.
- **[TODO.md](./TODO.md)**: 작업 현황 및 향후 로드맵.

---

## 5. 개발 가이드라인

### 5.1. 함수 설계 및 비동기 원칙
- 모든 I/O 작업은 `async/await`를 사용하여 이벤트 루프를 차단하지 않아야 합니다.
- 수만 건 이상의 벌크 연산 시 `bulk_insert_mappings`를 사용하여 DB 성능을 최적화합니다.

### 5.2. 확장성
- 새로운 벤더 추가 시 `FirewallInterface`를 상속받아 구현하고 `Factory`에 등록합니다.
- 분석 로직 추가 시 `AnalysisTask`를 통해 상태를 관리하고 결과를 JSON으로 저장합니다.
