# UI/UX 개선사항

웹 UI(127.0.0.1:8000) 직접 확인 기준 (2026-04-04)

---

## 심각도: 높음

### 1. 정책 페이지 테이블 가로 오버플로우
- **위치**: `app/frontend/templates/policies.html`, `app/frontend/js/pages/policies.js`
- **문제**: 9개 이상 컬럼(정책명, 활성화, 액션, 출발지, 목적지, 서비스, 적용, 로그 등) 표시 시 가로 스크롤 발생. 스크롤 가능 여부 시각적 표시 없음
- **개선**: AG-Grid 컬럼 숨김/표시 토글 추가, 기본 표시 컬럼 수 축소, 가로 스크롤 바 항상 표시

### 2. 모바일 반응형 미지원
- **위치**: `app/frontend/styles/modules/grid.css`, 각 페이지 JS
- **문제**: 장비 관리, 정책 조회 페이지의 테이블이 모바일(375px)에서 컬럼 잘림, 가로 스크롤 불가. 사실상 사용 불가
- **개선**: 모바일에서 주요 컬럼만 표시하는 반응형 AG-Grid 설정 추가 또는 카드형 레이아웃 전환

### ~~3. 잘린 텍스트 툴팁 없음~~ ✅ (2026-04-05 완료)
- **위치**: `app/frontend/js/pages/policies.js`
- **완료 내용**: 정책명, 출발지, 목적지, 서비스, 애플리케이션, 사용자, 설명 컬럼에 `tooltipValueGetter` 추가. 그리드 `tooltipShowDelay: 300ms` 설정.

### ~~4. 색상 코드 미설명~~ ✅ (2026-04-05 완료)
- **위치**: `app/frontend/templates/analysis.html`, `app/frontend/js/pages/analysis.js`
- **완료 내용**: 분석 결과 그리드 위에 색상 범례 추가 (상위 정책=파란 좌측 테두리, 하위 정책=주황 좌측 테두리). 중복정책 분석 시에만 표시.

---

## 심각도: 중간

### ~~5. 설정 페이지 "일반 설정" 탭 내용 미표시~~ ✅ (2026-04-05 완료)
- **위치**: `app/frontend/templates/settings.html`, `app/frontend/js/pages/settings.js`
- **완료 내용**: 기본 활성 탭을 "logs"에서 "general"로 변경. `tab-schedules`, `tab-logs`에 `display:none` 추가. `initSettings`에서 기본 탭을 `general`로 변경.

### ~~6. 필터/검색 시 로딩 상태 없음~~ ✅ (2026-04-05 완료)
- **위치**: `app/frontend/js/pages/policies.js`
- **완료 내용**: 정책 검색 시 `policyGridApi.showLoadingOverlay()` 호출. 데이터 로드 완료 후 `hideOverlay()` 호출.

### ~~7. 정책 삭제 워크플로우 기능 설명 없음~~ ✅ (2026-04-05 완료)
- **위치**: `app/frontend/templates/deletion_workflow.html`
- **완료 내용**: 기능 설명 배너(info) 및 삭제 위험 경고 배너(danger) 추가.

### ~~8. 정책 페이지 컬럼 헤더 "=" 구분자~~ (미재현)
- **위치**: `app/frontend/js/pages/policies.js` (AG-Grid columnDefs)
- **현황**: `policies.js` columnDefs에서 "=" 구분자 컬럼 미발견. 코드상 해당 컬럼 정의 없음.

---

## 심각도: 낮음

### 9. 과도한 여백
- **위치**: 대시보드, 삭제 워크플로우 페이지
- **문제**: 컨텐츠 아래 빈 공간이 과도하게 넓음
- **개선**: CSS min-height 또는 flex 레이아웃 조정

### 10. 일괄 작업(Bulk Action) 불명확
- **위치**: 장비 관리 페이지 테이블
- **문제**: 체크박스가 표시되나 선택 후 수행 가능한 일괄 작업이 UI에 노출되지 않음
- **개선**: 선택 시 "선택 항목 삭제" 등 액션 버튼 표시 또는 체크박스 제거

### 11. 도메인 용어 도움말 없음
- **위치**: 분석 페이지, 정책 페이지 전반
- **문제**: "상합 정책", "하위 정책", "리스크 포트" 등 도메인 특화 용어에 설명 없음
- **개선**: 용어 옆 `?` 아이콘 + 툴팁 설명 추가

---

## 접근성 이슈

- 색상만으로 상태 구분 (색맹 사용자 고려 필요) → 색상 + 아이콘 병행
- 키보드 탐색 미검증
- 모바일에서 일부 텍스트 지나치게 작음
