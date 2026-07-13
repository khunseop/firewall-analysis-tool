# 시스템 아키텍처 및 데이터 흐름 (System Architecture)

본 문서는 방화벽 정책의 수집, 인덱싱, 그리고 지능형 분석을 위한 계층화된 비동기 아키텍처를 설명합니다.

---

## 1. 전체 시스템 구조

```
┌─────────────────────────────────────────────────────────────────┐
│                      React Frontend (SPA)                        │
│  Dashboard, Devices, Policies, Objects, Analysis, PolicyDiff,   │
│  Schedules, Settings, Notifications, DeletionWorkflow           │
└────────────────────────┬────────────────────────────────────────┘
                         │ HTTP/WebSocket
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                         FastAPI Backend                         │
├─────────────────────────────────────────────────────────────────┤
│ API Layer (app/api/api_v1/endpoints/)                           │
│  ├─ auth.py              (인증)                                 │
│  ├─ devices.py           (장비 관리)                            │
│  ├─ firewall_query.py    (정책/객체 조회)                       │
│  ├─ firewall_sync.py     (동기화 실행)                          │
│  ├─ analysis.py          (분석 결과)                            │
│  ├─ deletion_workflow.py (삭제 워크플로우)                      │
│  ├─ export.py            (데이터 내보내기)                      │
│  ├─ notifications.py     (알림 로그)                            │
│  ├─ settings.py          (앱 설정)                              │
│  ├─ sync_schedule.py     (스케줄 관리)                          │
│  ├─ users.py             (사용자 관리)                          │
│  └─ websocket.py         (WebSocket)                            │
├─────────────────────────────────────────────────────────────────┤
│ Service Layer (app/services/)                                   │
│  ├─ sync/            (동기화 오케스트레이션)                    │
│  ├─ firewall/        (멀티 벤더 추상화)                         │
│  ├─ policy_indexer.py(인덱싱 엔진)                              │
│  ├─ analysis/        (6개 분석 엔진)                            │
│  ├─ scheduler.py     (스케줄 관리)                              │
│  └─ websocket_manager.py (실시간 통신)                          │
├─────────────────────────────────────────────────────────────────┤
│ CRUD/DAO Layer (app/crud/)                                      │
│  ├─ crud_policy.py   (범위 검색)                                │
│  ├─ crud_device.py   (장비 CRUD)                                │
│  └─ ...                                                         │
├─────────────────────────────────────────────────────────────────┤
│ ORM Models (app/models/)                                        │
│  Devices, Policies, Objects, Users, AnalysisTasks, ...         │
└─────────────────────┬───────────────────────────────────────────┘
                      │ SQLAlchemy
                      ▼
           ┌──────────────────────┐
           │  SQLite (fat.db)     │
           │  (Alembic managed)   │
           └──────────────────────┘

                 파이프라인

  Collectors              │              Indexer              │  Analysis
  ┌────────────┐          │          ┌──────────────┐         │  ┌────────────┐
  │ PaloAlto   │          │          │  Resolver    │         │  │Redundancy  │
  │ SECUI MF2  ├──────────┼─────────▶│  DFS Expand  ├────────▶├──┤Unused      │
  │ SECUI NGF  │  Collect │          │  IP to Range │         │  │Impact      │
  │ Mock       │          │          │  Bulk Insert │         │  │RiskyPorts  │
  └────────────┘          │          └──────────────┘         │  │Unreferenced│
                          │                                    │  │Over-permit │
                          │                                    │  └────────────┘
```

---

## 2. 데이터 동기화 단계 (Synchronization Phase)

### 2.1. 오케스트레이션 흐름

`backend/app/services/sync/tasks.py`의 `run_sync_all_orchestrator()`가 전체 동기화를 제어합니다.

**시퀀스**:

```
1. 세마포어 획득
   └─ `sync_parallel_limit` 설정으로 동시 작업 제한

2. 장비 연결 (Connection)
   └─ 벤더별 Collector가 API/SSH 접속 시도
   └─ 상태: `Connecting` → `Connected` / `Failed`

3. 데이터 수집 (Collection)
   수집 순서:
   ├─ network_objects     (네트워크 객체)
   ├─ network_groups      (네트워크 그룹)
   ├─ services            (서비스 객체)
   ├─ service_groups      (서비스 그룹)
   └─ policies            (보안 정책)
   
   └─ 데이터는 Pandas DataFrame 형태로 메모리에 유지
   └─ 동기 수집 호출(SSH/API)은 전용 `IO_EXECUTOR`(`app/core/executors.py`)에서 실행되어 분석 작업과 스레드 풀을 공유하지 않음

4. 히트 정보 통합 (Usage History)
   ├─ Palo Alto:
   │  └─ 메인과 Peer 장비에서 asyncio.gather로 병렬 수집
   │  └─ 최신 last_hit_date 기준 병합
   ├─ SECUI NGF:
   │  └─ 정책 수집 시 데이터에 포함된 이력 즉시 사용
   └─ SECUI MF2:
      └─ SSH 기반 이력 수집

5. DB 동기화 (Upsert/Delete)
   ├─ 기존 DB와 비교하여 CREATE/UPDATE/DELETE 수행
   ├─ 정책 내용 변경 시에만 is_indexed = False로 마킹
   └─ 모든 변경은 change_logs에 기록

6. 상태 브로드캐스트
   └─ WebSocket으로 각 단계를 UI에 실시간 전송
```

