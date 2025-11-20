/**
 * 그리드 높이를 자동으로 조절하는 함수 (세로 스크롤 없이 모든 행 표시)
 * @param {HTMLElement} gridDiv - 그리드 컨테이너 요소
 * @param {number} minHeight - 최소 높이 (기본값: 200)
 */
export function adjustGridHeight(gridDiv, minHeight = 200) {
  if (!gridDiv) return;
  
  // 실제 렌더링된 요소들의 높이를 측정
  const headerElement = gridDiv.querySelector('.ag-header');
  const headerHeight = headerElement ? headerElement.offsetHeight : 0;
  
  const paginationElement = gridDiv.querySelector('.ag-paging-panel');
  const paginationHeight = paginationElement ? paginationElement.offsetHeight : 0;
  
  // 그리드 본문 영역의 실제 높이 측정
  const bodyViewport = gridDiv.querySelector('.ag-body-viewport');
  let bodyHeight = 0;
  
  if (bodyViewport) {
    // 필터가 열려있을 수 있으므로 잠시 스크롤을 허용하여 정확한 높이 측정
    const originalOverflow = bodyViewport.style.overflowY;
    bodyViewport.style.overflowY = 'auto';
    
    // 강제 리플로우
    void bodyViewport.offsetHeight;
    
    bodyHeight = bodyViewport.scrollHeight;
    
    // bodyViewport의 padding/margin도 고려
    const bodyViewportStyle = window.getComputedStyle(bodyViewport);
    const paddingTop = parseInt(bodyViewportStyle.paddingTop) || 0;
    const paddingBottom = parseInt(bodyViewportStyle.paddingBottom) || 0;
    bodyHeight += paddingTop + paddingBottom;
    
    // 원래 상태로 복원
    bodyViewport.style.overflowY = originalOverflow || 'hidden';
  } else {
    // fallback: 행 요소들의 높이 합계
    const rowElements = gridDiv.querySelectorAll('.ag-row:not(.ag-header-row)');
    rowElements.forEach(row => {
      bodyHeight += row.offsetHeight || 0;
    });
  }
  
  // ag-center-cols-container의 높이도 확인 (더 정확한 측정)
  const centerColsContainer = gridDiv.querySelector('.ag-center-cols-container');
  if (centerColsContainer) {
    const containerHeight = centerColsContainer.offsetHeight;
    if (containerHeight > bodyHeight) {
      bodyHeight = containerHeight;
    }
  }
  
  // 높이 계산: 헤더 + 본문 높이 + 페이지네이션
  const calculatedHeight = headerHeight + bodyHeight + paginationHeight;
  const finalHeight = Math.max(calculatedHeight, minHeight);
  
  gridDiv.style.height = `${finalHeight}px`;
  
  // 세로 스크롤 강제 제거
  if (bodyViewport) {
    bodyViewport.style.overflowY = 'hidden';
    bodyViewport.style.overflowX = 'auto';
  }
}

/**
 * 그리드 이벤트 핸들러 생성 (높이 조절 및 컬럼 자동 크기 조절)
 * @param {HTMLElement} gridDiv - 그리드 컨테이너 요소
 * @param {Object} gridApi - AG Grid API 객체
 * @param {number} delay - 지연 시간 (ms, 기본값: 200)
 */
