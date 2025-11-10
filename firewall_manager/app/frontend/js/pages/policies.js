import { api } from "../api.js";
import { showObjectDetailModal } from '../components/objectDetailModal.js';
import { adjustGridHeight, createGridEventHandlers, createCommonGridOptions } from '../utils/grid.js';
import { exportGridToExcelClient } from '../utils/excel.js';
import { showEmptyMessage, hideEmptyMessage } from '../utils/message.js';
import { formatDateTime, formatNumber } from '../utils/date.js';
import { saveSearchParams, loadSearchParams, saveGridFilters, loadGridFilters, savePageState, loadPageState } from '../utils/storage.js';

// ==================== 전역 변수 ====================

let policyGridApi;
let allDevices = []; // 장비 목록 저장
let validObjectNames = new Set(); // 유효한 객체 이름 저장

// 컬럼 정의 함수 (전역으로 이동)
const getCols = () => ([
  { 
    field:'device_name', 
    headerName:'장비', 
    filter:'agTextColumnFilter', 
    pinned:'left',
    sortable: false,
    minWidth: 120,
    filterParams: {
      buttons: ['apply', 'reset'],
      debounceMs: 200
    }
  },
  { 
    field:'seq', 
    headerName:'순서', 
    filter: false,
    sortable: false,
    minWidth: 80,
    valueFormatter: (params) => formatNumber(params.value)
  },
  { 
    field:'vsys', 
    headerName:'가상시스템', 
    filter:'agTextColumnFilter',
    sortable: false,
    minWidth: 120,
    filterParams: {
      buttons: ['apply', 'reset'],
      debounceMs: 200
    }
  },
  { 
    field:'rule_name', 
    headerName:'정책명', 
    filter:'agTextColumnFilter',
    sortable: false,
    minWidth: 150,
    filterParams: {
      buttons: ['apply', 'reset'],
      debounceMs: 200
    }
  },
  { 
    field:'enable', 
    headerName:'활성화', 
    valueFormatter:p=>p.value===true?'활성':p.value===false?'비활성':'',
    filter:'agTextColumnFilter',
    sortable: false,
    minWidth: 100,
    filterParams: {
      buttons: ['apply', 'reset'],
      debounceMs: 200
    }
  },
  { 
    field:'action', 
    headerName:'액션', 
    filter:'agTextColumnFilter',
    sortable: false,
    minWidth: 100,
    filterParams: {
      buttons: ['apply', 'reset'],
      debounceMs: 200
    }
  },
  {
    field:'source', 
    headerName:'출발지', 
    wrapText:true, 
    autoHeight:true,
    cellRenderer: objectCellRenderer,
    filter:'agTextColumnFilter',
    sortable: false,
    minWidth: 150,
    filterParams: {
      buttons: ['apply', 'reset'],
      debounceMs: 200
    }
  },
  {
    field:'user', 
    headerName:'사용자', 
    wrapText:true, 
    autoHeight:true,
    cellRenderer: objectCellRenderer,
    filter:'agTextColumnFilter',
    sortable: false,
    minWidth: 150,
    filterParams: {
      buttons: ['apply', 'reset'],
      debounceMs: 200
    }
  },
  {
    field:'destination', 
    headerName:'목적지', 
    wrapText:true, 
    autoHeight:true,
    cellRenderer: objectCellRenderer,
    filter:'agTextColumnFilter',
    sortable: false,
    minWidth: 150,
    filterParams: {
      buttons: ['apply', 'reset'],
      debounceMs: 200
    }
  },
  {
    field:'service', 
    headerName:'서비스', 
    wrapText:true, 
    autoHeight:true,
    cellRenderer: objectCellRenderer,
    filter:'agTextColumnFilter',
    sortable: false,
    minWidth: 150,
    filterParams: {
      buttons: ['apply', 'reset'],
      debounceMs: 200
    }
  },
  {
    field:'application', 
    headerName:'애플리케이션', 
    wrapText:true, 
    autoHeight:true,
    cellRenderer: objectCellRenderer,
    filter:'agTextColumnFilter',
    sortable: false,
    minWidth: 150,
    filterParams: {
      buttons: ['apply', 'reset'],
      debounceMs: 200
    }
  },
  { 
    field:'security_profile', 
    headerName:'보안프로파일', 
    filter:'agTextColumnFilter',
    sortable: false,
    minWidth: 150,
    filterParams: {
      buttons: ['apply', 'reset'],
      debounceMs: 200
    }
  },
  { 
    field:'category', 
    headerName:'카테고리', 
    filter:'agTextColumnFilter',
    sortable: false,
    minWidth: 120,
    filterParams: {
      buttons: ['apply', 'reset'],
      debounceMs: 200
    }
  },
  { 
    field:'description', 
    headerName:'설명', 
    filter:'agTextColumnFilter',
    sortable: false,
    minWidth: 200,
    filterParams: {
      buttons: ['apply', 'reset'],
      debounceMs: 200
    }
  },
  { 
    field:'last_hit_date', 
    headerName:'마지막매칭일시', 
    filter:'agDateColumnFilter',
    sortable: false,
    minWidth: 180,
    valueFormatter: (params) => formatDateTime(params.value),
    filterParams: {
      buttons: ['apply', 'reset'],
      comparator: (filterLocalDateAtMidnight, cellValue) => {
        if (!cellValue) return -1;
        const cellDate = new Date(cellValue);
        if (cellDate < filterLocalDateAtMidnight) {
          return -1;
        } else if (cellDate > filterLocalDateAtMidnight) {
          return 1;
        } else {
          return 0;
        }
      }
    }
  },
]);

