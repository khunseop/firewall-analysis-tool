# 정책 삭제 워크플로우 문서

## 개요

정책 삭제 워크플로우는 방화벽 정책과 신청 시스템 정보를 결합하여 삭제 가능한 정책을 식별하고 예외처리될 정책들을 관리하는 체크리스트 방식의 순차 프로세서입니다.

## 아키텍처

### 디렉토리 구조

```
firewall_manager/app/
├── models/
│   └── deletion_workflow.py          # DeletionWorkflow 모델
├── crud/
│   └── crud_deletion_workflow.py     # 워크플로우 CRUD 작업
├── services/
│   └── deletion_workflow/
│       ├── __init__.py
│       ├── config_manager.py         # 설정 파일 관리
│       ├── file_manager.py           # 임시 파일 관리
│       ├── excel_manager.py          # Excel 파일 관리
│       ├── workflow_manager.py       # 워크플로우 상태 관리
│       ├── final_exporter.py         # 최종 결과 생성기
│       └── processors/
│           ├── __init__.py
│           ├── request_parser.py     # Step 1: 신청정보 파싱
│           ├── request_extractor.py  # Step 2: Request ID 추출
│           ├── mis_id_adder.py       # Step 3: MIS ID 업데이트
│           ├── application_aggregator.py  # Step 4: 신청정보 가공
│           ├── request_info_adder.py # Step 5: 신청정보 매핑
│           ├── exception_handler.py  # Step 6: 예외처리
│           └── duplicate_policy_classifier.py  # Step 7: 중복정책 분류
└── api/
    └── api_v1/
        └── endpoints/
            └── deletion_workflow.py  # API 엔드포인트
```

### 데이터베이스 스키마

#### DeletionWorkflow 테이블

```sql
CREATE TABLE deletion_workflows (
    id INTEGER PRIMARY KEY,
    device_id INTEGER NOT NULL,
    current_step INTEGER NOT NULL DEFAULT 1,
    status VARCHAR NOT NULL DEFAULT 'pending',
    master_file_path VARCHAR,
    step_files JSON,
    final_files JSON,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    FOREIGN KEY (device_id) REFERENCES devices(id)
);
```

- `current_step`: 현재 진행 중인 단계 (1-7)
- `status`: 워크플로우 상태 ('pending', 'in_progress', 'completed', 'paused', 'failed')
- `master_file_path`: 마스터 파일 경로
- `step_files`: 각 단계별 결과 파일 경로 (JSON)
- `final_files`: 최종 결과 파일 경로들 (JSON)

## 워크플로우 단계

### Step 1: RequestParser (신청정보 파싱)

**목적**: DB의 Policy.description 필드에서 패턴 기반으로 신청정보를 파싱합니다.

**입력**: 
- DB의 Policy 테이블 (device_id 기준)

**처리**:
- 정책 description에서 정규표현식 패턴으로 신청정보 추출
- Request Type, Request ID, Ruleset ID, MIS ID, Request User, Start Date, End Date 파싱

**출력**: 
- 임시 엑셀 파일 (다운로드 가능)
- 마스터 파일 경로 업데이트

**설정**:
- `parsing_patterns.gsams3`: GSAMS3 패턴 (설정 파일에서 관리)
- `parsing_patterns.gsams1_rulename`: GSAMS1 규칙명 패턴
- `parsing_patterns.gsams1_description`: GSAMS1 설명 패턴

### Step 2: RequestExtractor (Request ID 추출)

**목적**: Step 1 결과에서 Request Type과 Request ID만 추출하여 중복제거합니다.

**입력**: 
- Step 1 결과 파일

**처리**:
- Request Type과 Request ID 컬럼만 추출
- 중복 제거
- Request Type별로 시트 분리

**출력**: 
- Request Type별 시트가 있는 엑셀 파일
- 용도: 외부 신청 시스템 담당자에게 전달하여 신청정보 회신 요청

### Step 3: MisIdAdder (MIS ID 업데이트)

**목적**: CSV 파일에서 MIS ID를 읽어서 마스터 파일을 업데이트합니다.

**입력**: 
- 마스터 파일 (Step 1 또는 이전 단계 결과)
- CSV 파일 (MIS ID 매핑, 업로드)

**처리**:
- CSV 파일에서 ruleset_id와 mis_id 매핑 읽기
- 마스터 파일의 Ruleset ID와 매칭하여 MIS ID 업데이트
- MIS ID가 없거나 변경된 경우만 업데이트

**출력**: 
- 업데이트된 마스터 파일

### Step 4: ApplicationAggregator (신청정보 가공)

