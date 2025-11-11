import { api } from '../api.js';
import { adjustGridHeight, createCommonGridOptions, createGridEventHandlersWithFilter } from '../utils/grid.js';
import { exportGridToExcelClient } from '../utils/excel.js';
import { showEmptyMessage, hideEmptyMessage } from '../utils/message.js';
import { saveSearchParams, loadSearchParams, saveGridFilters, loadGridFilters } from '../utils/storage.js';

// ==================== 상수 정의 ====================

// 멤버 셀 렌더러 (공통)
const membersCellRenderer = params => {
  if (!params.value) return '';
  const members = String(params.value).split(',').map(s => s.trim()).filter(Boolean);
  return members.join('<br>');
};

// 공통 컬럼 속성
const commonColumnProps = {
  filter: 'agTextColumnFilter',
  sortable: false,
  filterParams: { buttons: ['apply', 'reset'], debounceMs: 200 }
};

const deviceColumn = {
  field: 'device_name',
  headerName: '장비',
  pinned: 'left',
  minWidth: 120,
  ...commonColumnProps
};

// 탭별 그리드 설정
const TAB_CONFIG = {
  'network-objects': {
    id: 'network-objects-grid',
    messageContainerId: 'network-objects-message-container',
    filterKey: 'objects_network-objects',
    exportName: 'network_objects',
    columns: [
      deviceColumn,
      { field: 'name', headerName: '이름', minWidth: 150, ...commonColumnProps },
      { field: 'ip_address', headerName: 'IP 주소', minWidth: 150, ...commonColumnProps },
      { field: 'type', headerName: '타입', minWidth: 100, ...commonColumnProps },
      { field: 'description', headerName: '설명', minWidth: 200, ...commonColumnProps }
    ],
    apiMethod: (deviceId) => api.getNetworkObjects(deviceId),
    responseKey: 'network_objects'
  },
  'network-groups': {
    id: 'network-groups-grid',
    messageContainerId: 'network-groups-message-container',
    filterKey: 'objects_network-groups',
    exportName: 'network_groups',
    columns: [
      deviceColumn,
      { field: 'name', headerName: '이름', minWidth: 150, ...commonColumnProps },
      {
        field: 'members',
        headerName: '멤버',
        wrapText: true,
        autoHeight: true,
        minWidth: 200,
        cellRenderer: membersCellRenderer,
        ...commonColumnProps
      },
      { field: 'description', headerName: '설명', minWidth: 200, ...commonColumnProps }
    ],
    apiMethod: (deviceId) => api.getNetworkGroups(deviceId),
    responseKey: 'network_groups'
  },
  'services': {
    id: 'services-grid',
    messageContainerId: 'services-message-container',
    filterKey: 'objects_services',
    exportName: 'services',
    columns: [
      deviceColumn,
      { field: 'name', headerName: '이름', minWidth: 150, ...commonColumnProps },
      { field: 'protocol', headerName: '프로토콜', minWidth: 100, ...commonColumnProps },
      { field: 'port', headerName: '포트', minWidth: 100, ...commonColumnProps },
      { field: 'description', headerName: '설명', minWidth: 200, ...commonColumnProps }
    ],
    apiMethod: (deviceId) => api.getServices(deviceId),
    responseKey: 'services'
  },
  'service-groups': {
    id: 'service-groups-grid',
    messageContainerId: 'service-groups-message-container',
    filterKey: 'objects_service-groups',
    exportName: 'service_groups',
    columns: [
      deviceColumn,
      { field: 'name', headerName: '이름', minWidth: 150, ...commonColumnProps },
      {
        field: 'members',
        headerName: '멤버',
        wrapText: true,
        autoHeight: true,
        minWidth: 200,
        cellRenderer: membersCellRenderer,
        ...commonColumnProps
      },
      { field: 'description', headerName: '설명', minWidth: 200, ...commonColumnProps }
    ],
    apiMethod: (deviceId) => api.getServiceGroups(deviceId),
    responseKey: 'service_groups'
  }
};

// ==================== 전역 변수 ====================

const grids = {}; // 탭별 그리드 인스턴스 저장
let currentTab = 'network-objects';
let allDevices = [];

// ==================== 그리드 관리 ====================

/**
 * 모든 그리드 정리
 */
function destroyGrids() {
  Object.values(grids).forEach(grid => {
    if (grid) {
      try {
        grid.destroy();
      } catch (e) {
        console.warn('Failed to destroy grid:', e);
      }
    }
  });
  Object.keys(grids).forEach(key => delete grids[key]);
}

/**
 * 단일 그리드 초기화
 */