// Function to render object links in a cell
function objectCellRenderer(params) {
    if (!params.value) return '';
    const deviceId = params.data.device_id;
    const objectNames = params.value.split(',').map(s => s.trim()).filter(Boolean);

    const container = document.createElement('div');
    container.style.height = '100%';
    container.style.maxHeight = '150px'
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
                try {
                    const objectDetails = await api.getObjectDetails(deviceId, name);
                    showObjectDetailModal(objectDetails);
                } catch (error) {
                    alert(`객체 '${name}'의 상세 정보를 가져오는 데 실패했습니다: ${error.message}`);
                }
            };
            line.appendChild(link);
        } else {
            line.textContent = name;
        }
        container.appendChild(line);
    });

    return container;
}


async function initGrid() {
  const gridDiv = document.getElementById('policies-grid');
  if (!gridDiv) return;
  const options = {
    columnDefs: getCols(),
    rowData: [],
    defaultColDef:{ 
      resizable: true, 
      sortable: false, 
      filter: true 
    },
    enableCellTextSelection: true,
    getRowId: params => String(params.data.id),
    enableFilterHandlers: true,
    suppressHorizontalScroll: false, // 가로 스크롤 허용
      onGridReady: params => {
      policyGridApi = params.api;
      const gridDiv = document.getElementById('policies-grid');
      if (gridDiv) {
        const handlers = createGridEventHandlers(gridDiv, params.api);
        Object.assign(options, handlers);
      }
      
      // 필터 변경 시 저장
      if (params.api && typeof params.api.addEventListener === 'function') {
        params.api.addEventListener('filterChanged', () => {
          const filterModel = params.api.getFilterModel();
          saveGridFilters('policies', filterModel);
        });
        
        // 정렬 변경 시 저장
        params.api.addEventListener('sortChanged', () => {
          const sortModel = params.api.getSortModel();
          if (sortModel && sortModel.length > 0) {
            savePageState('policies_sort', { sortModel });
          }
        });
      }
    },
  };
  options.pagination = true;
  options.paginationPageSize = 50;
  options.paginationPageSizeSelector = [50, 100, 200];

  if (typeof agGrid !== 'undefined') {
      if (agGrid.createGrid) {
          policyGridApi = agGrid.createGrid(gridDiv, options);
      } else {
          new agGrid.Grid(gridDiv, options);
          policyGridApi = options.api;
      }
  }
}

