# Policy Deletion Processor 이식 계획

## 프로젝트 개요

`policy_deletion_processor` 모듈을 체크리스트 방식의 순차 프로세서로 이식하여 정책 삭제 가능 여부 식별 및 예외처리 관리 기능을 구현합니다.

## 구현 상태

### ✅ 완료된 항목

#### Phase 1: 기본 인프라 구축
- ✅ DeletionWorkflow 모델 생성 및 마이그레이션
- ✅ 임시 파일 관리 시스템 구현
- ✅ Excel 관리 유틸리티 구현
- ✅ ConfigManager 구현

#### Phase 2: 프로세서 구현
- ✅ Step 1: RequestParser 구현
- ✅ Step 2: RequestExtractor 구현
- ✅ Step 3: MisIdAdder 구현
- ✅ Step 4: ApplicationAggregator 구현
- ✅ Step 5: RequestInfoAdder 구현
- ✅ Step 6: ExceptionHandler 구현
- ✅ Step 7: DuplicatePolicyClassifier 구현
- ✅ 최종 결과 생성기 구현

#### Phase 3: API 및 워크플로우 관리
- ✅ 워크플로우 관리 API 구현
- ✅ Step별 API 엔드포인트 구현
- ✅ CRUD 작업 구현
- ✅ 워크플로우 매니저 구현

### ⏳ 진행 중 / 미완료 항목

#### Phase 4: 프론트엔드
- ⏳ 워크플로우 페이지 UI 구현
- ⏳ 체크리스트 컴포넌트 구현
- ⏳ 파일 업로드/다운로드 UI 구현

#### Phase 5: 통합 및 테스트
- ⏳ 전체 워크플로우 통합 테스트
- ⏳ 최종 결과 파일 생성 검증
- ⏳ 성능 최적화

## 워크플로우 단계

### Step 1: RequestParser (신청정보 파싱)
- **상태**: ✅ 완료
- **입력**: DB의 Policy.description 필드
- **출력**: 임시 엑셀 파일 (파싱된 신청정보)
- **주의사항**: 실제 파싱 패턴은 설정 파일에서 관리 필요

### Step 2: RequestExtractor (Request ID 추출)
- **상태**: ✅ 완료
- **입력**: Step 1 결과 파일
- **출력**: Request Type별 시트가 있는 엑셀 파일

### Step 3: MisIdAdder (MIS ID 업데이트)
- **상태**: ✅ 완료
- **입력**: 마스터 파일 + CSV 파일 (업로드)
- **출력**: 업데이트된 마스터 파일

### Step 4: ApplicationAggregator (신청정보 가공)
- **상태**: ✅ 완료
- **입력**: 신청정보 엑셀 파일 (외부에서 업로드)
- **출력**: 가공된 신청정보 엑셀 파일

### Step 5: RequestInfoAdder (신청정보 매핑)
- **상태**: ✅ 완료
- **입력**: 마스터 파일 + 신청정보 파일
- **출력**: 신청정보가 추가된 마스터 파일

### Step 6: ExceptionHandler (예외처리)
- **상태**: ✅ 완료
- **입력**: 마스터 파일
- **출력**: 예외 컬럼이 추가된 마스터 파일

### Step 7: DuplicatePolicyClassifier (중복정책 분류)
- **상태**: ✅ 완료
- **입력**: 마스터 파일 + 중복정책 분석 결과 + 신청정보 파일
- **출력**: 중복정책_공지용, 중복정책_삭제용 파일

### Step 10: 최종 결과 생성
- **상태**: ✅ 완료
- **입력**: 마스터 파일 + 중복정책 분류 결과
- **출력**: 7개 엑셀 파일 (마스터 + 공지 4개 + 중복 2개)

## API 엔드포인트

### 구현 완료
- ✅ `GET /deletion-workflow/{device_id}/status` - 워크플로우 상태 조회
- ✅ `POST /deletion-workflow/{device_id}/start` - 워크플로우 시작
- ✅ `POST /deletion-workflow/{device_id}/step/{step_number}/execute` - 단계 실행
- ✅ `GET /deletion-workflow/{device_id}/step/{step_number}/download` - 단계 결과 다운로드
- ✅ `GET /deletion-workflow/{device_id}/master/download` - 마스터 파일 다운로드
- ✅ `POST /deletion-workflow/{device_id}/final/export` - 최종 결과 생성
- ✅ `GET /deletion-workflow/{device_id}/final/download` - 최종 결과 다운로드 (ZIP)

## 설정 파일

### 위치
`firewall_manager/config/deletion_workflow_config.json`

### 필수 설정 항목
- `parsing_patterns.gsams3`: GSAMS3 패턴 (현재 빈 문자열, 실제 패턴 설정 필요)
- `parsing_patterns.gsams1_rulename`: GSAMS1 규칙명 패턴
- `parsing_patterns.gsams1_description`: GSAMS1 설명 패턴
- `except_list`: 예외 신청정책 ID 목록

## 다음 단계

1. **프론트엔드 UI 구현**
   - 워크플로우 페이지 생성
   - 체크리스트 컴포넌트 구현
   - 파일 업로드/다운로드 UI

2. **통합 테스트**
   - 전체 워크플로우 엔드투엔드 테스트
   - 각 단계별 검증

3. **설정 파일 완성**
   - 실제 파싱 패턴 설정
   - 예외 리스트 설정

4. **성능 최적화**
   - 대량 정책 처리 최적화
   - 파일 I/O 최적화

## 참고 문서

- [DELETION_WORKFLOW.md](./DELETION_WORKFLOW.md) - 상세 문서
- [DELETION_WORKFLOW_IMPLEMENTATION_STATUS.md](./DELETION_WORKFLOW_IMPLEMENTATION_STATUS.md) - 구현 상태 상세