function initGrid(tabName) {
  const config = TAB_CONFIG[tabName];
  if (!config) return;

  const gridEl = document.getElementById(config.id);
  if (!gridEl) return;

  const commonOptions = createCommonGridOptions();
  const eventHandlers = createGridEventHandlersWithFilter(
    gridEl,
    config.filterKey,
    saveGridFilters
  );

  grids[tabName] = agGrid.createGrid(gridEl, {
    ...commonOptions,
    columnDefs: config.columns,
    ...eventHandlers
  });
}

/**
 * 모든 그리드 초기화
 */
async function initGrids() {
  destroyGrids();
  Object.keys(TAB_CONFIG).forEach(tabName => initGrid(tabName));
}

// ==================== 장비 관리 ====================

/**
 * 장비 목록 로드 및 Tom-select 초기화
 */
async function loadDevices() {
  try {
    allDevices = await api.listDevices();
    const select = document.getElementById('object-device-select');
    if (!select) return;

    select.innerHTML = '';
    allDevices.forEach(dev => {
      const opt = document.createElement('option');
      opt.value = dev.id;
      opt.textContent = `${dev.name} (${dev.ip_address})`;
      select.appendChild(opt);
    });

    // Tom-select 초기화
    if (window.TomSelect && select) {
      if (select.tomselect) {
        try {
          select.tomselect.destroy();
        } catch (e) {}
      }
      select.tomselect = new window.TomSelect(select, {
        placeholder: '장비 선택',
        plugins: ['remove_button'],
        maxOptions: null,
        onChange: function() {
          const selectedDevices = this.getValue();
          loadData(selectedDevices);
        }
      });
    }
  } catch (err) {
    console.error('Failed to load devices:', err);
  }
}

// ==================== 검색 및 필터 ====================

/**
 * 검색 페이로드 빌드
 */
function buildObjectSearchPayload(deviceIds, objectType) {
  const g = (id) => document.getElementById(id);
  const v = (id) => g(id)?.value?.trim() || null;
  const splitCsv = (val) => (val || '').split(',').map(s => s.trim()).filter(Boolean);

  const payload = {
    device_ids: deviceIds,
    object_type: objectType,
    name: v('obj-f-name'),
    description: v('obj-f-description')
  };

  // 객체 타입별 필터 추가
  const typeFilters = {
    'network-objects': () => {
      payload.ip_address = v('obj-f-ip-address');
      payload.type = v('obj-f-type');
    },
    'network-groups': () => {
      payload.members = v('obj-f-members-network');
    },
    'services': () => {
      payload.protocol = v('obj-f-protocol');
      payload.port = v('obj-f-port');
    },
    'service-groups': () => {
      payload.members = v('obj-f-members-service');
    }
  };

  if (typeFilters[objectType]) {
    typeFilters[objectType]();
  }

  // 쉼표로 구분된 값들을 배열로 변환
  if (payload.name) payload.names = splitCsv(payload.name);
  if (payload.ip_address) payload.ip_addresses = splitCsv(payload.ip_address);
  if (payload.protocol) payload.protocols = splitCsv(payload.protocol);
  if (payload.port) payload.ports = splitCsv(payload.port);

  // 필터가 모두 비어있는지 확인
  const hasFilters = Object.values(payload).some(
    (val, idx) => idx > 1 && val !== null && val !== undefined && val !== ''
  );

  if (!hasFilters && deviceIds.length > 0) {
    payload.limit = 500;
  }

  return payload;
}

/**
 * 현재 탭의 그리드 및 메시지 컨테이너 가져오기
 */
function getCurrentTabElements() {
  const config = TAB_CONFIG[currentTab];
  if (!config) return { grid: null, gridEl: null, messageContainer: null };

  return {
    grid: grids[currentTab],
    gridEl: document.getElementById(config.id),
    messageContainer: document.getElementById(config.messageContainerId),
    config
  };
}

/**
 * 모든 그리드 초기화 (장비 선택 해제 시)
 */
function clearAllGrids() {
  Object.keys(TAB_CONFIG).forEach(tabName => {
    const grid = grids[tabName];
    if (grid && typeof grid.setGridOption === 'function') {
      grid.setGridOption('rowData', []);
      grid.setFilterModel(null);
    }
  });
}

/**
 * 데이터 로드 (멀티 장비 지원, 검색 필터 지원)
 */
