# UI/UX 개선 보고서: 장비 관리 (Firewall Devices)

장비 관리 페이지는 인프라의 기초가 되는 장비들을 등록하고 상태를 감시하는 곳입니다. 데이터 입력의 정확성과 상태 확인의 직관성을 높이기 위한 개선 사항을 제안합니다.

---

## 1. 장비 요약 정보 (Summary Grid)

### 1.1 시각적 일관성 확보
- **현황**: 대시보드의 통계 카드와 유사한 형태이나, `ghost-border`와 아이콘 배경색이 혼재되어 있습니다.
- **개선**: 대시보드와 동일하게 `ghost-border`를 제거하고 **Tonal Layering**을 적용하십시오.
- **상태별 아이콘 컬러 매핑**:
  - Synced: `bg-ds-secondary-container` / `text-ds-on-secondary-container`
  - Syncing: `bg-ds-tertiary-container/30` / `text-ds-tertiary`
  - Error: `bg-ds-error-container/20` / `text-ds-error`

---

## 2. 장비 목록 테이블 (Managed Infrastructure)

### 2.1 상태 배지(Sync Status) 고도화
- **현황**: `SYNC_STATUS_CONFIG`가 `bg-green-100` 등 기본 Tailwind 색상을 사용 중입니다.
- **개선**: 디자인 시스템의 시맨틱 토큰으로 교체하고, "진행중(Syncing)" 상태에는 **`animate-spin`** 아이콘을 더 미세하고 세련되게 조정하십시오.
- **데이터 밀도**: IP 주소와 모델명 등은 `font-mono`와 `text-xs`를 사용하여 엔지니어링 도구로서의 정밀함을 강조하십시오.

### 2.2 액션 버튼 그룹
- **현황**: "동기화", "수정", "삭제" 버튼들이 단순 아이콘으로 나열되어 있어 오클릭의 위험이 있습니다.
- **개선**: 
  - 가장 빈번한 "동기화(Sync)" 버튼은 `ds-tertiary` 색상으로 강조하십시오.
  - "삭제" 버튼은 평소에는 `ds-on-surface-variant` 색상을 유지하다가 호버 시에만 `ds-error`로 변하게 하여 시각적 피로도를 줄이십시오.

---

## 3. 장비 등록/수정 모달 (Device Dialog)

### 3.1 레이아웃 및 입력 필드
- **현황**: 현재 2열 그리드로 빽빽하게 배치되어 있어 입력 시 피로도가 높습니다.
- **개선**: 
  - 논리적인 그룹(기본 정보, 접속 정보, 수집 설정)으로 섹션을 나누고 미세한 간격을 추가하십시오.
  - `Label` 텍스트를 `text-[10px] font-bold uppercase tracking-widest`로 유지하여 "Precision Sentinel"의 스타일을 고수하십시오.

### 3.2 Glassmorphism 및 깊이
- **현황**: 일반적인 흰색 배경의 다이얼로그입니다.
- **개선**: 다이얼로그 배경에 `glass-panel` 효과를 적용하고, 하단 푸터(`DialogFooter`) 영역에 미세한 배경색 차이(`bg-ds-surface-container-low`)를 주어 액션 영역을 분리하십시오.

---

## 4. 대량 등록 (Bulk Import)

### 4.1 피드백 루프 개선
- **현황**: 엑셀 업로드 후 성공/실패 결과가 토스트 메시지로만 간단히 표시됩니다.
- **개선**: 업로드 결과를 별도의 결과 요약 모달(성공 개수, 실패 리스트 및 사유)로 상세히 보여주어 사용자가 즉각적으로 데이터를 수정할 수 있게 돕습니다.
