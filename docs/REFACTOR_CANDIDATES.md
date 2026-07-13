# 리팩토링 후보 (대형 파일)

500줄이 넘는 파일 목록과 분리 방향 제안입니다. 실제 분리는 아직 진행하지 않았으며, 우선순위 판단과 향후 작업 계획용 메모입니다. 파일 크기 컨벤션(코드 파일 1000줄 이내)은 아직 위반되지 않았지만, AI 코딩 시 "한 파일이 너무 많은 책임을 가지면 의도치 않은 부분까지 수정 범위에 들어가기 쉬우므로" 아래 순서로 분리를 검토하세요.

## 백엔드

| 파일 | 줄수 | 분리 방향 |
|---|---|---|
| `app/api/api_v1/endpoints/devices.py` | 769 | CRUD(`create/read/update/delete`), bulk-import/export, direct-export를 별도 서브 라우터 모듈로 분리하고 `devices.py`는 라우터 등록만 담당 |
| `app/api/api_v1/endpoints/deletion_workflow.py` | 719 | 태스크 실행(`/tasks/*`)과 프로젝트 CRUD(`/projects/*`)를 각각 다른 라우터 파일로 분리 — 이미 책임이 두 갈래로 나뉘어 있어 분리 기준이 명확함 |
| `app/services/sync/tasks.py` | 703 | `run_sync_all_orchestrator`(오케스트레이션)와 `sync_data_task`(DB upsert 비교 로직), HA 히트 병합 로직(`_collect_last_hit_date_parallel`)을 파일 단위로 분리 — `services/sync/README.md`에 이미 책임이 잘 문서화되어 있어 그 경계를 그대로 파일 경계로 사용 가능 |
| `app/services/analysis/risky_ports.py` | 647 | 위험 포트 DB 매칭 로직과 결과 집계/포맷팅 로직 분리 |
| `app/services/analysis/impact.py` | 642 | 영향도 분석의 시나리오별(정책 삭제 영향 vs 이동 영향) 계산을 별도 모듈로 분리 |
| `app/api/api_v1/endpoints/firewall_query.py` | 630 | 정책 조회/객체 조회/검색 필터 파싱을 관심사별로 분리 |
| `app/services/firewall/vendors/paloalto.py` | 580 | XML API 클라이언트 부분과 SSH 기반 히트 정보 수집 부분을 별도 모듈로 분리 (`services/firewall/README.md`의 데이터 규격 섹션과 자연스럽게 매핑됨) |
| `app/services/firewall/vendors/mf2.py` | 536 | SSH 접속/세션 관리와 CLI 출력 정규식 파싱 로직 분리 |
| `app/crud/crud_policy.py` | 509 | 범위 기반 검색 쿼리 빌더와 일반 CRUD(`base.py` 래핑) 부분을 분리 |

## 프론트엔드

| 파일 | 줄수 | 분리 방향 |
|---|---|---|
| `components/pages/DeletionWorkflowDetailPage.tsx` | 756 | 이미 있는 `pages/deletion-workflow/`(태스크 카드) 패턴을 이 페이지에도 적용 — 태스크 실행 UI, 파일 업로드/다운로드 UI를 하위 컴포넌트로 분리 |
| `components/pages/PoliciesPage.tsx` | 651 | 검색/필터 영역과 그리드·상세 모달 연동 로직을 분리 (`pages/policies/` 디렉터리 신설) |
| `components/pages/DeletionWorkflowPage.tsx` | 622 | 프로젝트 목록/생성 다이얼로그를 `pages/deletion-workflow/`로 이동 |
| `components/pages/DevicesPage.tsx` | 567 | 이미 있는 `pages/devices/`(다이얼로그·그리드 셀) 패턴을 페이지 본체에도 더 적용 — bulk-import/export 다이얼로그를 하위 컴포넌트로 분리 |
| `components/pages/DashboardPage.tsx` | 545 | 통계 카드/차트 블록 단위로 하위 컴포넌트 분리 |
| `components/shared/PolicyDetailModal.tsx` | 505 | 정책 상세 탭(기본정보/객체/이력)을 탭별 하위 컴포넌트로 분리 |

## 참고
- `services/deletion_workflow/`는 이미 `core/`, `processors/`, `utils/`로 잘게 분리되어 있어 참고할 만한 선례입니다.
- 분리 작업은 테스트/검증이 필요한 규모이므로, 진행 시 별도 작업으로 계획하고 한 파일씩 순차적으로 진행하는 것을 권장합니다.