export function createGridEventHandlers(gridDiv, gridApi, delay = 200) {
  let adjustTimeout = null;
  
  const adjust = (api = gridApi) => {
    // 이전 타이머 취소
    if (adjustTimeout) {
      clearTimeout(adjustTimeout);
    }
    
    adjustTimeout = setTimeout(() => {
      if (api && typeof api.isDestroyed === 'function' && !api.isDestroyed() && typeof api.autoSizeAllColumns === 'function') {
        try {
          api.autoSizeAllColumns({ skipHeader: false });
        } catch (e) {
          console.warn('Grid API 호출 실패:', e);
        }
      }
      adjustGridHeight(gridDiv);
      adjustTimeout = null;
    }, delay);
  };

  return {
    onGridReady: (params) => {
      const api = params.api || gridApi;
      // 필터 변경 이벤트 리스너 추가
      if (api && typeof api.addEventListener === 'function') {
        api.addEventListener('filterChanged', () => {
          adjust(api);
        });
        api.addEventListener('filterModified', () => {
          adjust(api);
        });
      }
      setTimeout(() => adjustGridHeight(gridDiv), delay);
    },
    onFirstDataRendered: (params) => {
      setTimeout(() => {
        if (params.api && typeof params.api.isDestroyed === 'function' && !params.api.isDestroyed()) {
          try {
            if (params.api.getDisplayedRowCount() > 0) {
              params.api.autoSizeAllColumns({ skipHeader: false });
            }
          } catch (e) {
            console.warn('Grid API 호출 실패:', e);
          }
        }
        adjustGridHeight(gridDiv);
      }, delay);
    },
    onModelUpdated: (params) => {
      const api = params.api || gridApi;
      if (api && typeof api.isDestroyed === 'function' && !api.isDestroyed() && api.getDisplayedRowCount() > 0) {
        adjust(api);
      } else {
        setTimeout(() => adjustGridHeight(gridDiv), delay);
      }
    },
    onPaginationChanged: () => {
      setTimeout(() => adjustGridHeight(gridDiv), delay);
    },
    onRowDataUpdated: () => {
      setTimeout(() => adjustGridHeight(gridDiv), delay);
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
    domLayout: 'normal', // autoHeight 대신 normal 사용하여 높이 조절 제어
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
 * @param {HTMLElement} gridDiv - 그리드 컨테이너 요소
 * @param {string} filterKey - 필터 저장 키
 * @param {Function} saveGridFilters - 필터 저장 함수
 * @param {number} delay - 지연 시간 (ms, 기본값: 200)
 * @returns {Object} 그리드 이벤트 핸들러 객체
 */
export function createGridEventHandlersWithFilter(gridDiv, filterKey, saveGridFilters, delay = 200) {
  let adjustTimeout = null;
  
  const adjust = (api) => {
    // 이전 타이머 취소
    if (adjustTimeout) {
      clearTimeout(adjustTimeout);
    }
    
    adjustTimeout = setTimeout(() => {
      if (api && typeof api.isDestroyed === 'function' && !api.isDestroyed() && typeof api.autoSizeAllColumns === 'function') {
        try {
          api.autoSizeAllColumns({ skipHeader: false });
        } catch (e) {
          console.warn('Grid API 호출 실패:', e);
        }
      }
      adjustGridHeight(gridDiv);
      adjustTimeout = null;
    }, delay);
  };

  return {
    onGridReady: (params) => {
      // 필터 변경 시 저장 및 높이 조절
      if (params.api && typeof params.api.addEventListener === 'function') {
        params.api.addEventListener('filterChanged', () => {
          const filterModel = params.api.getFilterModel();
          saveGridFilters(filterKey, filterModel);
          adjust(params.api);
        });
        params.api.addEventListener('filterModified', () => {
          adjust(params.api);
        });
      }
      setTimeout(() => adjustGridHeight(gridDiv), delay);
    },
    onFirstDataRendered: (params) => {
      setTimeout(() => {
        if (params.api && typeof params.api.isDestroyed === 'function' && !params.api.isDestroyed()) {
          try {
            if (params.api.getDisplayedRowCount() > 0) {
              params.api.autoSizeAllColumns({ skipHeader: false });
            }
            adjustGridHeight(gridDiv);
          } catch (e) {
            console.warn('Grid API 호출 실패:', e);
            adjustGridHeight(gridDiv);
          }
        } else {
          adjustGridHeight(gridDiv);
        }
      }, delay);
    },
    onModelUpdated: (params) => {
      if (params.api && typeof params.api.isDestroyed === 'function' && !params.api.isDestroyed()) {
        if (params.api.getDisplayedRowCount() > 0) {
          setTimeout(() => {
            try {
              params.api.autoSizeAllColumns({ skipHeader: false });
              adjustGridHeight(gridDiv);
            } catch (e) {
              console.warn('Grid API 호출 실패:', e);
              adjustGridHeight(gridDiv);
            }
          }, delay);
        } else {
          setTimeout(() => adjustGridHeight(gridDiv), delay);
        }
      } else {
        setTimeout(() => adjustGridHeight(gridDiv), delay);
      }
    },
    onPaginationChanged: () => {
      setTimeout(() => adjustGridHeight(gridDiv), delay);
    },
    onRowDataUpdated: () => {
      setTimeout(() => adjustGridHeight(gridDiv), delay);
    }
  };
}

