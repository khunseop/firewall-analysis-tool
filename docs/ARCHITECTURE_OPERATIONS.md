# 실시간 통신, 운영, 보안, 확장 (Architecture — Operations)

`docs/ARCHITECTURE.md`의 하위 문서입니다. 데이터 흐름(수집/인덱싱/검색/분석)은 메인 문서를 참고하고, 여기서는 실시간 통신·삭제 워크플로우·스케줄링·보안·성능·확장 포인트를 다룹니다.

---

## 1. 실시간 통신 (WebSocket)

### 1.1. 클라이언트 ↔ 서버

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

### 1.2. 프론트엔드 훅

```typescript
// src/hooks/useWebSocket.ts
useSyncStatusWebSocket((msg) => {
  // UI 업데이트
  updateSyncStatus(msg)
})

// 특징:
// - 연결 끊김 시 지수 백오프(1s→최대 30s)로 자동 재연결
// - 쿠키 기반(access_token) 인증
```

**Ag-Grid**: 대용량 정책 데이터를 가로/세로 스크롤 없이 유연하게 브라우징할 수 있도록 지원합니다.

**번들 분할**: 페이지는 `React.lazy`로 라우트 단위 분할되며, Ag-Grid·ApexCharts 등 대형 벤더는 별도 청크로 분리되어 해당 페이지 진입 시에만 로드됩니다.

---

## 2. 삭제 워크플로우

`app/services/deletion_workflow/`

프로젝트(`deletion_workflow_projects`) 단위로 관리되며, Config 기반 프로세서 파이프라인을 통해 Excel 파일을 입출력합니다.

**구조**:
```
core/
  ├─ config_manager.py    (파이프라인 설정 로드)
  ├─ input_resolver.py    (입력 파일 해석)
  ├─ pipeline.py          (태스크 실행 오케스트레이션)
  └─ workspace_runner.py  (작업공간 관리)
processors/
  ├─ request_parser.py / request_extractor.py  (삭제 요청 파싱)
  ├─ merge_hitcount.py                         (히트 카운트 병합)
  ├─ duplicate_policy_classifier.py            (중복 정책 분류)
  ├─ policy_usage_processor.py                 (정책 사용 여부 판단)
  ├─ notification_classifier.py                (통보 대상 분류)
  └─ ...
utils/
  ├─ excel_manager.py    (Excel 읽기/쓰기)
  └─ file_manager.py     (파일 저장: deletion_workflow_files)
```

세부 운영 가이드는 `services/deletion_workflow/README.md`와 `backend/DELETION_WORKFLOW.md` / `backend/DELETION_WORKFLOW_GUIDE.md`를 참고하세요.

---

## 3. 스케줄링 (APScheduler)

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
- 시작/종료: 앱 `lifespan` 컨텍스트에서 로드·정지

---

## 4. 보안 및 인증

### 4.1. 토큰 기반 인증

```
로그인 (/api/v1/auth/login)
  ├─ Credentials 검증
  ├─ JWT 토큰 생성 (8시간 유효)
  ├─ Cookie + LocalStorage 저장
  └─ Bearer Token으로 API 요청

인증 실패 (401)
  └─ 자동 로그아웃 + /login 리다이렉트
```

### 4.2. 비밀번호 암호화

```python
# app/core/security.py
encrypt_password(password)  # Fernet 암호화 (장비 비밀번호용)
decrypt_password(cipher)

# 사용자 비밀번호는 bcrypt 해싱
```

---

## 5. 성능 최적화

### 5.1. 벌크 연산

```python
# DO ✅
session.bulk_insert_mappings(PolicyAddressMember, records)

# DON'T ❌
for record in records:
    session.add(PolicyAddressMember(**record))
```

### 5.2. 비동기 처리

```python
# 모든 I/O는 async/await 사용
async def fetch_device_data():
    connector = await connect_device()
    data = await collector.export_policies()
    await save_to_db(data)
```

### 5.3. 캐싱 (프론트엔드)

```typescript
// TanStack React Query: staleTime = 30초
useQuery({
  queryKey: ['policies'],
  queryFn: fetchPolicies,
  staleTime: 30_000,
})
```

---

## 6. 확장 포인트

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
