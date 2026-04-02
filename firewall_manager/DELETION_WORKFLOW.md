# 정책 삭제 워크플로우 문서

## 개요

정책 삭제 워크플로우는 방화벽 정책과 신청 시스템 정보를 결합하여 삭제 가능한 정책을 식별하고 예외처리될 정책들을 관리하는 체크리스트 방식의 순차 프로세서입니다.

API 레퍼런스 및 사용 가이드는 [DELETION_WORKFLOW_GUIDE.md](DELETION_WORKFLOW_GUIDE.md)를 참고하세요.

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

**입력**: DB의 Policy 테이블 (device_id 기준)

**처리**: 정책 description에서 정규표현식 패턴으로 신청정보 추출 — Request Type, Request ID, Ruleset ID, MIS ID, Request User, Start Date, End Date 파싱

**출력**: 임시 엑셀 파일 (다운로드 가능), 마스터 파일 경로 업데이트

**설정**: `parsing_patterns.gsams3`, `parsing_patterns.gsams1_rulename`, `parsing_patterns.gsams1_description`

### Step 2: RequestExtractor (Request ID 추출)

**목적**: Step 1 결과에서 Request Type과 Request ID만 추출하여 중복제거합니다.

**처리**: Request Type과 Request ID 컬럼 추출, 중복 제거, Request Type별로 시트 분리

**출력**: Request Type별 시트가 있는 엑셀 파일 (외부 신청 시스템 담당자에게 전달용)

### Step 3: MisIdAdder (MIS ID 업데이트)

**목적**: CSV 파일에서 MIS ID를 읽어서 마스터 파일을 업데이트합니다.

**입력**: 마스터 파일 + CSV 파일 (MIS ID 매핑, 업로드)

**처리**: CSV에서 ruleset_id ↔ mis_id 매핑 읽기, 마스터 파일의 Ruleset ID와 매칭하여 업데이트

### Step 4: ApplicationAggregator (신청정보 가공)

**목적**: 외부에서 받은 신청정보 엑셀 파일을 앱 형식에 맞게 가공합니다.

**입력**: 신청정보 엑셀 파일 (외부 업로드, Step 2에서 전달한 Request ID 기반)

**처리**: 여러 시트 취합, 날짜 형식 변환 (YYYYMMDD → YYYY-MM-DD), REQUEST_END_DATE 내림차순 정렬

### Step 5: RequestInfoAdder (신청정보 매핑)

**목적**: Step 4 결과를 Step 1 파싱 결과와 매핑하여 정책-신청건을 연결합니다.

**처리**: 정책의 Request ID ↔ 신청정보의 REQUEST_ID 매칭, GROUP 타입 추가 조건 매칭, 자동 연장 ID 탐색 및 REQUEST_STATUS 설정

### Step 6: ExceptionHandler (예외처리)

**목적**: 예외 정책을 분류합니다.

**처리 분류**: 예외 신청정책 (except_list 기반), 신규정책 (최근 3개월 이내), 자동연장정책 (REQUEST_STATUS == 99), 인프라정책 (deny-std 이전), 비활성화정책 (Enable == 'N'), 기준정책, 차단정책 (Action == 'deny'), 만료여부 계산

### Step 7: DuplicatePolicyClassifier (중복정책 분류)

**목적**: 중복정책 분석 결과와 신청정보를 결합하여 공지용/삭제용으로 분류합니다.

**입력**: 마스터 파일 + 중복정책 분석 결과 파일 (RedundancyAnalyzer 결과) + 신청정보 파일

**처리**: 같은 신청자 중복셋 → 삭제용, 다른 신청자간 중복셋 → 공지용

**출력**: 중복정책_공지용 파일, 중복정책_삭제용 파일

### Step 10: 최종 결과 생성

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

### 주요 설정 항목

```json
{
  "columns": {
    "all": ["예외", "만료여부", "신청이력", "Rule Name", ...],
    "date_columns": ["REQUEST_START_DATE", "REQUEST_END_DATE", ...]
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

## 임시 파일 관리

- **저장 위치**: `firewall_manager/temp/deletion_workflow/{device_id}/`
- **파일명 규칙**: 마스터 파일 `master_{timestamp}.xlsx`, 단계별 결과 `step_{N}_{timestamp}.xlsx`, 최종 결과 `final_{category}_{timestamp}.xlsx`
- **정리 정책**: 워크플로우 완료 후 N일 경과 시 자동 삭제 (기본값: 7일), `FileManager.cleanup_old_files()`로 수동 정리

## 주의사항

1. **순차 실행**: 각 단계는 이전 단계의 결과를 사용하므로 순차적으로 실행해야 합니다.
2. **파일 업로드**: Step 3, 4, 7에서는 외부 파일 업로드가 필요합니다.
3. **설정 파일**: 실제 파싱 패턴은 설정 파일에서 관리해야 합니다.
4. **중복정책 분석**: Step 7을 실행하기 전에 RedundancyAnalyzer로 중복정책 분석을 먼저 실행해야 합니다.
5. **임시 파일**: 모든 중간 결과는 임시 파일로 저장되며, 워크플로우 완료 후 정리됩니다.
