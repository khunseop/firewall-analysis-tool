# Analysis 페이지 모듈형 통합 설계

## 배경 및 목표

현재 `AnalysisListPage`/`AnalysisDetailPage`는 6개 분석 유형(redundancy, unused, impact,
unreferenced_objects, risky_ports, over_permissive)을 `if (analysisType === '...')` 분기로
처리하는 단일 대형 파일이다. `deletion_workflow`는 별도 메뉴(`/deletion-workflow`)와 별도
백엔드 서브시스템(`deletion_workflow_projects`/`deletion_workflow_files` 전용 테이블)으로
완전히 분리되어 있다(백엔드 실행 오케스트레이션만 이전 작업에서 `AnalysisTask` 패턴으로
흡수됨 — DB 스키마·UI는 아직 분리 상태).

목표:
1. **UI 통합**: deletion_workflow를 Analysis 페이지 안으로 완전히 편입 — 별도 상단 메뉴 제거.
2. **모듈형 관리**: 분석 유형을 레지스트리 기반으로 관리해, 신규 분석 모듈 추가 시 기존
   파일들의 분기를 늘리지 않고 새 모듈 파일 + 레지스트리 등록만으로 끝나게 한다.
3. **확장성**: 곧 추가될 신규 분석 모듈은 deletion_workflow와 유사한 "프로젝트형"(이름+기준일을
   가진 프로젝트가 여러 번의 단계 실행에 걸쳐 진행됨) 구조다. 이 패턴을 재사용 가능하게 만든다.

## 범위 결정 (브레인스토밍에서 확정된 사항)

- **모듈 분류**: "일반 분석"(quick — 파라미터 선택→실행→그리드 결과, 기존 6종 + 향후 단발성 유형)과
  "프로젝트형"(project — 프로젝트 생성→여러 단계 순차 실행→위저드, deletion_workflow + 신규 모듈)
  두 가지로 나눈다. 화면에 이 용어가 노출되지는 않고, 내부 구현상의 구분일 뿐이다.
- **실행 로직은 공통화하지 않는다**: processors/WorkspaceRunner 같은 "단계를 어떻게 실행하는가"는
  모듈마다 완전히 다르므로 추상화하지 않고, 프로젝트/파일 저장소(백엔드 데이터 계층)와 실행
  오케스트레이션 *패턴*(코드 재사용이 아니라 구조 재사용)만 공유한다.
- **프로젝트/파일 저장소는 공유한다**: `deletion_workflow_projects`/`deletion_workflow_files`를
  `analysis_projects`/`analysis_project_files`로 일반화하고 `module_type` 컬럼으로 구분한다.
  신규 모듈은 이 테이블을 그대로 재사용하고 자기 전용 실행 엔드포인트만 추가하면 된다.
- **이력 목록**: 기본 테이블은 "일반 분석" 실행 이력(장비/유형/상태/생성일, 기존과 동일 스키마).
  유형 필터에 프로젝트형 모듈도 옵션으로 추가되며, 프로젝트형을 선택하면 테이블이 "프로젝트
  목록"(이름/상태/기준일/수정일, **1프로젝트 = 1행**, 개별 파이프라인 단계 실행은 노출 안 함)으로
  전환된다. **"전체" 필터에서도 두 종류가 날짜순으로 섞여 보여야 한다** — 백엔드에서 하나의 SQL로
  UNION하지 않고, 프론트에서 두 소스(quick 목록 + 전체 프로젝트 목록)를 넉넉히 가져와 날짜순으로
  병합·정렬 후 페이지네이션한다(페이지 경계에서 정확히 20:20으로 안 나뉠 수 있으나 실사용에는
  무해한 근사치로 허용).

## 백엔드 설계

### 데이터 모델

- `deletion_workflow_projects` → `analysis_projects`로 rename. `module_type VARCHAR NOT NULL`
  컬럼 추가(예: `'deletion_workflow'`, 향후 신규 모듈 키). 기존 컬럼(device_id, name, status,
  memo, reference_date, created_at, updated_at)은 유지.
- `deletion_workflow_files` → `analysis_project_files`로 rename. 컬럼 그대로(project_id, task_id,
  slot, filename, file_data, created_at, analysis_task_id).
- `AnalysisTask.deletion_workflow_project_id` → `analysis_project_id`로 rename(모듈 무관 범용
  명칭). `pipeline_task_id`는 이미 범용적이라 이름 유지("이 모듈 안에서 몇 번째 단계인가").
- 모델 파일: `app/models/deletion_workflow.py` → `app/models/analysis_project.py`로 이동,
  클래스명 `DeletionWorkflowProject`/`DeletionWorkflowFile` → `AnalysisProject`/`AnalysisProjectFile`.

### CRUD/엔드포인트

- `app/crud/crud_deletion_workflow.py` → `app/crud/crud_analysis_project.py`. `create_project`/
  `list_projects`가 `module_type` 인자를 받도록 일반화. 파일 관련 함수는 project_id로 이미
  스코프되므로 변경 최소.
- **공용 라우터** `app/api/api_v1/endpoints/analysis_projects.py` (`/api/v1/analysis/projects`
  prefix): `GET/POST /projects?module_type=`, `GET/DELETE/PATCH /projects/{id}`,
  `GET /projects/{id}/tasks`(파이프라인 실행 이력), `GET /projects/{id}/tasks/{analysis_task_id}/result`.
- **모듈 전용 라우터**(`deletion_workflow.py`, prefix `/api/v1/deletion-workflow`): `extract`,
  `tasks/{id}/upload`, `tasks/{id}/run`, `tasks/{id}/download`, `reset-outputs`, `reset-all`,
  `clear-outputs`, `complete` — 그대로 유지하되 새 `analysis_projects`/`analysis_project_files`
  테이블을 바라보도록 import만 갱신.