**목적**: 외부에서 받은 신청정보 엑셀 파일을 앱 형식에 맞게 가공합니다.

**입력**: 
- 신청정보 엑셀 파일 (외부에서 업로드, Step 2에서 전달한 Request ID 기반)

**처리**:
- 여러 시트의 신청정보를 취합
- 날짜 형식 변환 (YYYYMMDD → YYYY-MM-DD)
- REQUEST_END_DATE 기준 내림차순 정렬

**출력**: 
- 가공된 신청정보 엑셀 파일

### Step 5: RequestInfoAdder (신청정보 매핑)

**목적**: Step 4의 가공 결과를 Step 1의 파싱 결과와 매핑하여 정책-신청건을 연결합니다.

**입력**: 
- 마스터 파일 (Step 1 또는 Step 3 결과)
- 신청정보 파일 (Step 4 결과)

**처리**:
- 정책의 Request ID와 신청정보의 REQUEST_ID 매칭
- GROUP 타입의 경우 추가 조건으로 매칭 (MIS ID, 날짜, 사용자 등)
- 자동 연장 ID 찾기 및 REQUEST_STATUS 설정

**출력**: 
- 신청정보가 추가된 마스터 파일

### Step 6: ExceptionHandler (예외처리)

**목적**: 예외 정책을 분류합니다.

**입력**: 
- 마스터 파일 (Step 5 결과)

**처리**:
- 예외 신청정책 (except_list 기반)
- 신규정책 (최근 3개월 이내)
- 자동연장정책 (REQUEST_STATUS == 99)
- 인프라정책 (deny-std 이전 정책)
- 비활성화정책 (Enable == 'N')
- 기준정책
- 차단정책 (Action == 'deny')
- 만료여부 계산

**출력**: 
- 예외 컬럼이 추가된 마스터 파일

### Step 7: DuplicatePolicyClassifier (중복정책 분류)

**목적**: 중복정책 분석 결과와 신청정보를 결합하여 공지용/삭제용으로 분류합니다.

**입력**: 
- 마스터 파일 (Step 6 결과)
- 중복정책 분석 결과 파일 (RedundancyAnalyzer 결과, 업로드)
- 신청정보 파일 (Step 4 결과)

**처리**:
- 같은 신청자의 중복셋 → 삭제용
- 다른 신청자간의 중복셋 → 공지용
- 자동연장, 늦은종료일, 신청자검증 등 고려

**출력**: 
- 중복정책_공지용 파일
- 중복정책_삭제용 파일

### Step 10: 최종 결과 생성

**목적**: 최종 결과 파일들을 생성합니다.

**입력**: 
- 마스터 파일 (Step 6 결과)
- 중복정책 분류 결과 (Step 7 결과)

**출력**: 총 7개 엑셀 파일
1. 마스터 분석결과 파일 (전체 정책 + 신청정보 + 예외처리)
2. 만료_사용정책 (공지용)
3. 만료_미사용정책 (공지용)
4. 장기미사용정책 (공지용)
5. 이력없는_미사용정책 (공지용)
6. 중복정책_공지용
7. 중복정책_삭제용

## 설정 파일

### 위치
`firewall_manager/config/deletion_workflow_config.json`

### 설정 항목

