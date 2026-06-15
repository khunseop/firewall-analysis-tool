# 시스템 아키텍처 및 데이터 흐름 (System Architecture)

본 문서는 방화벽 정책의 수집, 인덱싱, 그리고 지능형 분석을 위한 계층화된 비동기 아키텍처를 설명합니다.

---

## 1. 전체 시스템 구조

```
┌─────────────────────────────────────────────────────────────────┐
│                      React Frontend (SPA)                        │
│  (Auth, Devices, Policies, Objects, Analysis, Scheduling)       │
└────────────────────────┬────────────────────────────────────────┘
                         │ HTTP/WebSocket
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                         FastAPI Backend                         │
├─────────────────────────────────────────────────────────────────┤
│ API Layer (app/api/api_v1/endpoints/)                           │
│  ├─ auth.py          (인증)                                     │
│  ├─ devices.py       (장비 관리)                                │
│  ├─ firewall_*.py    (정책/객체 조회)                           │
│  ├─ analysis.py      (분석 결과)                                │
│  └─ ...                                                         │
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

---

## 5. 실시간 통신 (WebSocket)

### 5.1. 클라이언트 ↔ 서버

```
WebSocket /api/v1/ws/sync-status?token=JWT_TOKEN
  
브로드캐스트 메시지:
{
  "type": "device_sync_status",
  "device_id": 1,
  "status": "in_progress",
  "step": "Indexing"
}
```

### 5.2. 프론트엔드 훅

```typescript
// src/hooks/useWebSocket.ts
useSyncStatusWebSocket((msg) => {
  // UI 업데이트
  updateSyncStatus(msg)
})

// 특징:
// - 연결 끊김 시 5초 후 자동 재연결
// - 토큰 기반 인증
```

---

## 6. 삭제 워크플로우

`app/services/deletion_workflow/`

**흐름**:
```
1. 삭제 대상 정책 선택
2. Config 기반 프로세서 파이프라인
   ├─ Validation
   ├─ Dependency Check
   └─ Excel Export
3. 관리자 검토 및 승인
4. 배치 삭제
```

---

## 7. 스케줄링 (APScheduler)

`app/services/scheduler.py`

```python
# sync_schedules 테이블에 영속 저장
{
  "name": "Daily Sync - Seoul",
  "enabled": true,
  "days_of_week": [0, 1, 2, 3, 4],  # Mon-Fri
  "time": "02:00",
  "device_ids": [1, 2, 3]
}
```

**동작**:
- 시작: 앱 `startup_event`에서 로드
- 종료: 앱 `shutdown_event`에서 정지

---

## 8. 보안 및 인증

### 8.1. 토큰 기반 인증

```
로그인 (/api/v1/auth/login)
  ├─ Credentials 검증
  ├─ JWT 토큰 생성 (8시간 유효)
  ├─ Cookie + LocalStorage 저장
  └─ Bearer Token으로 API 요청

인증 실패 (401)
  └─ 자동 로그아웃 + /login 리다이렉트
```

### 8.2. 비밀번호 암호화

```python
# app/core/security.py
encrypt_password(password)  # Fernet 암호화 (장비 비밀번호용)
decrypt_password(cipher)

# 사용자 비밀번호는 bcrypt 해싱
```

---

## 9. 성능 최적화

### 9.1. 벌크 연산

```python
# DO ✅
session.bulk_insert_mappings(PolicyAddressMember, records)

# DON'T ❌
for record in records:
    session.add(PolicyAddressMember(**record))
```

### 9.2. 비동기 처리

```python
# 모든 I/O는 async/await 사용
async def fetch_device_data():
    connector = await connect_device()
    data = await collector.export_policies()
    await save_to_db(data)
```

### 9.3. 캐싱 (프론트엔드)

```typescript
// TanStack React Query: staleTime = 30초
useQuery({
  queryKey: ['policies'],
  queryFn: fetchPolicies,
  staleTime: 30_000,
})
```

---

## 10. 확장 포인트

### 새 벤더 추가

```python
# app/services/firewall/new_vendor.py
class NewVendorCollector(FirewallInterface):
    async def export_network_objects(self):
        # 구현
        pass
    # ... 나머지 메서드

# app/services/firewall/__init__.py의 Factory에 등록
COLLECTOR_FACTORY = {
    'paloalto': PaloAltoCollector,
    'new_vendor': NewVendorCollector,  # ← 추가
}
```

### 새 분석 엔진 추가

```python
# app/services/analysis/new_analysis.py
async def run_new_analysis(device_id: int, session):
    task = AnalysisTask(device_id=device_id, task_type='new_analysis')
    try:
        result = await analyze_logic()
        save_result(task, result)
    except Exception as e:
        task.task_status = 'failure'
```
