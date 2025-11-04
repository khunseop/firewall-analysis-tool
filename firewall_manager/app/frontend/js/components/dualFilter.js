export class DualFilter {
    init(params) {
        this.params = params;
        this.valueGetter = params.valueGetter;
        this.model = null; // applied model
        this.uiModel = null; // model from UI
        this.setupGui();
        this.setupEventListeners();
        // Required for 'apply' button to work
        this.params.onModelChange(this.model);
    }

    setupGui() {
        this.gui = document.createElement('div');
        this.gui.classList.add('ag-simple-filter-body-wrapper');
        this.gui.innerHTML = `
            <div class="ag-filter-body" style="padding: 4px;">
                <div class="ag-filter-header-container">
                    <select class="ag-filter-select" id="filter-type-select" style="margin-bottom: 8px; width: 100%;">
                        <option value="text">텍스트 필터 (클라이언트)</option>
                        <option value="values">값 검색 (서버)</option>
                    </select>
                </div>
                <div id="text-filter-ui">
                    <select class="ag-filter-select" id="text-filter-condition" style="margin-bottom: 8px; width: 100%;">
                        <option value="contains">Contains</option>
                        <option value="notContains">Does not contain</option>
                        <option value="equals">Equals</option>
                        <option value="notEqual">Not equal</option>
                        <option value="startsWith">Starts with</option>
                        <option value="endsWith">Ends with</option>
                        <option value="blank">Is blank</option>
                        <option value="notBlank">Is not blank</option>
                    </select>
                    <div class="ag-filter-input-wrapper">
                        <input class="ag-filter-field-input" type="text" id="text-filter-input">
                    </div>
                </div>
                <div id="values-filter-ui" style="display: none;">
                     <div class="ag-filter-input-wrapper">
                        <input class="ag-filter-field-input" type="text" id="values-filter-input" placeholder="쉼표(,)로 값 구분">
                    </div>
                </div>
            </div>`;

        this.eFilterTypeSelect = this.gui.querySelector('#filter-type-select');
        this.eTextFilterUi = this.gui.querySelector('#text-filter-ui');
        this.eValuesFilterUi = this.gui.querySelector('#values-filter-ui');
        this.eTextCondition = this.gui.querySelector('#text-filter-condition');
        this.eTextInput = this.gui.querySelector('#text-filter-input');
        this.eValuesInput = this.gui.querySelector('#values-filter-input');
    }

    setupEventListeners() {
        this.eFilterTypeSelect.addEventListener('change', () => this.onFilterTypeChanged());

        // Notify AG Grid when UI state changes, enabling the 'apply' button
        const onUiChanged = () => {
            this.uiModel = this.getModelFromUi();
            this.params.onStateChange();
        };
        this.eTextInput.addEventListener('input', onUiChanged);
        this.eValuesInput.addEventListener('input', onUiChanged);
        this.eTextCondition.addEventListener('change', onUiChanged);
        this.eFilterTypeSelect.addEventListener('change', onUiChanged);
    }

    onFilterTypeChanged() {
        const isText = this.eFilterTypeSelect.value === 'text';
        this.eTextFilterUi.style.display = isText ? 'block' : 'none';
        this.eValuesFilterUi.style.display = isText ? 'none' : 'block';

        const isBlank = this.eTextCondition.value === 'blank' || this.eTextCondition.value === 'notBlank';
        this.eTextInput.style.display = isBlank ? 'none' : 'block';
    }

    getGui() {
        return this.gui;
    }

    getModel() {
        return this.model;
    }

    // This is key for the 'apply' button
    getModelFromUi() {
        const filterType = this.eFilterTypeSelect.value;
        if (filterType === 'text') {
            const type = this.eTextCondition.value;
            const filter = this.eTextInput.value;
             if ((type === 'blank' || type === 'notBlank')) {
                return { filterType, type };
            }
            if (filter === '') return null;
            return { filterType, type, filter: filter.toLowerCase() };
        } else {
            const filter = this.eValuesInput.value;
            if (filter === '') return null;
            return { filterType: 'values', filter };
        }
    }

    setModel(model) {
        this.model = model;
        this.eFilterTypeSelect.value = model?.filterType || 'text';
        this.onFilterTypeChanged();

        if (model?.filterType === 'text') {
            this.eTextCondition.value = model.type || 'contains';
            this.eTextInput.value = model.filter || '';
        } else if (model?.filterType === 'values') {
            this.eValuesInput.value = model.filter || '';
        } else {
            // Reset to default
            this.eTextCondition.value = 'contains';
            this.eTextInput.value = '';
            this.eValuesInput.value = '';
        }
        this.uiModel = this.getModelFromUi(); // sync UI model
    }

    isFilterActive() {
        return this.model !== null && this.model !== undefined;
    }

    onAction(action) {
        if (action === 'apply') {
            this.model = this.getModelFromUi();

            // IMPORTANT: If 'values' search, call the server-side search callback
            if (this.model?.filterType === 'values' && this.params.applyValueSearch) {
                this.params.applyValueSearch();
            }

            this.params.onModelChange(this.model);

        } else if (action === 'reset') {
            this.setModel(null);
            if (this.params.applyValueSearch) {
                this.params.applyValueSearch();
            }
            this.params.onModelChange(this.model);
        }
    }

    // Client-side filtering logic for 'text' filter
    doesFilterPass(params) {
        if (!this.model || this.model.filterType !== 'text') {
            // For 'values' search, we assume it passes because it's server-side
            return true;
        }

        const value = this.valueGetter(params.node)?.toLowerCase() || '';
        const { type, filter } = this.model;

        switch (type) {
            case 'contains': return value.includes(filter);
            case 'notContains': return !value.includes(filter);
            case 'equals': return value === filter;
            case 'notEqual': return value !== filter;
            case 'startsWith': return value.startsWith(filter);
            case 'endsWith': return value.endsWith(filter);
            case 'blank': return value === '';
            case 'notBlank': return value !== '';
            default: return true;
        }
    }

    destroy() {
        this.gui.removeEventListener('change', this.onFilterTypeChanged);
        this.eTextInput.removeEventListener('input', this.params.onStateChange);
        this.eValuesInput.removeEventListener('input', this.params.onStateChange);
    }
}