```json
{
  "file_naming": {
    "policy_version_format": "_v{version}",
    "final_version_suffix": "_vf",
    "request_id_prefix": "request_id_"
  },
  "file_extensions": {
    "excel": ".xlsx",
    "csv": ".csv"
  },
  "excel_styles": {
    "header_fill_color": "E0E0E0",
    "history_fill_color": "ccffff"
  },
  "columns": {
    "all": ["예외", "만료여부", "신청이력", "Rule Name", ...],
    "no_history": ["예외", "Rule Name", ...],
    "date_columns": ["REQUEST_START_DATE", "REQUEST_END_DATE", ...]
  },
  "translated_columns": {
    "Rule Name": "규칙명",
    "Enable": "활성화",
    ...
  },
  "except_list": [],
  "timeframes": {
    "recent_policy_days": 90
  },
  "parsing_patterns": {
    "gsams3": "...",
    "gsams1_rulename": "...",
    "gsams1_description": "..."
  }
}
```

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
  "step_files": {"1": "/path/to/step1.xlsx", ...},
  "final_files": {},
  "created_at": "2025-01-20T10:00:00",
  "updated_at": "2025-01-20T10:30:00"
}
```

#### POST `/deletion-workflow/{device_id}/start`
워크플로우 시작 (Step 1 실행)

**응답**:
```json
{
  "msg": "워크플로우가 시작되었습니다.",
  "step": 1,
  "result": {
    "file_path": "/path/to/step1.xlsx"
  }
}
```

#### POST `/deletion-workflow/{device_id}/step/{step_number}/execute`
특정 단계 실행

**파라미터**:
- `step_number`: 1-7
- `csv_file`: Step 3에서 필요 (MIS ID CSV 파일)
- `excel_file`: Step 4, 5에서 필요 (신청정보 엑셀 파일)
- `redundancy_file`: Step 7에서 필요 (중복정책 분석 결과 파일)
- `vendor`: Step 6에서 필요 ("paloalto" 또는 "secui")

**응답**:
```json
{
  "msg": "Step 3 실행 완료",
  "step": 3,
  "result": {
    "file_path": "/path/to/step3.xlsx"
  }
}
```

### 파일 다운로드

#### GET `/deletion-workflow/{device_id}/step/{step_number}/download`
단계별 결과 파일 다운로드

#### GET `/deletion-workflow/{device_id}/master/download`
마스터 파일 다운로드

#### POST `/deletion-workflow/{device_id}/final/export`
최종 결과 파일들 생성

**응답**:
```json
{
  "msg": "최종 결과 파일 생성 완료",
  "files": {
    "master": "/path/to/master.xlsx",
    "expired_used": "/path/to/expired_used.xlsx",
    "expired_unused": "/path/to/expired_unused.xlsx",
    "longterm_unused": "/path/to/longterm_unused.xlsx",
    "no_history_unused": "/path/to/no_history_unused.xlsx",
    "duplicate_notice": "/path/to/duplicate_notice.xlsx",
    "duplicate_delete": "/path/to/duplicate_delete.xlsx"
  }
}
```

#### GET `/deletion-workflow/{device_id}/final/download`
최종 결과 파일들 다운로드 (ZIP)

## 임시 파일 관리

### 저장 위치
`firewall_manager/temp/deletion_workflow/{device_id}/`

### 파일명 규칙
- 마스터 파일: `master_{timestamp}.xlsx`
- 단계별 결과: `step_{step_number}_{timestamp}.xlsx`
- 최종 결과: `final_{category}_{timestamp}.xlsx`

### 정리 정책
- 워크플로우 완료 후 N일 경과 시 자동 삭제 (기본값: 7일)
- `FileManager.cleanup_old_files()` 메서드로 수동 정리 가능

## 사용 예시

### 1. 워크플로우 시작

```python
# Step 1 실행
POST /deletion-workflow/1/start
```

### 2. Request ID 추출

```python
# Step 2 실행
POST /deletion-workflow/1/step/2/execute
```

### 3. MIS ID 업데이트

```python
# Step 3 실행 (CSV 파일 업로드)
POST /deletion-workflow/1/step/3/execute
Content-Type: multipart/form-data
csv_file: <file>
```

### 4. 신청정보 가공

```python
# Step 4 실행 (엑셀 파일 업로드)
POST /deletion-workflow/1/step/4/execute
Content-Type: multipart/form-data
excel_file: <file>
```

### 5. 신청정보 매핑

```python
# Step 5 실행
POST /deletion-workflow/1/step/5/execute
```

### 6. 예외처리

```python
# Step 6 실행
POST /deletion-workflow/1/step/6/execute?vendor=paloalto
```

### 7. 중복정책 분류

```python
# Step 7 실행 (중복정책 분석 결과 파일 업로드)
POST /deletion-workflow/1/step/7/execute
Content-Type: multipart/form-data
redundancy_file: <file>
```

### 8. 최종 결과 생성 및 다운로드

```python
# 최종 결과 생성
POST /deletion-workflow/1/final/export

# 최종 결과 다운로드 (ZIP)
GET /deletion-workflow/1/final/download
```

## 주의사항

1. **순차 실행**: 각 단계는 이전 단계의 결과를 사용하므로 순차적으로 실행해야 합니다.
2. **파일 업로드**: Step 3, 4, 7에서는 외부 파일 업로드가 필요합니다.
3. **설정 파일**: 실제 파싱 패턴은 설정 파일에서 관리해야 합니다.
4. **중복정책 분석**: Step 7을 실행하기 전에 RedundancyAnalyzer로 중복정책 분석을 먼저 실행해야 합니다.
5. **임시 파일**: 모든 중간 결과는 임시 파일로 저장되며, 워크플로우 완료 후 정리됩니다.

## 향후 개선 사항

1. 프론트엔드 UI 구현 (체크리스트 형태의 워크플로우 페이지)
2. 워크플로우 재시작 기능
3. 단계별 롤백 기능
4. 배치 처리 지원
5. 실시간 진행 상태 추적 (WebSocket)
6. 설정 파일 웹 UI에서 수정 가능

