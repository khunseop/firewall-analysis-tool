/**
 * 하위 호환성을 위해 유지되는 함수.
 * domLayout: 'autoHeight' 사용으로 AG Grid가 높이를 자동 관리하므로 실제 동작 없음.
 */
export function adjustGridHeight(gridDiv, minHeight = 200) {
  // no-op: domLayout: 'autoHeight' handles height automatically
}

/**
 * 그리드 이벤트 핸들러 생성 (컬럼 자동 크기 조절)
 * @param {HTMLElement} gridDiv - 사용하지 않음 (하위 호환 유지)
 * @param {Object} _ignoredApi - 사용하지 않음 (params.api 사용으로 대체)
 * @param {number} delay - autoSizeAllColumns 지연 시간 (ms, 기본값: 200)
 */
export function createGridEventHandlers(gridDiv, _ignoredApi, delay = 200) {
  const autoSize = (api) => {
    if (api && typeof api.isDestroyed === 'function' && !api.isDestroyed() && api.getDisplayedRowCount() > 0) {
      try {
        api.autoSizeAllColumns({ skipHeader: false });
      } catch (e) {
        console.warn('autoSizeAllColumns 실패:', e);
      }
    }
  };

  return {
    onGridReady: (params) => {
      const api = params.api;
      if (api && typeof api.addEventListener === 'function') {
        api.addEventListener('filterChanged', () => {
          setTimeout(() => autoSize(api), delay);
        });
      }
    },
    onFirstDataRendered: (params) => {
      setTimeout(() => autoSize(params.api), delay);
    },
    onRowDataUpdated: (params) => {
      setTimeout(() => autoSize(params.api), delay);
    }
  };
}

/**
 * 공통 그리드 옵션 생성
 * @param {Object} options - 추가 옵션
 * @returns {Object} 그리드 옵션 객체
 */
export function createCommonGridOptions(options = {}) {
  return {
    defaultColDef: {
      resizable: true,
      sortable: false,
      filter: true,
      filterParams: {
        buttons: ['apply', 'reset'],
        debounceMs: 200
      }
    },
    enableCellTextSelection: true,
    getRowId: params => String(params.data.id),
    suppressHorizontalScroll: false,
    enableFilterHandlers: true,
    pagination: true,
    paginationPageSize: 50,
    paginationPageSizeSelector: [50, 100, 200],
    domLayout: 'autoHeight',
    ...options
  };
}

/**
 * 객체 이름을 링크로 렌더링하는 셀 렌더러
 * @param {Object} params - AG Grid 셀 파라미터
 * @param {Set} validObjectNames - 유효한 객체 이름 Set
 * @param {Function} onObjectClick - 객체 클릭 시 호출할 함수 (deviceId, objectName) => void
 * @returns {HTMLElement} 렌더링된 컨테이너 요소
 */
export function createObjectCellRenderer(validObjectNames, onObjectClick) {
  return function objectCellRenderer(params) {
    if (!params.value) return '';
    
    // analysis.js에서는 policy.device_id, policies.js에서는 device_id
    const deviceId = params.data.policy?.device_id || params.data.device_id;
    if (!deviceId) return params.value;
    
    const objectNames = params.value.split(',').map(s => s.trim()).filter(Boolean);

    const container = document.createElement('div');
    container.style.height = '100%';
    container.style.maxHeight = '150px';
    container.style.overflowY = 'auto';
    container.style.lineHeight = '1.5';

    objectNames.forEach(name => {
      const line = document.createElement('div');
      if (validObjectNames.has(name)) {
        const link = document.createElement('a');
        link.href = '#';
        link.textContent = name;
        link.style.cursor = 'pointer';
        link.onclick = async (e) => {
          e.preventDefault();
          if (onObjectClick) {
            await onObjectClick(deviceId, name);
          }
        };
        line.appendChild(link);
      } else {
        line.textContent = name;
      }
      container.appendChild(line);
    });

    return container;
  };
}

/**
 * 공통 그리드 이벤트 핸들러 생성 (필터 저장 포함)
 * @param {HTMLElement} gridDiv - 사용하지 않음 (하위 호환 유지)
 * @param {string} filterKey - 필터 저장 키
 * @param {Function} saveGridFilters - 필터 저장 함수
 * @param {number} delay - autoSizeAllColumns 지연 시간 (ms, 기본값: 200)
 * @returns {Object} 그리드 이벤트 핸들러 객체
 */
export function createGridEventHandlersWithFilter(gridDiv, filterKey, saveGridFilters, delay = 200) {
  const autoSize = (api) => {
    if (api && typeof api.isDestroyed === 'function' && !api.isDestroyed() && api.getDisplayedRowCount() > 0) {
      try {
        api.autoSizeAllColumns({ skipHeader: false });
      } catch (e) {
        console.warn('autoSizeAllColumns 실패:', e);
      }
    }
  };

  return {
    onGridReady: (params) => {
      const api = params.api;
      if (api && typeof api.addEventListener === 'function') {
        api.addEventListener('filterChanged', () => {
          const filterModel = api.getFilterModel();
          saveGridFilters(filterKey, filterModel);
          setTimeout(() => autoSize(api), delay);
        });
      }
    },
    onFirstDataRendered: (params) => {
      setTimeout(() => autoSize(params.api), delay);
    },
    onRowDataUpdated: (params) => {
      setTimeout(() => autoSize(params.api), delay);
    }
  };
}