### 2.2. 멀티 벤더 추상화

**구조**: `app/services/firewall/`

```
FirewallInterface (추상 베이스)
  ├─ PaloAltoCollector      (XML API + SSH)
  ├─ SecuiMF2Collector      (SSH + CLI 파싱)
  ├─ SecuiNGFCollector      (REST API)
  └─ MockCollector          (테스트용)

Factory Pattern:
  device.vendor → 런타임 올바른 Collector 선택
```

각 Collector는 다음을 구현:
- `export_network_objects()`
- `export_network_group_objects()`
- `export_service_objects()`
- `export_service_group_objects()`
- `export_security_rules()`
- `export_last_hit_date()` (선택사항)

---

## 3. 정책 인덱싱 단계 (Policy Indexing Phase)

검색 성능 극대화를 위해 복잡한 정책 멤버를 **숫자 범위로 변환**합니다.

### 3.1. 그룹 재귀 확장 (Resolver)

**알고리즘**: 깊이 우선 탐색(DFS)

```python
# 예: 중첩 그룹
Group-A = [192.168.1.0/24, Group-B]
Group-B = [10.0.0.0/8, Host-C]
Host-C = 172.16.0.1

# 결과: [192.168.1.0/24, 10.0.0.0/8, 172.16.0.1]
```

**특징**:
- 순환 참조 방지 (방문 노드 추적)
- 메모이제이션 캐싱

### 3.2. IP/포트 범위 변환

```
IP 변환:
  192.168.1.1/24 → ip_start: 3232235776, ip_end: 3232236031
  (숫자형 저장)

포트 변환:
  80, 443, 8000-9000 → 
  [(80, 80), (443, 443), (8000, 9000)]
```

파편화된 IP/CIDR을 숫자 범위로 변환한 뒤, 연속되거나 중첩된 범위를 병합(IP Range Merging)하여 저장 공간을 절약하고 검색 효율을 높입니다.

### 3.3. 벌크 인덱싱

```python
# policy_address_members 테이블에 일괄 삽입
bulk_insert_mappings(session, policy_address_members, 
                     [member1, member2, ...])
```

**성능**: 수만 건 정책 인덱싱을 **수초 내에 완료**

---

## 4. 정책 검색 및 분석 (Search & Analysis)

### 4.1. 범위 기반 검색

**쿼리 예시** (IP '192.168.1.50' 검색):

```sql
SELECT p.* FROM policies p
JOIN policy_address_members pam ON p.id = pam.policy_id
WHERE pam.direction = 'source'
  AND pam.ip_start <= 3232235826  -- 192.168.1.50 숫자형
  AND pam.ip_end >= 3232235826
```

**성능**: 인덱스 활용으로 **밀리초 단위 응답**

여러 검색 토큰은 OR 조건으로 묶어 단일 쿼리로 처리하며, 대량 ID 바인딩은 SQLite 변수 한도에 맞춰 800개 단위로 청킹합니다.

### 4.2. 비동기 분석 엔진

**6개 병렬 엔진** (`app/services/analysis/`):

| 엔진 | 파일 | 설명 |
|------|------|------|
| Redundancy | `redundancy.py` | 상위 정책에 가려진 중복/하위 정책 탐지 |
| Unused | `unused.py` | N일간 히트 없는 미사용 정책 식별 |
| Impact | `impact.py` | 정책 이동·삭제 시 영향도 분석 |
| Unreferenced Objects | `unreferenced_objects.py` | 미참조 객체 식별 |
| Risky Ports | `risky_ports.py` | 위험 포트 DB 대조 |
| Over-permissive | `over_permissive.py` | 과도하게 광범위한 정책 탐지 |

**구조**:

```python
# 분석 작업 추적
AnalysisTask (상태: pending, in_progress, success, failure)
  └─ 결과: AnalysisResult (JSON)
```

분석 백그라운드 태스크는 자체 `SessionLocal()` 세션을 열고, O(n²) 비교 등 CPU 바운드 연산은 전용 `CPU_EXECUTOR`(`app/core/executors.py`)에서 실행되어 이벤트 루프를 차단하지 않습니다.

---

## 5. 이어서 보기

실시간 통신(WebSocket)·삭제 워크플로우·스케줄링·보안·성능 최적화·확장 포인트(새 벤더/분석 엔진 추가)는 `docs/ARCHITECTURE_OPERATIONS.md`에서 다룹니다.