async function loadData(deviceIds, useSearch = false) {
  // deviceIds를 배열로 변환
  let deviceIdArray = [];
  if (Array.isArray(deviceIds)) {
    deviceIdArray = deviceIds.map(id => parseInt(id, 10)).filter(Boolean);
  } else if (deviceIds) {
    deviceIdArray = [parseInt(deviceIds, 10)].filter(Boolean);
  }

  // 검색 조건 저장
  if (deviceIdArray.length > 0) {
    const searchPayload = buildObjectSearchPayload(deviceIdArray, currentTab);
    saveSearchParams(`objects_${currentTab}`, {
      deviceIds: deviceIdArray,
      searchPayload,
      useSearch
    });
  }

  const { grid, gridEl, messageContainer, config } = getCurrentTabElements();

  if (deviceIdArray.length === 0) {
    clearAllGrids();
    showEmptyMessage(messageContainer, '장비를 선택하세요', 'fa-mouse-pointer');
    if (gridEl) gridEl.style.display = 'none';
    return;
  }

  hideEmptyMessage(messageContainer);
  if (gridEl) gridEl.style.display = 'block';

  try {
    let mergedData = [];

    if (useSearch) {
      // 검색 API 사용
      const payload = buildObjectSearchPayload(deviceIdArray, currentTab);
      const response = await api.searchObjects(payload);
      mergedData = response[config.responseKey] || [];

      // device_name 추가
      mergedData = mergedData.map(item => {
        const device = allDevices.find(d => d.id === item.device_id);
        const deviceName = device ? device.name : `장비 ${item.device_id}`;
        return { ...item, device_name: deviceName };
      });
    } else {
      // 기존 방식: 여러 장비의 데이터를 병렬로 가져오기
      const dataPromises = deviceIdArray.map(async (deviceId) => {
        const device = allDevices.find(d => d.id === deviceId);
        const deviceName = device ? device.name : `장비 ${deviceId}`;
        const data = await config.apiMethod(deviceId);
        return data.map(item => ({ ...item, device_name: deviceName }));
      });

      const results = await Promise.all(dataPromises);
      mergedData = results.flat();
    }

    // 그리드에 데이터 설정
    if (grid && gridEl) {
      grid.setGridOption('rowData', mergedData);

      // 저장된 필터 복원
      const savedFilters = loadGridFilters(config.filterKey);
      if (savedFilters && typeof grid.setFilterModel === 'function') {
        grid.setFilterModel(savedFilters);
      }

      // 컬럼 크기 조절 및 높이 조절
      setTimeout(() => {
        if (typeof grid.autoSizeAllColumns === 'function') {
          grid.autoSizeAllColumns({ skipHeader: false });
        }
        adjustGridHeight(gridEl);
      }, 600);
    }

    // 데이터가 없으면 메시지 표시
    if (mergedData.length === 0) {
      showEmptyMessage(messageContainer, '검색 결과가 없습니다', 'fa-search');
      if (gridEl) gridEl.style.display = 'none';
    } else {
      hideEmptyMessage(messageContainer);
      if (gridEl) gridEl.style.display = 'block';
    }
  } catch (err) {
    console.error(`Failed to load ${currentTab}:`, err);
    alert(`데이터 로드 실패: ${err.message}`);
  }
}

// ==================== 탭 관리 ====================

/**
 * 탭 전환
 */
function switchTab(tabName) {
  if (!TAB_CONFIG[tabName]) return;

  // 모든 탭 콘텐츠 숨기기
  document.querySelectorAll('.tab-content').forEach(content => {
    content.style.display = 'none';
  });

  // 모든 탭 아이템 비활성화
  document.querySelectorAll('.tab-item').forEach(item => {
    item.classList.remove('is-active');
  });

  // 선택된 탭 활성화
  const tabContent = document.getElementById(`tab-${tabName}`);
  const tabItem = document.querySelector(`.tab-item[data-tab="${tabName}"]`);

  if (tabContent) tabContent.style.display = 'block';
  if (tabItem) tabItem.classList.add('is-active');

  currentTab = tabName;

  // 탭 전환 시 그리드 높이 조절
  setTimeout(() => {
    const { gridEl } = getCurrentTabElements();
    if (gridEl) adjustGridHeight(gridEl);
  }, 100);

  // 저장된 상태 복원
  const savedState = loadSearchParams(`objects_${tabName}`);
  const select = document.getElementById('object-device-select');

  if (savedState && savedState.deviceIds && savedState.deviceIds.length > 0 && select?.tomselect) {
    // 저장된 장비 선택 복원
    select.tomselect.setValue(savedState.deviceIds);

    // 저장된 검색 필터 복원
    if (savedState.searchPayload) {
      const payload = savedState.searchPayload;
      const g = (id) => document.getElementById(id);
      const setValue = (id, value) => {
        const el = g(id);
        if (el && value !== null && value !== '') {
          el.value = value;
        }
      };

      setValue('obj-f-name', payload.name);
      setValue('obj-f-description', payload.description);

      // 탭별 필터 필드 복원
      const filterRestoreMap = {
        'network-objects': () => {
          setValue('obj-f-ip-address', payload.ip_address);
          setValue('obj-f-type', payload.type);
        },
        'network-groups': () => setValue('obj-f-members-network', payload.members),
        'services': () => {
          setValue('obj-f-protocol', payload.protocol);
          setValue('obj-f-port', payload.port);
        },
        'service-groups': () => setValue('obj-f-members-service', payload.members)
      };

      if (filterRestoreMap[tabName]) {
        filterRestoreMap[tabName]();
      }
    }

    // 저장된 검색 모드로 데이터 로드
    loadData(savedState.deviceIds, savedState.useSearch || false);
  } else {
    // 저장된 상태가 없으면 현재 선택된 장비로 데이터 로드
    if (select?.tomselect) {
      const selectedDevices = select.tomselect.getValue();
      if (selectedDevices && selectedDevices.length > 0) {
        loadData(selectedDevices);
      }
    }
  }
}