async function loadDevicesIntoSelect() {
  const sel = document.getElementById('policy-device-select');
  if (!sel) return;
  try {
    allDevices = await api.listDevices(); // 전역 변수에 저장
    if (!allDevices || allDevices.length === 0) {
      sel.innerHTML = `<option value="">등록된 장비 없음</option>`;
      return;
    }
    sel.innerHTML = allDevices.map(d=>`<option value="${d.id}">${d.name} (${d.vendor})</option>`).join('');
  } catch {
    sel.innerHTML = `<option value="">장비 불러오기 실패</option>`;
  }
}

async function searchAndLoadPolicies() {
  const sel = document.getElementById('policy-device-select');
  const deviceIds = Array.from(sel?.selectedOptions || []).map(o=>parseInt(o.value,10)).filter(Boolean);
  const gridDiv = document.getElementById('policies-grid');
  const messageContainer = document.getElementById('policies-message-container');
  
  // 검색 조건 저장
  const searchPayload = buildSearchPayload(deviceIds);
  saveSearchParams('policies', {
    deviceIds,
    searchPayload
  });
  
  if (!deviceIds.length) {
    // 선택된 장비가 없으면 그리드를 숨기고 메시지 표시
    if (gridDiv) gridDiv.style.display = 'none';
    showEmptyMessage(messageContainer, '장비를 선택하세요', 'fa-mouse-pointer');
    if (policyGridApi) {
      if (typeof policyGridApi.setGridOption === 'function') {
        policyGridApi.setGridOption('rowData', []);
      } else if (typeof policyGridApi.setRowData === 'function') {
        policyGridApi.setRowData([]);
      }
    }
    return;
  }
  
  // 장비가 선택되면 메시지 숨기고 그리드 표시
  hideEmptyMessage(messageContainer);
  if (gridDiv) gridDiv.style.display = 'block';

  try {
    const payload = buildSearchPayload(deviceIds);
    const response = await api.searchPolicies(payload);

    if (response && Array.isArray(response.policies)) {
      // Update the set of valid object names
      validObjectNames = new Set(response.valid_object_names || []);

      // Inject seq-based row ID and device_name
      const rows = response.policies.map((r, idx) => {
        const device = allDevices.find(d => d.id === r.device_id);
        const deviceName = device ? device.name : `장비 ${r.device_id}`;
        return { ...r, _seq_row: idx + 1, device_name: deviceName };
      });

      if (policyGridApi) {
        if (typeof policyGridApi.setGridOption === 'function') {
          policyGridApi.setGridOption('rowData', rows);
        } else if (typeof policyGridApi.setRowData === 'function') {
          policyGridApi.setRowData(rows);
        }
        
        // 저장된 필터 복원
        const savedFilters = loadGridFilters('policies');
        if (savedFilters && typeof policyGridApi.setFilterModel === 'function') {
          policyGridApi.setFilterModel(savedFilters);
        }
        
        // 저장된 정렬 복원
        const savedSort = loadPageState('policies_sort');
        if (savedSort && savedSort.sortModel && typeof policyGridApi.setSortModel === 'function') {
          policyGridApi.setSortModel(savedSort.sortModel);
        }
        
        // Refresh cells to apply the new link logic
        policyGridApi.refreshCells({ force: true });
        // 컬럼 크기를 내용에 맞춰 자동 조절
        setTimeout(() => {
          if (typeof policyGridApi.autoSizeAllColumns === 'function') {
            policyGridApi.autoSizeAllColumns({ skipHeader: false });
          }
          const gridDiv = document.getElementById('policies-grid');
          if (gridDiv) {
            adjustGridHeight(gridDiv);
          }
        }, 600);
      }
      
      // 데이터가 없으면 메시지 표시
      if (rows.length === 0) {
        showEmptyMessage(messageContainer, '장비를 선택하세요', 'fa-mouse-pointer');
        if (gridDiv) gridDiv.style.display = 'none';
      } else {
        hideEmptyMessage(messageContainer);
        if (gridDiv) gridDiv.style.display = 'block';
      }
    } else {
      // 응답이 없거나 형식이 잘못된 경우
      showEmptyMessage(messageContainer, '장비를 선택하세요', 'fa-mouse-pointer');
      if (gridDiv) gridDiv.style.display = 'none';
      if (policyGridApi) {
        if (typeof policyGridApi.setGridOption === 'function') {
          policyGridApi.setGridOption('rowData', []);
        } else if (typeof policyGridApi.setRowData === 'function') {
          policyGridApi.setRowData([]);
        }
      }
    }
  } catch (error) {
    console.error('Failed to load policies:', error);
    showEmptyMessage(messageContainer, '장비를 선택하세요', 'fa-mouse-pointer');
    if (gridDiv) gridDiv.style.display = 'none';
    if (policyGridApi) {
      if (typeof policyGridApi.setGridOption === 'function') {
        policyGridApi.setGridOption('rowData', []);
      } else if (typeof policyGridApi.setRowData === 'function') {
        policyGridApi.setRowData([]);
      }
    }
  }
}