- `services/deletion_workflow/tasks.py`는 구조 변경 없이 새 CRUD 모듈만 import하도록 갱신.

### 마이그레이션

1. `alembic revision --autogenerate`로 rename 감지 확인 후 `op.rename_table` 기반으로 직접
   작성(autogenerate는 rename을 drop+create로 오인식하는 경우가 많아 수동 조정 필요).
   `module_type` 컬럼 추가(`server_default='deletion_workflow'`로 기존 행 채움 후 default 제거,
   또는 nullable 없이 일괄 UPDATE).
2. `AnalysisTask.deletion_workflow_project_id` 컬럼 rename(SQLite는 `ALTER TABLE RENAME COLUMN`
   미지원 버전 고려해 batch_alter_table 사용).

## 프론트엔드 설계

### 모듈 레지스트리

`frontend/src/config/analysisModules.ts` — 두 종류의 모듈 디스크립터:

```ts
type QuickAnalysisModule = {
  kind: 'quick'
  type: string
  label: string; icon: LucideIcon; description: string
  renderParams?: (ctx) => ReactNode
  buildParams: (ctx) => StartAnalysisParams
  columns: (onRuleNameClick, onPreviewClick) => ColDef[]
  summary: (results) => string
  rowStyle?: (...) => RowStyle
  downloadScript?: (...) => void
}

type ProjectAnalysisModule = {
  kind: 'project'
  type: string  // module_type 값
  label: string; icon: LucideIcon; description: string
  listRoute: (moduleType: string) => string
  detailRoute: (moduleType: string, id: number | string) => string
}
```

기존 6종은 `frontend/src/components/pages/analysis-modules/`에 파일 하나씩으로 분리(예:
`redundancy.ts`, `impact.tsx`). `deletion_workflow` 모듈은 `kind: 'project'`로 등록.
`AnalysisListPage`/`AnalysisDetailPage`의 하드코딩된 분기는 이 레지스트리를 순회하는 방식으로 교체.

### 페이지 구조

- `AnalysisListPage`(`/analysis`): "새 분석 실행" 다이얼로그는 레지스트리의 모든 모듈을 카드로
  보여준다. quick 모듈 선택 시 기존과 동일한 파라미터 폼. project 모듈 선택 시 "장비 선택 + 새
  프로젝트 만들기" 미니폼(이름/기준일은 프로젝트 내부에서 지정 — 여기선 장비만) → 생성 즉시 해당
  모듈의 상세 라우트로 이동.
- 이력 목록: 유형 필터가 "전체"/quick 유형들/project 유형들을 모두 옵션으로 제공.
  - quick 유형 선택 시: 기존 `GET /analysis/tasks` 그대로.
  - project 유형 선택 시: `GET /analysis/projects?module_type=X` 기반 프로젝트 행 렌더링(이름/
    상태/기준일/수정일), 클릭 시 해당 모듈의 상세(위저드) 라우트로 이동.
  - "전체" 선택 시: 두 소스를 각각 넉넉히(top N) 가져와 클라이언트에서 날짜순 병합 후 표시.
- `AnalysisDetailPage`(`/analysis/:taskId`): quick 모듈 결과 뷰. 로직은 레지스트리의 `columns`/
  `summary`/`rowStyle`/`downloadScript`를 사용하도록 리팩터(동작 동일, 구조만 변경).
- 신규 `ProjectListPage`(`/analysis/projects/:moduleType`): 프로젝트형 모듈 공용 목록 페이지.
  모듈 레지스트리에서 라벨/아이콘을 가져와 헤더에 표시, 생성/삭제는 공용 API 사용.
- `DeletionWorkflowDetailPage`는 그대로 재사용하되 라우트만 `/analysis/projects/deletion_workflow/:id`로
  이동. 내부 API 호출부(`api/deletionWorkflow.ts`)는 프로젝트 CRUD 부분만 공용 엔드포인트로 갱신하고,
  실행(`run`/`extract`/`upload`/`download`/`complete`) 관련 함수는 기존 `/deletion-workflow/...`
  경로 그대로 유지.

### 라우팅/네비게이션

- 유지: `/analysis`, `/analysis/:taskId`
- 신규: `/analysis/projects/:moduleType`, `/analysis/projects/:moduleType/:id`
- 제거: 최상단 "Deletion Workflow" 네비게이션 항목 (`Navbar.tsx`)
- 구 경로 `/deletion-workflow`, `/deletion-workflow/:id` → 새 경로로 redirect(북마크 대비)
- `/deletion-workflow/legacy`(프로젝트 없는 단발 실행)는 이번 범위 밖. `ProjectListPage` 안에
  작은 링크로만 남긴다.

## 구현 순서 (각 단계 후 빌드/스모크 검증)

1. 백엔드: 테이블 rename + `module_type` 컬럼 + CRUD/공용 엔드포인트 일반화 (마이그레이션 포함)
2. 프론트: 모듈 레지스트리 추출 + 기존 6종 리팩터 (동작 변화 없음, 순수 구조 개편 — 회귀 확인)
3. 프론트: 프로젝트형 모듈 지원 (`ProjectListPage` 신설, deletion_workflow 라우트 이전, "전체"
   병합 뷰)
4. 네비게이션 정리 + 구 경로 redirect
5. 문서화 (`CLAUDE.md`, `docs/DATABASE.md`)

## 명시적 비범위 (Out of Scope)

- 파이프라인 실행 로직(processors, WorkspaceRunner류)의 공통 프레임워크화
- 신규 분석 모듈의 실제 구현(이 스펙은 통합 구조만 다룸 — 신규 모듈은 이 구조 위에 별도 스펙으로 추가)
- `/deletion-workflow/legacy`(단발 실행 페이지)의 통합
