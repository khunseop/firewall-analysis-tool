// dualFilter.js

// AG Grid의 IFilterComp 인터페이스를 구현하는 커스텀 필터
export function createDualFilter(params) {
  return {
    init(params) {
      this.params = params;
      this.filterType = 'text'; // 'text' or 'values'
      this.appliedModel = null;

      this.gui = document.createElement('div');
      this.gui.innerHTML = `
        <div style="padding: 8px;">
          <div class="field">
            <div class="control">
              <div class="select is-fullwidth">
                <select id="filter-type-select">
                  <option value="text">텍스트 필터</option>
                  <option value="values">값으로 검색</option>
                </select>
              </div>
            </div>
          </div>
          <div id="text-filter-wrapper">
            <div class="field">
              <div class="control">
                <div class="select is-fullwidth">
                  <select id="text-filter-condition">
                    <option value="contains">Contains</option>
                    <option value="notContains">Does not contain</option>
                    <option value="equals">Equals</option>
                    <option value="notEqual">Not equal</option>
                    <option value="startsWith">Starts with</option>
                    <option value="endsWith">Ends with</option>
                  </select>
                </div>
              </div>
            </div>
            <div class="field">
              <div class="control">
                <input class="input" type="text" id="text-filter-input">
              </div>
            </div>
          </div>
          <div id="values-filter-wrapper" style="display: none;">
            <div class="field">
              <div class="control">
                <textarea class="textarea" id="values-filter-input" rows="4" placeholder="쉼표(,)로 구분된 값 입력..."></textarea>
              </div>
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

      this.typeSelect.addEventListener('change', () => {
        this.filterType = this.typeSelect.value;
        this.updateUiVisibility();
      });
    },

    getGui() {
      return this.gui;
    },

    isFilterActive() {
      return this.appliedModel != null;
    },

    doesFilterPass(params) {
      if (!this.appliedModel || this.appliedModel.filterType !== 'text') {
        return true;
      }

      const cellValue = this.params.valueGetter(params);
      if (cellValue == null) return false;

      const cellValueStr = String(cellValue).toLowerCase();
      const filterText = String(this.appliedModel.filter).toLowerCase();

      switch (this.appliedModel.type) {
        case 'contains': return cellValueStr.includes(filterText);
        case 'notContains': return !cellValueStr.includes(filterText);
        case 'equals': return cellValueStr === filterText;
        case 'notEqual': return cellValueStr !== filterText;
        case 'startsWith': return cellValueStr.startsWith(filterText);
        case 'endsWith': return cellValueStr.endsWith(filterText);
        default: return true;
      }
    },

    getModel() {
      return this.appliedModel;
    },

    setModel(model) {
      this.appliedModel = model;
      if (model && model.filterType === 'values') {
        this.filterType = 'values';
        this.valuesInput.value = model.values ? model.values.join(', ') : '';
      } else if (model) {
        this.filterType = 'text';
        this.textConditionSelect.value = model.type || 'contains';
        this.textInput.value = model.filter || '';
      } else {
        this.filterType = 'text';
        this.textConditionSelect.value = 'contains';
        this.textInput.value = '';
        this.valuesInput.value = '';
      }
      this.updateUiVisibility();
    },

    updateUiVisibility() {
      const isText = this.filterType === 'text';
      this.textFilterWrapper.style.display = isText ? '' : 'none';
      this.valuesFilterWrapper.style.display = isText ? 'none' : '';
    },

    handler(action) {
      if (action.type === 'apply') {
        if (this.filterType === 'text') {
          const filterText = this.textInput.value;
          if (filterText) {
            this.appliedModel = {
              filterType: 'text',
              type: this.textConditionSelect.value,
              filter: filterText,
            };
          } else {
            this.appliedModel = null;
          }
          this.params.onFilterChanged();
        } else { // values filter
          const values = (this.valuesInput.value || '').split(',').map(s => s.trim()).filter(Boolean);
          if (values.length > 0) {
            this.appliedModel = {
              filterType: 'values',
              values: values,
            };
          } else {
            this.appliedModel = null;
          }
          if (this.params.applyValueSearch) {
            this.params.applyValueSearch();
          }
        }
      } else if (action.type === 'reset') {
        this.setModel(null);
        if (this.filterType === 'values' && this.params.applyValueSearch) {
          this.params.applyValueSearch();
        } else {
          this.params.onFilterChanged();
        }
      }
      return true; // Close the filter popup
    },

    destroy() {}
  };
}