function buildSearchPayload(deviceIds){
  const g = (id) => document.getElementById(id);
  const v = (id) => g(id)?.value?.trim() || null; // 값이 없으면 null 반환
  const splitCsv = (val) => (val || '').split(',').map(s => s.trim()).filter(Boolean);

  const payload = {
    device_ids: deviceIds,
    rule_name: v('f-rule-name'),
    vsys: v('f-vsys'),
    // `source`, `destination`, `service`는 더 이상 Pydantic 모델에 없는 일반 텍스트 필드입니다.
    // 대신 `src_ips`, `dst_ips`, `services`를 사용합니다.
    user: v('f-user'),
    application: v('f-app'),
    description: v('f-desc'),
    action: v('f-action'),
    last_hit_date_from: v('f-hit-from'),
    last_hit_date_to: v('f-hit-to'),
    enable: g('f-enable')?.value === 'true' ? true : g('f-enable')?.value === 'false' ? false : null,

    // Corrected fields for indexed search
    src_ips: splitCsv(v('f-src')),
    dst_ips: splitCsv(v('f-dst')),
    services: splitCsv(v('f-svc')),
  };

  const isAllFiltersEmpty = Object.keys(payload).every(key => {
    if (key === 'device_ids') return !payload[key] || payload[key].length === 0;
    const value = payload[key];
    if (Array.isArray(value)) return value.length === 0;
    return value === null || value === '';
  });

  if (isAllFiltersEmpty && deviceIds.length > 0) {
    payload.limit = 500;
  }

  return payload;
}

