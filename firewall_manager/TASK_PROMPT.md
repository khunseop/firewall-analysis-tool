# 정책조회 페이지 필터 개선 작업 프롬프트

## 프로젝트 개요
- **프로젝트**: Firewall Analysis Tool (FAT) - 정책조회 페이지
- **기술 스택**: FastAPI (백엔드), AG Grid (프론트엔드 그리드), Bulma CSS
- **파일 위치**: 
  - HTML: `firewall_manager/app/frontend/templates/policies.html`
  - JavaScript: `firewall_manager/app/frontend/js/pages/policies.js`
  - 커스텀 필터: `firewall_manager/app/frontend/js/components/dualFilter.js`

## 요구사항

### 1. UI 레이아웃 개선
- 검색 필터 박스를 최소화하여 **장비 선택만** 남김
- "초기화" 및 "엑셀 내보내기" 버튼을 그리드 우상단에 배치 (Bulma `level` 클래스 사용)

### 2. 필터 기능 개선
- **정책명, 출발지, 목적지, 서비스** 컬럼에 커스텀 필터 적용
- 커스텀 필터는 **두 가지 검색 방식**을 모두 지원해야 함:
  1. **텍스트 기반 필터** (클라이언트 사이드): AG Grid 기본 텍스트 필터와 동일
     - Contains, Does not contain, Equals, Not equal, Starts with, Ends with, Blank, Not blank
     - 입력 시 즉시 적용 (또는 Apply 버튼으로)
  2. **값 검색 필터** (서버 사이드): 쉼표로 구분된 값들로 검색
     - 예: "192.168.1.1, 10.0.0.1" 입력 시 서버에서 해당 값들을 포함하는 정책 검색
     - Apply 버튼 클릭 시 `searchAndLoadPolicies()` 함수 호출

### 3. AG Grid 기본 필터 버튼 추가
- **기본 필터들** (device_name, vsys 등)에도 **Apply/Reset 버튼** 추가
- AG Grid 문서 참조: https://www.ag-grid.com/javascript-data-grid/filter-applying/
- `enableFilterHandlers: true` 설정 필요
- `filterParams: { buttons: ['apply', 'reset'] }` 추가

### 4. 커스텀 필터 요구사항
- AG Grid의 **IFilterComp 인터페이스**를 정확히 구현해야 함
- AG Grid 문서 참조: https://www.ag-grid.com/javascript-data-grid/component-filter/
- **AG Grid 기본 UI 스타일** 사용 (기본 필터와 동일한 외관)
- AG Grid 기본 CSS 클래스 사용:
  - `ag-simple-filter-body-wrapper`
  - `ag-filter-select`
  - `ag-filter-field-input`
  - `ag-standard-button ag-button-secondary`
- `onStateChange`, `onModelChange`, `onAction` 콜백 정확히 구현
- 필터 타입 선택 시 "Values" 옵션을 선택하면 값 검색 모드로 전환
- Values 모드에서는 Apply 버튼이 표시되어야 함

## 현재 상태

### 완료된 작업
1. ✅ HTML 레이아웃 개선 (장비 선택만 남김, 버튼 우상단 배치)
2. ✅ `enableFilterHandlers: true` 설정
3. ✅ 기본 필터에 `buttons: ['apply', 'reset']` 추가
4. ✅ 커스텀 필터 구조 작성 (dualFilter.js)

### 문제점
- **커스텀 필터의 Apply 버튼이 동작하지 않음**
- 기본 필터의 버튼도 제대로 동작하지 않는 것으로 보임
- AG Grid의 필터 버튼 시스템이 제대로 통합되지 않음

## 해결해야 할 사항

### 1. AG Grid 필터 버튼 시스템 통합
- AG Grid의 `enableFilterHandlers: true`가 활성화되면, 필터 컴포넌트가 자동으로 버튼을 추가함
- 커스텀 필터에서 버튼을 직접 만들지 말고, AG Grid가 제공하는 버튼 시스템을 사용해야 함
- `onStateChange`, `onModelChange`, `onAction` 콜백을 올바르게 구현하여 AG Grid가 버튼을 제어하도록 해야 함

### 2. 필터 모델 구조
- AG Grid의 필터 모델 구조를 정확히 따라야 함
- `getModel()`: 적용된 필터 모델 반환
- `getModelFromUi()`: UI에 표시된 (아직 적용되지 않은) 필터 모델 반환
- `setModel(model)`: 필터 모델 설정

### 3. 상태 관리
- 텍스트 필터: 입력 시 즉시 적용 또는 Apply 버튼 대기
- Values 필터: Apply 버튼 클릭 시에만 서버 검색 실행
- 필터 타입 변경 시 적절한 상태 초기화

## 참고 자료

### AG Grid 공식 문서
1. **필터 버튼**: https://www.ag-grid.com/javascript-data-grid/filter-applying/
   - `enableFilterHandlers: true` 설정
   - `filterParams: { buttons: ['apply', 'reset', 'clear', 'cancel'] }`
   - `onStateChange`, `onModelChange`, `onAction` 콜백

2. **커스텀 필터**: https://www.ag-grid.com/javascript-data-grid/component-filter/
   - `IFilterComp` 인터페이스 구현
   - `getGui()`, `isFilterActive()`, `doesFilterPass()`, `getModel()`, `setModel()`
   - `getModelFromUi()` (버튼이 있을 때 필요)

### 현재 코드 구조
```javascript
// policies.js
const options = {
  enableFilterHandlers: true, // ✅ 설정됨
  columnDefs: [
    {
      field: 'rule_name',
      filter: createDualFilter,
      filterParams: {
        buttons: ['apply', 'reset'], // ✅ 설정됨
        applyValueSearch: () => searchAndLoadPolicies()
      }
    }
  ]
};

// dualFilter.js
export function createDualFilter(params) {
  // 현재 구현이 있지만 버튼이 동작하지 않음
  // AG Grid의 버튼 시스템과 통합 필요
}
```

## 작업 목표

1. **기본 필터 버튼 동작 확인 및 수정**
   - `device_name`, `vsys` 등 기본 필터의 Apply/Reset 버튼이 정상 동작하도록

2. **커스텀 필터 버튼 시스템 통합**
   - AG Grid가 제공하는 버튼 시스템 사용
   - `onAction` 콜백에서 'apply', 'reset' 액션 처리
   - Values 모드에서 Apply 버튼 클릭 시 서버 검색 실행

3. **필터 모델 관리**
   - `getModel()`: 적용된 모델 반환
   - `getModelFromUi()`: UI 상태 반환 (버튼이 있을 때)
   - `setModel()`: 모델 설정 및 UI 업데이트

4. **테스트**
   - 텍스트 필터 즉시 적용 또는 Apply 버튼 동작 확인
   - Values 필터 Apply 버튼 클릭 시 서버 검색 실행 확인
   - Reset 버튼으로 필터 초기화 확인

## 주의사항

- AG Grid의 기본 UI 스타일을 유지해야 함 (커스텀 스타일 최소화)
- 서버 검색은 `searchAndLoadPolicies()` 함수를 통해 실행
- 필터 상태와 UI 상태를 분리하여 관리 (버튼이 있을 때)
- Values 필터는 서버 사이드이므로 `doesFilterPass()`에서 항상 `true` 반환

