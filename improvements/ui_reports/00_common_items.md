# UI/UX 개선 보고서: 공통 항목 (Common Items)

본 보고서는 "Precision Sentinel" 디자인 시스템의 일관된 적용과 시스템 전반의 사용성 향상을 위한 공통 개선 사항을 다룹니다.

---

## 1. 구조 및 레이아웃 (Layout & Structure)

### 1.1 "No-Line" 원칙의 엄격한 적용
- **현황**: 현재 카드나 섹션 구분 시 `ghost-border` (1px 테두리) 클래스를 과도하게 사용하고 있습니다.
- **개선**: `DESIGN.md` 가이드에 따라 1px 테두리보다는 **배경색의 미세한 변화(Tonal Layering)**를 통해 섹션을 구분하십시오.
  - 기본 배경: `bg-ds-surface` (#f7f9fb)
  - 사이드바/서브 섹션: `bg-ds-surface-container` (#e8eff3)
  - 카드/핵심 워크스페이스: `bg-ds-surface-container-lowest` (#ffffff)
- **효과**: 시각적 노이즈를 줄이고 데이터가 돋보이는 "Breathable"한 UI를 완성합니다.

### 1.2 사이드바 네비게이션 고도화
- **현황**: 현재 사이드바의 활성화 상태(`bg-ds-tertiary/10`)가 다소 밋밋합니다.
- **개선**: 활성화된 메뉴 옆에 2px 너비의 `tertiary` 색상 수직 바(Indicator)를 추가하고, 아이콘과 텍스트의 대비를 높여 현재 위치를 명확히 인지하게 합니다.

---

## 2. 디자인 시스템 토큰 적용 (Design Tokens)

### 2.1 시맨틱 컬러 매핑 (Semantic Color Mapping)
- **현황**: `success`, `error`, `warning` 등의 상태값 표시 시 Tailwind 기본 색상(`bg-green-100` 등)을 하드코딩하여 사용 중입니다.
- **개선**: `ds-` 접두사가 붙은 디자인 시스템 컬러 토큰으로 전면 교체하십시오.
  - **Success**: `bg-ds-secondary-container` / `text-ds-on-secondary-container`
  - **Error**: `bg-ds-error-container/20` / `text-ds-error`
  - **Warning**: `bg-ds-tertiary-container/30` / `text-ds-on-tertiary-container`
- **효과**: 브랜드 고유의 컬러 톤을 유지하면서 상태 정보를 정확히 전달합니다.

### 2.2 주요 액션 버튼(CTA) 스타일
- **현황**: "조회", "동기화", "저장" 등 핵심 버튼이 일반적인 고스트 또는 단색 스타일입니다.
- **개선**: 핵심 버튼에 `btn-primary-gradient` (135도 선형 그래디언트)를 적용하여 시각적 위계(Hierarchy)를 강화하십시오.

---

## 3. 고밀도 데이터 테이블 (High-Density Data Table)

### 3.1 AG-Grid 테마 정밀 조정
- **현황**: 현재 AG-Grid 테마가 시스템의 "No-Line" 원칙과 다소 상충(행 구분선이 뚜렷함)합니다.
- **개선**: 행 구분선의 불투명도를 `10%` 이하로 낮추고, 폰트 크기를 `label-md` (12px)로 조정하며, 헤더는 대문자(`uppercase`)와 넓은 자간(`tracking-widest`)을 적용하여 전문적인 느낌을 강화합니다.

### 3.2 로딩 및 빈 데이터 상태 (Empty States)
- **현황**: 데이터 로드 중이거나 없을 때의 처리가 텍스트 위주로 단순합니다.
- **개선**: 로딩 시에는 `ds-tertiary` 색상의 정교한 스피너를, 빈 데이터 시에는 시스템 아이콘과 함께 안내 문구를 `ds-on-surface-variant` 색상으로 배치하십시오.

---

## 4. 상호작용 및 피드백 (Interaction & Feedback)

### 4.1 Glassmorphism 적용
- **현황**: 모달, 드롭다운, 검색 필터 오버레이가 불투명하여 깊이감이 부족합니다.
- **개선**: 부유하는 요소(Floating elements)에 `glass-panel` 유틸리티(`backdrop-blur-xl`, `bg-white/75`)를 적용하여 레이어 간의 논리적 깊이를 형성하십시오.

### 4.2 툴팁 및 도움말 시스템
- **현황**: "상합", "하합", "리스크" 등 전문 용어에 대한 설명이 부족합니다.
- **개선**: 주요 용어 옆에 미세한 `?` 아이콘을 배치하고, 마우스 오버 시 디자인 시스템 스타일의 툴팁(`ambient-shadow` 적용)을 노출하십시오.
