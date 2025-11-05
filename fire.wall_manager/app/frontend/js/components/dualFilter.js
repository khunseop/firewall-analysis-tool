// dualFilter.js

// AG Grid의 IFilterComp 인터페이스를 구현하는 커텀 필터
export function createDualFilter(params) {
  return {
    // 필터의 DOM 요소를 초기화하고 반환
    init(params) {
      this.params = params;
      this.filterType = 'text'; // 'text' or 'values'
      this.appliedModel = null; // 실제로 적용된 모델
      this.debounceMs = 500;
      this.debounceTimeout = null;

      this.gui = document.createElement('div');
      this.gui.className = 'ag-simple-filter-body-wrapper';
      this.gui.innerHTML = `
        <div class="ag-filter-body">
          <select class="ag-filter-select" id="filter-type-select" style="margin-bottom: 8px;">
            <option value="text">텍스트 필터</option>
            <option value="values">값으로 검색</option>
          </select>
          <div id="text-filter-wrapper">
            <select class="ag-filter-select" id="text-filter-condition">
              <option value="contains">Contains</option>
              <option value="notContains">Does not contain</option>
              <option value="equals">Equals</option>
              <option value="notEqual">Not equal</option>
              <option value="startsWith">Starts with</option>
              <option value="endsWith">Ends with</option>
              <option value="blank">Blank</option>
              <option value="notBlank">Not blank</option>
            </select>
            <div class="ag-filter-field-input-wrapper">
              <input class="ag-filter-field-input" type="text" id="text-filter-input">
            </div>
          </div>
          <div id="values-filter-wrapper" style="display: none;">
            <div class="ag-filter-field-input-wrapper">
              <textarea class="ag-filter-field-input" id="values-filter-input" rows="3" placeholder="쉼표(,)로 구분된 값 입력..."></textarea>
            </div>
          </div>
        </div>
      `;

      this.typeSelect = this.gui.querySelector('#filter-type-select');
      this.textConditionSelect = this.gui.querySelector('#text-filter-condition');
      this.textInput = this.gui.querySelector('#text-filter-input');
      this.valuesInput = this.gui.querySelector('#values-filter-input');

      this.textFilterWrapper = this.gui.querySelector('#text-filter-wrapper');
      this.valuesFilterWrapper = this.gui.querySelector('#values-filter-wrapper');

      this.setupEventListeners();
    },

    // 필터의 GUI를 반환
    getGui() {
      return this.gui;
    },

    // 필터가 활성 상태인지 확인 (컬럼 헤더 아이콘 표시 여부 결정)
    isFilterActive() {
      if (!this.appliedModel) return false;
      if (this.appliedModel.filterType === 'text') {
        if (this.appliedModel.type === 'blank' || this.appliedModel.type === 'notBlank') {
          return true;
        }
        return this.appliedModel.filter != null && this.appliedModel.filter !== '';
      } else {
        return this.appliedModel.values != null && this.appliedModel.values.length > 0;
      }
    },

    // 클라이언트 사이드 필터링 로직 (텍스트 필터용)
    doesFilterPass(params) {
      if (this.filterType !== 'text' || !this.isFilterActive() || !this.appliedModel) {
        return true;
      }

      const { api, colDef, column, columnApi, context } = this.params;
      const { node } = params;
      const cellValue = this.params.valueGetter({ api, colDef, column, columnApi, context, data: node.data, getValue: (field) => node.data[field], node });

      if (cellValue == null) {
        return this.appliedModel.type === 'blank';
      }

      const cellValueStr = String(cellValue).toLowerCase();
      const filterText = String(this.appliedModel.filter).toLowerCase();

      switch (this.appliedModel.type) {
        case 'contains': return cellValueStr.includes(filterText);
        case 'notContains': return !cellValueStr.includes(filterText);
        case 'equals': return cellValueStr === filterText;
        case 'notEqual': return cellValueStr !== filterText;
        case 'startsWith': return cellValueStr.startsWith(filterText);
        case 'endsWith': return cellValueStr.endsWith(filterText);
        case 'blank': return cellValue == null || cellValue === '';
        case 'notBlank': return cellValue != null && cellValue !== '';
        default: return true;
      }
    },

    // 현재 적용된 필터 모델 반환
    getModel() {
      return this.appliedModel;
    },

    // UI에 표시된 (아직 적용되지 않은) 필터 모델 반환
    getModelFromUi() {
      if (this.filterType === 'text') {
        return {
          filterType: 'text',
          type: this.textConditionSelect.value,
          filter: this.textInput.value,
        };
      } else {
        const values = (this.valuesInput.value || '').split(',').map(s => s.trim()).filter(Boolean);
        return {
          filterType: 'values',
          values: values,
        };
      }
    },

    // 외부에서 필터 모델을 설정할 때 호출 (예: setFilterModel)
    setModel(model) {
      this.appliedModel = model;
      if (model && model.filterType === 'values') {
        this.filterType = 'values';
        this.typeSelect.value = 'values';
        this.valuesInput.value = model.values ? model.values.join(', ') : '';
      } else if (model) {
        this.filterType = 'text';
        this.typeSelect.value = 'text';
        this.textConditionSelect.value = model.type || 'contains';
        this.textInput.value = model.filter || '';
      } else {
        // Reset to default UI state
        this.filterType = 'text';
        this.typeSelect.value = 'text';
        this.textConditionSelect.value = 'contains';
        this.textInput.value = '';
        this.valuesInput.value = '';
      }
      this.updateUiVisibility();
    },

    // 필터 UI 이벤트 리스너 설정
    setupEventListeners() {
      this.typeSelect.addEventListener('change', () => {
        this.filterType = this.typeSelect.value;
        this.updateUiVisibility();
        this.params.onModelChange(this.getModelFromUi());
      });

      const onInput = () => {
        clearTimeout(this.debounceTimeout);
        this.debounceTimeout = setTimeout(() => {
          this.params.onModelChange(this.getModelFromUi());
        }, this.debounceMs);
      };

      this.textInput.addEventListener('input', onInput);
      this.textConditionSelect.addEventListener('change', onInput);
      this.valuesInput.addEventListener('input', onInput);
    },

    // 필터 타입에 따라 UI 요소 보이기/숨기기
    updateUiVisibility() {
      const isText = this.filterType === 'text';
      this.textFilterWrapper.style.display = isText ? '' : 'none';
      this.valuesFilterWrapper.style.display = isText ? 'none' : '';
      this.params.onStateChange();
    },

    // AG Grid의 버튼 액션 처리
    onAction(action) {
      if (action === 'apply') {
        this.appliedModel = this.getModelFromUi();
        if (this.filterType === 'values') {
          if (this.params.applyValueSearch) {
            this.params.applyValueSearch();
          }
        } else {
          this.params.onFilterChanged();
        }
      } else if (action === 'reset') {
        this.setModel(null);
        this.params.onModelChange(null); // Notify grid of model change
        if (this.filterType === 'values' && this.params.applyValueSearch) {
           this.params.applyValueSearch(); // 서버 필터 초기화
        } else {
           this.params.onFilterChanged(); // 클라이언트 필터 초기화
        }
      }
    },

    // 컴포넌트 파괴 시 정리 작업
    destroy() {
      clearTimeout(this.debounceTimeout);
      this.gui = null;
    }
  };
}