// ==================== 엑셀 내보내기 ====================

/**
 * 엑셀 내보내기
 */
async function exportToExcel() {
  const { grid, config } = getCurrentTabElements();

  if (!grid || !config) {
    alert('데이터가 없습니다.');
    return;
  }

  await exportGridToExcelClient(
    grid,
    config.columns,
    config.exportName,
    '데이터가 없습니다.',
    { type: 'object' }
  );
}

// ==================== 초기화 ====================

/**
 * 객체 페이지 초기화
 */
export async function initObjects() {
  currentTab = 'network-objects';

  await initGrids();
  await loadDevices();

  // 첫 번째 탭 활성화
  switchTab(currentTab);

  // 탭 클릭 이벤트
  document.querySelectorAll('.tab-item').forEach(item => {
    item.addEventListener('click', () => {
      const tabName = item.dataset.tab;
      if (tabName) switchTab(tabName);
    });
  });

  // 필터 초기화 버튼 이벤트
  const btnResetFilters = document.getElementById('btn-reset-objects-filters');
  if (btnResetFilters) {
    btnResetFilters.onclick = () => {
      // 모든 그리드의 필터 초기화
      Object.values(grids).forEach(grid => {
        if (grid && typeof grid.setFilterModel === 'function') {
          grid.setFilterModel(null);
        }
      });

      // 상세 검색 필터 초기화
      document.querySelectorAll('#modal-objects-advanced-search input[id^="obj-f-"]').forEach(el => {
        el.value = '';
      });

      // 장비 선택은 유지하고 데이터만 다시 로드
      const select = document.getElementById('object-device-select');
      if (select?.tomselect) {
        const selectedDevices = select.tomselect.getValue();
        if (selectedDevices && selectedDevices.length > 0) {
          loadData(selectedDevices, false);
        }
      }
    };
  }

  // 엑셀 내보내기 버튼 이벤트
  const btnExport = document.getElementById('btn-export-objects-excel');
  if (btnExport) {
    btnExport.onclick = () => exportToExcel();
  }

  // 상세 검색 모달 이벤트
  const modal = document.getElementById('modal-objects-advanced-search');
  const btnAdvancedSearch = document.getElementById('btn-objects-advanced-search');
  const btnCloseModal = document.getElementById('close-objects-advanced-search');
  const btnCancelModal = document.getElementById('cancel-objects-advanced-search');
  const btnApplySearch = document.getElementById('btn-objects-apply-search');
  const btnClearSearch = document.getElementById('btn-objects-clear-search');

  // 탭별 필터 필드 표시/숨김 함수
  function updateFilterVisibility() {
    const filterFields = document.querySelectorAll('[data-filter-type]');
    filterFields.forEach(field => {
      const filterType = field.getAttribute('data-filter-type');
      field.style.display = filterType === currentTab ? 'block' : 'none';
    });
  }

  const openModal = () => {
    updateFilterVisibility();
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
    if (e.key === 'Escape' && modal?.classList.contains('is-active')) {
      closeModal();
    }
  });

  // 상세 검색 적용
  if (btnApplySearch) {
    btnApplySearch.onclick = () => {
      const select = document.getElementById('object-device-select');
      if (select?.tomselect) {
        const selectedDevices = select.tomselect.getValue();
        if (selectedDevices && selectedDevices.length > 0) {
          loadData(selectedDevices, true);
        } else {
          alert('장비를 선택하세요');
        }
      }
      closeModal();
    };
  }

  // 상세 검색 초기화
  if (btnClearSearch) {
    btnClearSearch.onclick = () => {
      document.querySelectorAll('#modal-objects-advanced-search input[id^="obj-f-"]').forEach(el => {
        el.value = '';
      });
    };
  }

  // 탭 전환 시 필터 필드 업데이트
  const originalSwitchTab = switchTab;
  switchTab = function(tabName) {
    originalSwitchTab(tabName);
    if (modal?.classList.contains('is-active')) {
      updateFilterVisibility();
    }
  };

  // 초기 필터 필드 표시 상태 설정
  updateFilterVisibility();
}
