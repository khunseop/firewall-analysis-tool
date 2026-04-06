# UI/UX 개선 보고서: 방화벽 정책 (Firewall Policies)

정책 페이지는 시스템 내에서 가장 정보 집약적인 화면입니다. 거대한 데이터를 효율적으로 탐색하고 임계치 이상의 정보를 빠르게 필터링하기 위한 개선 방안을 제시합니다.

---

## 1. 2단계 검색 시스템 (Search & Filter)

### 1.1 통합 검색바 (Global Search)
- **현황**: 상단의 퀵 검색바와 어드밴스드 필터 버튼이 다소 평이합니다.
- **개선**: 
  - 검색바 포커스 시 `ds-tertiary` 하단 언더라인 글로우(Glow) 효과를 추가하십시오.
  - "Advanced Filters" 버튼은 토글 시 아이콘 변화를 더 역동적으로 만들고, 활성화 상태를 `ds-tertiary`로 명확히 표시하십시오.

### 1.2 어드밴스드 필터 패널 (Advanced Panel)
- **현황**: 필터 패널이 단순히 그리드 형태로 배치되어 가독성이 떨어집니다.
- **개선**: 
  - 패널 배경에 `glass-panel` 효과와 `bg-ds-surface-container-low/40`을 적용하십시오.
  - 필터들을 기능별(IP 정보, 프로토콜/액션, 메타데이터 등)로 미세하게 그룹화하여 사용자 인지 속도를 높이십시오.

---

## 2. 활성 필터 태그 (Active Filter Tags)

### 2.1 칩(Chip) 디자인 고도화
- **현황**: 검색 필터 적용 후 하단에 표시되는 태그들이 기본적인 형태입니다.
- **개선**: 
  - 각 필터 태그에 `bg-ds-tertiary/10`과 `text-ds-tertiary`를 적용하고, `X` 아이콘을 통해 즉각적으로 필터를 해제할 수 있는 기능을 강화하십시오.
  - "전체 초기화(Reset)" 버튼은 텍스트보다는 `ds-on-surface-variant` 색상의 고스트 버튼 스타일로 배치하십시오.

---

## 3. 고밀도 정책 데이터 테이블 (Policy Grid)

### 3.1 렌더러 최적화 (Cell Renderers)
- **현황**: `ACTION_BADGE`나 `TagCell`(칩 형태의 IP/포트)이 기본 Tailwind 색상을 사용 중입니다.
- **개선**: 
  - **Action**: `ALLOW`는 `bg-ds-secondary-container`, `DENY`는 `bg-ds-error-container/20` 토큰으로 교체하십시오.
  - **TagCell**: IP 주소나 서비스 명칭은 `font-mono`와 `text-[11px]`를 적용하고, 클릭 시 오브젝트 상세 정보를 보여주는 인터랙션을 `ds-tertiary` 색상으로 강조하십시오.

### 3.2 가로 스크롤 및 정보 밀도 (Data Density)
- **현황**: 컬럼이 10개 이상으로 많아 가로 스크롤이 불가피하며, 핵심 정보(ID, Rule Name, Action)가 묻힐 수 있습니다.
- **개선**: 
  - 주요 컬럼(ID, Rule Name)은 좌측에 **고정(Pinned)** 처리하십시오.
  - 컬럼 헤더에 `ds-primary` 색상과 `label-md` 스타일을 적용하여 데이터와 확실히 구분하십시오.

---

## 4. 시각적 가이드 및 피드백

### 4.1 사용 기록 없음(Last Hit) 강조
- **현황**: 90일 이상 미사용 시 `ds-error` 색상으로 경고를 주지만, 전체 테이블에서 눈에 잘 띄지 않을 수 있습니다.
- **개선**: 미사용 데이터의 행(Row) 배경색을 아주 옅은 `bg-ds-error-container/5`로 처리하거나, 행 좌측에 `AlertTriangle` 아이콘을 작게 배치하여 시각적 주의를 환기하십시오.
