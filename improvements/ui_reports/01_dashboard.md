# UI/UX 개선 보고서: 대시보드 (Dashboard)

대시보드는 시스템의 상태를 한눈에 파악하는 핵심 워크스페이스입니다. 실시간 데이터의 가독성과 시각적 권위를 높이기 위한 개선 사항을 제안합니다.

---

## 1. 시각적 요약 및 통계 (Stat Cards)

### 1.1 카드 레이아웃 및 깊이감
- **현황**: 통계 카드가 `ghost-border`와 `ambient-shadow`를 동시에 사용하고 있어 디자인이 다소 무겁습니다.
- **개선**: `ghost-border`를 제거하고, 배경색을 `bg-ds-surface-container-lowest` (#ffffff)로 설정하여 `bg-ds-surface` (#f7f9fb) 배경과의 톤 차이로만 구분하십시오.
- **효과**: 카드가 부드럽게 떠 있는 느낌을 주어 가독성을 높입니다.

### 1.2 수치 강조 (Typography)
- **현황**: 수치 텍스트(`3.4k` 등)의 폰트가 본문 폰트와 동일합니다.
- **개선**: `DESIGN.md` 가이드에 따라 대규모 수치에는 **Manrope (Editorial)** 폰트를 적용하고, `font-extrabold` 스타일을 사용하여 시스템의 권위를 강조하십시오.

---

## 2. 실시간 동기화 상태 (Sync Status)

### 2.1 상태 배지 컬러링 (Semantic Colors)
- **현황**: `STATUS_CONFIG`의 성공(`success`), 실패(`failure`) 등의 상태 컬러가 Tailwind 기본 색상입니다.
- **개선**: 디자인 시스템 토큰으로 매핑하십시오.
  - 완료: `bg-ds-secondary-container` / `text-ds-on-secondary-container`
  - 진행중: `bg-ds-tertiary/10` / `text-ds-tertiary`
  - 오류: `bg-ds-error-container/20` / `text-ds-error`

### 2.2 벤더 배지 디자인
- **현황**: `VENDOR_BADGE`의 색상이 각기 달라 시각적 노이즈가 발생합니다.
- **개선**: 벤더명은 `ds-surface-container-high` 배경에 `ds-on-surface-variant` 텍스트로 통일하되, 벤더 로고(아이콘)를 작게 추가하여 구분하십시오.

---

## 3. 동기화 오류 배너 (Error Banner)

### 3.1 배너 디자인 고도화
- **현황**: 현재 기본 `bg-red-50`과 `border-red-200`을 사용하여 시스템 전체 톤과 맞지 않습니다.
- **개선**: 
  - 배경: `bg-ds-error-container` (불투명도 10-15%)
  - 테두리: `border-ds-error/20`
  - 텍스트: `text-ds-error`
- **추가 기능**: 오류가 발생한 구체적인 이유(Handshake failed 등)를 배너 내에 작은 텍스트로 노출하여 즉각적인 진단을 돕습니다.

---

## 4. 최근 활동 피드 (Activity Feed)

### 4.1 수직 인디케이터 (Vertical Indicators)
- **현황**: 카테고리별로 좌측에 2px의 수직 바가 있으나, 색상 대비가 낮습니다.
- **개선**: 수직 바의 너비를 3px로 늘리고, 디자인 시스템의 `primary`, `tertiary`, `error` 색상을 더 명확하게 적용하십시오.

### 4.2 인터랙션 및 링크
- **현황**: 개별 활동 로그 클릭 시의 피드백이 약합니다.
- **개선**: 마우스 오버 시 `bg-ds-surface-container-low` 배경색을 적용하고, 관련 장비나 분석 결과로 즉시 이동할 수 있는 툴팁 또는 링크를 강화하십시오.