export async function initPolicies(){
  await initGrid();
  await loadDevicesIntoSelect();
  const sel = document.getElementById('policy-device-select');
  if (!sel) return;
  
  // 저장된 검색 조건 복원
  const savedState = loadSearchParams('policies');
  
  // Initialize Tom Select for device selector only
  try {
    if (window.TomSelect && sel) {
      if (sel.tomselect) { try { sel.tomselect.destroy(); } catch {} }
      sel.tomselect = new window.TomSelect(sel, { 
        placeholder: '장비 선택',
        plugins: ['remove_button'],
        maxOptions: null,
      });
      
      // 저장된 장비 선택 복원
      if (savedState && savedState.deviceIds && savedState.deviceIds.length > 0) {
        sel.tomselect.setValue(savedState.deviceIds);
      }
      
      // 저장된 상세 검색 필터 복원
      if (savedState && savedState.searchPayload) {
        const payload = savedState.searchPayload;
        const g = (id) => document.getElementById(id);
        const setValue = (id, value) => {
          const el = g(id);
          if (el && value !== null && value !== '') {
            el.value = value;
          }
        };
        
        setValue('f-rule-name', payload.rule_name);
        setValue('f-vsys', payload.vsys);
        setValue('f-user', payload.user);
        setValue('f-app', payload.application);
        setValue('f-desc', payload.description);
        setValue('f-action', payload.action);
        setValue('f-hit-from', payload.last_hit_date_from);
        setValue('f-hit-to', payload.last_hit_date_to);
        setValue('f-src', payload.src_ips ? payload.src_ips.join(', ') : '');
        setValue('f-dst', payload.dst_ips ? payload.dst_ips.join(', ') : '');
        setValue('f-svc', payload.services ? payload.services.join(', ') : '');
        
        if (payload.enable !== null && payload.enable !== undefined) {
          const enableSelect = g('f-enable');
          if (enableSelect) {
            enableSelect.value = payload.enable ? 'true' : 'false';
          }
        }
      }
    }
  } catch {}
  
  // 초기 상태: 메시지 표시
  const messageContainer = document.getElementById('policies-message-container');
  const gridDiv = document.getElementById('policies-grid');
  
  // 저장된 장비가 있으면 자동 검색
  if (savedState && savedState.deviceIds && savedState.deviceIds.length > 0) {
    // 장비가 선택되면 메시지 숨기고 그리드 표시 준비
    hideEmptyMessage(messageContainer);
    if (gridDiv) gridDiv.style.display = 'block';
    // 저장된 상태로 자동 검색 실행
    setTimeout(() => {
      searchAndLoadPolicies();
    }, 100);
  } else {
    showEmptyMessage(messageContainer, '장비를 선택하세요', 'fa-mouse-pointer');
    if (gridDiv) gridDiv.style.display = 'none';
  }

  const bind = () => {
    // 장비 선택 변경 시 자동 검색
    sel.onchange = () => searchAndLoadPolicies();
    
    // 상세 검색 모달
    const modal = document.getElementById('modal-advanced-search');
    const btnAdvancedSearch = document.getElementById('btn-advanced-search');
    const btnCloseModal = document.getElementById('close-advanced-search');
    const btnCancelModal = document.getElementById('cancel-advanced-search');
    const btnApplySearch = document.getElementById('btn-apply-search');
    const btnClearSearch = document.getElementById('btn-clear-search');
    
    const openModal = () => {
      if (modal) modal.classList.add('is-active');
    };
    
    const closeModal = () => {
      if (modal) modal.classList.remove('is-active');
    };
    
    if (btnAdvancedSearch) btnAdvancedSearch.onclick = openModal;
    if (btnCloseModal) btnCloseModal.onclick = closeModal;
    if (btnCancelModal) btnCancelModal.onclick = closeModal;
    
    // 모달 배경 클릭으로 닫기
    if (modal) {
      const background = modal.querySelector('.modal-background');
      if (background) background.onclick = closeModal;
    }
    
    // ESC 키로 모달 닫기
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal && modal.classList.contains('is-active')) {
        closeModal();
      }
    });
    
    // 상세 검색 적용
    if (btnApplySearch) {
      btnApplySearch.onclick = () => {
        searchAndLoadPolicies();
        closeModal();
      };
    }
    
    // 상세 검색 초기화
    if (btnClearSearch) {
      btnClearSearch.onclick = () => {
        document.querySelectorAll('#modal-advanced-search input[id^="f-"]').forEach(el => {
          el.value = '';
        });
        const selectEnable = document.getElementById('f-enable');
        if (selectEnable) selectEnable.value = '';
      };
    }
    
    // 필터 초기화 버튼
    const btnResetFilters = document.getElementById('btn-reset-filters');
    if (btnResetFilters) {
      btnResetFilters.onclick = () => {
        // ag-grid 필터 초기화
        if (policyGridApi) {
          if (typeof policyGridApi.setFilterModel === 'function') {
            policyGridApi.setFilterModel(null);
          }
        }
        // 상세 검색 필터 초기화
        document.querySelectorAll('#modal-advanced-search input[id^="f-"]').forEach(el => {
          el.value = '';
        });
        const selectEnable = document.getElementById('f-enable');
        if (selectEnable) selectEnable.value = '';
        // 장비 선택은 유지하고 데이터만 다시 로드
        searchAndLoadPolicies();
      };
    }
    
    // 엑셀 내보내기 버튼
    const btnExport = document.getElementById('btn-export-excel');
    if (btnExport) btnExport.onclick = () => exportToExcel();
  };
  bind();

  async function exportToExcel() {
    const columnDefs = getCols();
    await exportGridToExcelClient(
      policyGridApi,
      columnDefs,
      'policies',
      '데이터가 없습니다.',
      { type: 'policy' }
    );
  }

  // 초기 로딩 시 자동 선택/자동 조회를 수행하지 않습니다.
}
