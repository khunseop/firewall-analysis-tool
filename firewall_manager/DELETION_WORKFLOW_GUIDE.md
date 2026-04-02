# 정책 삭제 워크플로우 — API 레퍼런스 및 사용 가이드

워크플로우 개요, 단계별 설명, 설정 파일은 [DELETION_WORKFLOW.md](DELETION_WORKFLOW.md)를 참고하세요.

## API 엔드포인트

### 워크플로우 관리

#### GET `/deletion-workflow/{device_id}/status`
워크플로우 상태 조회

**응답**:
```json
{
  "id": 1,
  "device_id": 1,
  "status": "in_progress",
  "current_step": 3,
  "master_file_path": "/path/to/master.xlsx",
  "step_files": {"1": "/path/to/step1.xlsx"},
  "final_files": {},
  "created_at": "2025-01-20T10:00:00",
  "updated_at": "2025-01-20T10:30:00"
}
```

#### POST `/deletion-workflow/{device_id}/start`
워크플로우 시작 (Step 1 실행)

#### POST `/deletion-workflow/{device_id}/step/{step_number}/execute`
특정 단계 실행

**파라미터**:
- `step_number`: 1-7
- `csv_file`: Step 3 필요 (MIS ID CSV)
- `excel_file`: Step 4, 5 필요 (신청정보 엑셀)
- `redundancy_file`: Step 7 필요 (중복정책 분석 결과)
- `vendor`: Step 6 필요 (`"paloalto"` 또는 `"secui"`)

### 파일 다운로드

| 엔드포인트 | 설명 |
|---|---|
| `GET /deletion-workflow/{device_id}/step/{step_number}/download` | 단계별 결과 파일 |
| `GET /deletion-workflow/{device_id}/master/download` | 마스터 파일 |
| `POST /deletion-workflow/{device_id}/final/export` | 최종 결과 파일 7개 생성 |
| `GET /deletion-workflow/{device_id}/final/download` | 최종 결과 ZIP 다운로드 |

## API 사용 예시

```python
# Step 1: 워크플로우 시작
POST /deletion-workflow/1/start

# Step 2: Request ID 추출
POST /deletion-workflow/1/step/2/execute

# Step 3: MIS ID 업데이트 (CSV 업로드)
POST /deletion-workflow/1/step/3/execute
Content-Type: multipart/form-data
csv_file: <file>

# Step 4: 신청정보 가공 (엑셀 업로드)
POST /deletion-workflow/1/step/4/execute
Content-Type: multipart/form-data
excel_file: <file>

# Step 5: 신청정보 매핑
POST /deletion-workflow/1/step/5/execute

# Step 6: 예외처리 (벤더 선택)
POST /deletion-workflow/1/step/6/execute
Content-Type: multipart/form-data
vendor: paloalto

# Step 7: 중복정책 분류 (분석 결과 파일 업로드)
POST /deletion-workflow/1/step/7/execute
Content-Type: multipart/form-data
redundancy_file: <file>

# 최종 결과 생성 및 다운로드
POST /deletion-workflow/1/final/export
GET  /deletion-workflow/1/final/download
```

## 웹 UI 사용법

1. **페이지 접근**: 네비게이션 메뉴에서 "정책삭제" 클릭
2. **장비 선택**: 드롭다운에서 작업할 장비 선택
3. **워크플로우 시작**: "워크플로우 시작" 버튼 클릭 (Step 1 자동 실행)
4. **단계별 실행**: 각 단계의 "실행" 버튼을 순차적으로 클릭
   - Step 3: CSV 파일 선택 후 실행
   - Step 4: 엑셀 파일 선택 후 실행
   - Step 6: 벤더 선택 후 실행
   - Step 7: 중복정책 분석 결과 파일 선택 후 실행
5. **결과 다운로드**: 각 단계 완료 후 "다운로드" 버튼으로 결과 파일 다운로드
6. **최종 결과**: "최종 결과 생성" → "최종 결과 다운로드" 버튼으로 ZIP 파일 다운로드

## 프론트엔드 구현

- **경로**: `#/deletion-workflow`
- **템플릿**: `app/frontend/templates/deletion_workflow.html`
- **JavaScript**: `app/frontend/js/pages/deletion_workflow.js`

**주요 UI 기능**:
- 장비 선택 드롭다운
- 체크리스트 형태의 단계별 진행 상황 (대기/진행중/완료/실패)
- 이전 단계 완료 여부에 따른 실행 버튼 활성화/비활성화
- 파일 업로드 UI (Step 3, 4, 7), 벤더 선택 드롭다운 (Step 6)
- 완료된 단계의 결과 파일 다운로드

## 향후 개선 사항

1. 워크플로우 재시작 및 단계별 롤백 기능
2. 배치 처리 지원
3. 실시간 진행 상태 추적 (WebSocket)
4. 설정 파일 웹 UI에서 수정
5. 단계별 상세 로그 표시
