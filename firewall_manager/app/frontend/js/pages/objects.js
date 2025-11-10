import { api } from '../api.js';
import { adjustGridHeight, createGridEventHandlers, createCommonGridOptions } from '../utils/grid.js';
import { exportGridToExcelClient } from '../utils/excel.js';
import { showEmptyMessage, hideEmptyMessage } from '../utils/message.js';

// ==================== 전역 변수 ====================

let networkObjectsGrid = null;
let networkGroupsGrid = null;
let servicesGrid = null;
let serviceGroupsGrid = null;

let currentTab = 'network-objects';

// 네트워크 객체 그리드 컬럼 정의
const networkObjectsColumns = [
  { field: 'device_name', headerName: '장비', filter: 'agTextColumnFilter', pinned: 'left', minWidth: 120, sortable: false, filterParams: { buttons: ['apply', 'reset'], debounceMs: 200 } },
  { field: 'name', headerName: '이름', filter: 'agTextColumnFilter', minWidth: 150, sortable: false, filterParams: { buttons: ['apply', 'reset'], debounceMs: 200 } },
  { field: 'ip_address', headerName: 'IP 주소', filter: 'agTextColumnFilter', minWidth: 150, sortable: false, filterParams: { buttons: ['apply', 'reset'], debounceMs: 200 } },
  { field: 'type', headerName: '타입', filter: 'agTextColumnFilter', minWidth: 100, sortable: false, filterParams: { buttons: ['apply', 'reset'], debounceMs: 200 } },
  { field: 'description', headerName: '설명', filter: 'agTextColumnFilter', minWidth: 200, sortable: false, filterParams: { buttons: ['apply', 'reset'], debounceMs: 200 } }
];

// 네트워크 그룹 그리드 컬럼 정의
const networkGroupsColumns = [
  { field: 'device_name', headerName: '장비', filter: 'agTextColumnFilter', pinned: 'left', minWidth: 120, sortable: false, filterParams: { buttons: ['apply', 'reset'], debounceMs: 200 } },
  { field: 'name', headerName: '이름', filter: 'agTextColumnFilter', minWidth: 150, sortable: false, filterParams: { buttons: ['apply', 'reset'], debounceMs: 200 } },
  {
    field: 'members',
    headerName: '멤버',
    filter: 'agTextColumnFilter',
    wrapText: true,
    autoHeight: true,
    minWidth: 200,
    sortable: false,
    filterParams: { buttons: ['apply', 'reset'], debounceMs: 200 },
    cellRenderer: params => {
      if (!params.value) return '';
      const members = String(params.value).split(',').map(s => s.trim()).filter(Boolean);
      return members.join('<br>');
    }
  },
  { field: 'description', headerName: '설명', filter: 'agTextColumnFilter', minWidth: 200, sortable: false, filterParams: { buttons: ['apply', 'reset'], debounceMs: 200 } }
];

// 서비스 객체 그리드 컬럼 정의
const servicesColumns = [
  { field: 'device_name', headerName: '장비', filter: 'agTextColumnFilter', pinned: 'left', minWidth: 120, sortable: false, filterParams: { buttons: ['apply', 'reset'], debounceMs: 200 } },
  { field: 'name', headerName: '이름', filter: 'agTextColumnFilter', minWidth: 150, sortable: false, filterParams: { buttons: ['apply', 'reset'], debounceMs: 200 } },
  { field: 'protocol', headerName: '프로토콜', filter: 'agTextColumnFilter', minWidth: 100, sortable: false, filterParams: { buttons: ['apply', 'reset'], debounceMs: 200 } },
  { field: 'port', headerName: '포트', filter: 'agTextColumnFilter', minWidth: 100, sortable: false, filterParams: { buttons: ['apply', 'reset'], debounceMs: 200 } },
  { field: 'description', headerName: '설명', filter: 'agTextColumnFilter', minWidth: 200, sortable: false, filterParams: { buttons: ['apply', 'reset'], debounceMs: 200 } }
];

// 서비스 그룹 그리드 컬럼 정의
const serviceGroupsColumns = [
  { field: 'device_name', headerName: '장비', filter: 'agTextColumnFilter', pinned: 'left', minWidth: 120, sortable: false, filterParams: { buttons: ['apply', 'reset'], debounceMs: 200 } },
  { field: 'name', headerName: '이름', filter: 'agTextColumnFilter', minWidth: 150, sortable: false, filterParams: { buttons: ['apply', 'reset'], debounceMs: 200 } },
  {
    field: 'members',
    headerName: '멤버',
    filter: 'agTextColumnFilter',
    wrapText: true,
    autoHeight: true,
    minWidth: 200,
    sortable: false,
    filterParams: { buttons: ['apply', 'reset'], debounceMs: 200 },
    cellRenderer: params => {
      if (!params.value) return '';
      const members = String(params.value).split(',').map(s => s.trim()).filter(Boolean);
      return members.join('<br>');
    }
  },
  { field: 'description', headerName: '설명', filter: 'agTextColumnFilter', minWidth: 200, sortable: false, filterParams: { buttons: ['apply', 'reset'], debounceMs: 200 } }
];

// 그리드 정리
function destroyGrids() {
  if (networkObjectsGrid) {
    try { networkObjectsGrid.destroy(); } catch (e) { console.warn('Failed to destroy networkObjectsGrid:', e); }
    networkObjectsGrid = null;
  }
  if (networkGroupsGrid) {
    try { networkGroupsGrid.destroy(); } catch (e) { console.warn('Failed to destroy networkGroupsGrid:', e); }
    networkGroupsGrid = null;
  }
  if (servicesGrid) {
    try { servicesGrid.destroy(); } catch (e) { console.warn('Failed to destroy servicesGrid:', e); }
    servicesGrid = null;
  }
  if (serviceGroupsGrid) {
    try { serviceGroupsGrid.destroy(); } catch (e) { console.warn('Failed to destroy serviceGroupsGrid:', e); }
    serviceGroupsGrid = null;
  }
}

// 그리드 초기화
async function initGrids() {
  // 기존 그리드 정리
  destroyGrids();

  // 공통 그리드 옵션
  const commonGridOptions = {
    defaultColDef: {
      resizable: true,
      sortable: false,
      filter: true,
    },
    enableCellTextSelection: true,
    getRowId: params => String(params.data.id),
    suppressHorizontalScroll: false,
    enableFilterHandlers: true,
    pagination: true,
    paginationPageSize: 50,
    paginationPageSizeSelector: [50, 100, 200],
  };

  // 네트워크 객체 그리드
  const networkObjectsEl = document.getElementById('network-objects-grid');
  if (networkObjectsEl) {
    networkObjectsGrid = agGrid.createGrid(networkObjectsEl, {
      ...commonGridOptions,
      columnDefs: networkObjectsColumns,
      onGridReady: params => {
        setTimeout(() => {
          adjustGridHeight(networkObjectsEl);
        }, 200);
      },
      onFirstDataRendered: params => {
        setTimeout(() => {
          params.api.autoSizeAllColumns({ skipHeader: false });
          adjustGridHeight(networkObjectsEl);
        }, 200);
      },
      onModelUpdated: params => {
        if (params.api.getDisplayedRowCount() > 0) {
          setTimeout(() => {
            params.api.autoSizeAllColumns({ skipHeader: false });
            adjustGridHeight(networkObjectsEl);
          }, 200);
        }
      },
      onPaginationChanged: () => {
        setTimeout(() => {
          adjustGridHeight(networkObjectsEl);
        }, 200);
      },
      onRowDataUpdated: () => {
        setTimeout(() => {
          adjustGridHeight(networkObjectsEl);
        }, 200);
      },
    });
  }

  // 네트워크 그룹 그리드
  const networkGroupsEl = document.getElementById('network-groups-grid');
  if (networkGroupsEl) {
    networkGroupsGrid = agGrid.createGrid(networkGroupsEl, {
      ...commonGridOptions,
      columnDefs: networkGroupsColumns,
      onGridReady: params => {
        setTimeout(() => {
          adjustGridHeight(networkGroupsEl);
        }, 200);
      },
      onFirstDataRendered: params => {
        setTimeout(() => {
          params.api.autoSizeAllColumns({ skipHeader: false });
          adjustGridHeight(networkGroupsEl);
        }, 200);
      },
      onModelUpdated: params => {
        if (params.api.getDisplayedRowCount() > 0) {
          setTimeout(() => {
            params.api.autoSizeAllColumns({ skipHeader: false });
            adjustGridHeight(networkGroupsEl);
          }, 200);
        }
      },
      onPaginationChanged: () => {
        setTimeout(() => {
          adjustGridHeight(networkGroupsEl);
        }, 200);
      },
      onRowDataUpdated: () => {
        setTimeout(() => {
          adjustGridHeight(networkGroupsEl);
        }, 200);
      },
    });
  }

  // 서비스 객체 그리드
  const servicesEl = document.getElementById('services-grid');
  if (servicesEl) {
    servicesGrid = agGrid.createGrid(servicesEl, {
      ...commonGridOptions,
      columnDefs: servicesColumns,
      onGridReady: params => {
        setTimeout(() => {
          adjustGridHeight(servicesEl);
        }, 200);
      },
      onFirstDataRendered: params => {
        setTimeout(() => {
          params.api.autoSizeAllColumns({ skipHeader: false });
          adjustGridHeight(servicesEl);
        }, 200);
      },
      onModelUpdated: params => {
        if (params.api.getDisplayedRowCount() > 0) {
          setTimeout(() => {
            params.api.autoSizeAllColumns({ skipHeader: false });
            adjustGridHeight(servicesEl);
          }, 200);
        }
      },
      onPaginationChanged: () => {
        setTimeout(() => {
          adjustGridHeight(servicesEl);
        }, 200);
      },
      onRowDataUpdated: () => {
        setTimeout(() => {
          adjustGridHeight(servicesEl);
        }, 200);
      },
    });
  }

  // 서비스 그룹 그리드
  const serviceGroupsEl = document.getElementById('service-groups-grid');
  if (serviceGroupsEl) {
    serviceGroupsGrid = agGrid.createGrid(serviceGroupsEl, {
      ...commonGridOptions,
      columnDefs: serviceGroupsColumns,
      onGridReady: params => {
        setTimeout(() => {
          adjustGridHeight(serviceGroupsEl);
        }, 200);
      },
      onFirstDataRendered: params => {
        setTimeout(() => {
          params.api.autoSizeAllColumns({ skipHeader: false });
          adjustGridHeight(serviceGroupsEl);
        }, 200);
      },
      onModelUpdated: params => {
        if (params.api.getDisplayedRowCount() > 0) {
          setTimeout(() => {
            params.api.autoSizeAllColumns({ skipHeader: false });
            adjustGridHeight(serviceGroupsEl);
          }, 200);
        }
      },
      onPaginationChanged: () => {
        setTimeout(() => {
          adjustGridHeight(serviceGroupsEl);
        }, 200);
      },
      onRowDataUpdated: () => {
        setTimeout(() => {
          adjustGridHeight(serviceGroupsEl);
        }, 200);
      },
    });
  }
}

// 장비 목록을 저장할 변수
let allDevices = [];

// 장비 목록 로드
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
        try { select.tomselect.destroy(); } catch (e) {}
      }
      select.tomselect = new window.TomSelect(select, {
        placeholder: '장비 선택',
        plugins: ['remove_button'],
        maxOptions: null,
        onChange: function(value) {
          loadData(value);
        }
      });
      // 초기 로딩 시 자동 선택/자동 로드를 수행하지 않습니다.
    }
  } catch (err) {
    console.error('Failed to load devices:', err);
  }
}

// 데이터 로드 (멀티 장비 지원)
async function loadData(deviceIds) {
    // deviceIds를 배열로 변환 (단일 값이거나 문자열일 경우 대비)
    let deviceIdArray = [];
    if (Array.isArray(deviceIds)) {
        deviceIdArray = deviceIds;
    } else if (deviceIds) {
        deviceIdArray = [deviceIds];
    } else {
        const select = document.getElementById('object-device-select');
        if (select && select.tomselect) {
            const selected = select.tomselect.getValue();
            if (Array.isArray(selected)) {
                deviceIdArray = selected.map(id => parseInt(id, 10));
            } else if (selected) {
                deviceIdArray = [parseInt(selected, 10)];
            }
        }
    }


    const messageContainerMap = {
        'network-objects': 'network-objects-message-container',
        'network-groups': 'network-groups-message-container',
        'services': 'services-message-container',
        'service-groups': 'service-groups-message-container'
    };
    
    const currentMessageContainer = document.getElementById(messageContainerMap[currentTab.replace('-', '_')]);
    const currentGridElement = document.getElementById(`${currentTab}-grid`);

    if (deviceIdArray.length === 0) {
        const grids = [networkObjectsGrid, networkGroupsGrid, servicesGrid, serviceGroupsGrid];
        grids.forEach(grid => {
            if (grid) {
                grid.setGridOption('rowData', []);
                grid.setFilterModel(null);
            }
        });
        showEmptyMessage(currentMessageContainer, '장비를 선택하세요', 'fa-mouse-pointer');
        if (currentGridElement) currentGridElement.style.display = 'none';
        return;
    }

    hideEmptyMessage(currentMessageContainer);
    if (currentGridElement) currentGridElement.style.display = 'block';

    try {
        const payload = buildObjectSearchPayload(deviceIdArray);
        let mergedData;

        if (payload.hasSearchParams) {
            mergedData = await api.searchObjects(payload.data);
        } else {
            const dataPromises = deviceIdArray.map(async (deviceId) => {
                let data = [];
                if (currentTab === 'network-objects') data = await api.getNetworkObjects(deviceId);
                else if (currentTab === 'network-groups') data = await api.getNetworkGroups(deviceId);
                else if (currentTab === 'services') data = await api.getServices(deviceId);
                else if (currentTab === 'service-groups') data = await api.getServiceGroups(deviceId);
                return data;
            });
            const results = await Promise.all(dataPromises);
            mergedData = results.flat();
        }

        const deviceNameMap = Object.fromEntries(allDevices.map(d => [d.id, d.name]));
        const dataWithDeviceNames = mergedData.map(item => ({
            ...item,
            device_name: deviceNameMap[item.device_id] || `장비 ${item.device_id}`
        }));

        const gridMap = {
            'network-objects': networkObjectsGrid,
            'network-groups': networkGroupsGrid,
            'services': servicesGrid,
            'service-groups': serviceGroupsGrid
        };
        const currentGrid = gridMap[currentTab];

        if (currentGrid) {
            currentGrid.setGridOption('rowData', dataWithDeviceNames);
            setTimeout(() => {
                if (typeof currentGrid.autoSizeAllColumns === 'function') {
                    currentGrid.autoSizeAllColumns({ skipHeader: false });
                }
                if (currentGridElement) adjustGridHeight(currentGridElement);
            }, 600);
        }

        if (dataWithDeviceNames.length === 0) {
            showEmptyMessage(currentMessageContainer, '검색 결과가 없습니다.', 'fa-search');
            if (currentGridElement) currentGridElement.style.display = 'none';
        }

    } catch (err) {
        console.error(`Failed to load ${currentTab}:`, err);
        alert(`데이터 로드 실패: ${err.message}`);
        showEmptyMessage(currentMessageContainer, '데이터 로드 실패', 'fa-exclamation-triangle');
        if (currentGridElement) currentGridElement.style.display = 'none';
    }
}

function buildObjectSearchPayload(deviceIds) {
    const v = (id) => document.getElementById(id)?.value?.trim() || null;

    let objectType = currentTab.replace('-', '_');
    if (objectType.endsWith('s')) {
        objectType = objectType.slice(0, -1);
    }

    let payload = {
        device_ids: deviceIds,
        object_type: objectType
    };
    let hasSearchParams = false;

    switch (currentTab) {
        case 'network-objects':
            payload.name = v('f-no-name');
            payload.ip_address = v('f-no-ip');
            payload.type = v('f-no-type');
            payload.description = v('f-no-desc');
            break;
        case 'network-groups':
            payload.name = v('f-ng-name');
            payload.members = v('f-ng-members');
            payload.description = v('f-ng-desc');
            break;
        case 'services':
            payload.name = v('f-svc-name');
            payload.protocol = v('f-svc-protocol');
            payload.port = v('f-svc-port');
            payload.description = v('f-svc-desc');
            break;
        case 'service-groups':
            payload.name = v('f-sg-name');
            payload.members = v('f-sg-members');
            payload.description = v('f-sg-desc');
            break;
    }

    // Check if any search parameters other than device_ids and object_type are present
    hasSearchParams = Object.keys(payload).some(key =>
        key !== 'device_ids' && key !== 'object_type' && payload[key]
    );

    return { data: payload, hasSearchParams: hasSearchParams };
}

// 탭 전환
function switchTab(tabName) {
  // 탭 메뉴 활성화 상태 변경
  document.querySelectorAll('.tabs li').forEach(li => {
    if (li.dataset.tab === tabName) {
      li.classList.add('is-active');
    } else {
      li.classList.remove('is-active');
    }
  });

  // 탭 컨텐츠 표시/숨김
  document.querySelectorAll('.tab-pane').forEach(pane => {
    pane.style.display = 'none';
  });

  const activePane = document.getElementById(`${tabName}-content`);
  if (activePane) {
    activePane.style.display = 'block';
  }

  currentTab = tabName;

  // 상세 검색 모달 필터 창 전환
  document.querySelectorAll('.filter-pane').forEach(pane => {
      pane.classList.add('is-hidden');
  });
  const activeFilterPane = document.getElementById(`filter-${tabName.replace('-', '_')}`);
  if (activeFilterPane) {
      activeFilterPane.classList.remove('is-hidden');
  }


  // 탭 전환 시 그리드 높이 조절
  setTimeout(() => {
    let gridElement = null;
    if (tabName === 'network-objects') {
      gridElement = document.getElementById('network-objects-grid');
    } else if (tabName === 'network-groups') {
      gridElement = document.getElementById('network-groups-grid');
    } else if (tabName === 'services') {
      gridElement = document.getElementById('services-grid');
    } else if (tabName === 'service-groups') {
      gridElement = document.getElementById('service-groups-grid');
    }
    
    if (gridElement) {
      adjustGridHeight(gridElement);
    }
  }, 100);

  // 현재 선택된 장비로 데이터 로드
  const select = document.getElementById('object-device-select');
  if (select && select.tomselect) {
    const selectedDevices = select.tomselect.getValue();
    if (selectedDevices && selectedDevices.length > 0) {
      loadData(selectedDevices);
    }
  }
}

/**
 * 엑셀 내보내기
 */
async function exportToExcel() {
  const gridMap = {
    'network-objects': { 
      grid: networkObjectsGrid, 
      name: 'network_objects',
      columnDefs: networkObjectsColumns
    },
    'network-groups': { 
      grid: networkGroupsGrid, 
      name: 'network_groups',
      columnDefs: networkGroupsColumns
    },
    'services': { 
      grid: servicesGrid, 
      name: 'services',
      columnDefs: servicesColumns
    },
    'service-groups': { 
      grid: serviceGroupsGrid, 
      name: 'service_groups',
      columnDefs: serviceGroupsColumns
    }
  };
  
  const current = gridMap[currentTab];
  if (!current || !current.grid) {
    alert('데이터가 없습니다.');
    return;
  }
  
  await exportGridToExcelClient(
    current.grid,
    current.columnDefs,
    current.name,
    '데이터가 없습니다.',
    { type: 'object' }
  );
}

// 초기화
export async function initObjects() {
  // currentTab을 초기 상태로 리셋
  currentTab = 'network-objects';
  
  await initGrids();
  await loadDevices(); // Tom-select 초기화
  loadData([]); // 최초 로딩 시 그리드 클리어

    // 탭 클릭 이벤트
    document.querySelectorAll('.tabs li').forEach(li => {
        li.addEventListener('click', () => {
            const tabName = li.dataset.tab;
            if (tabName) {
                switchTab(tabName);
            }
        });
    });

    // 상세 검색 모달 이벤트
    const modal = document.getElementById('modal-advanced-object-search');
    const btnAdvancedSearch = document.getElementById('btn-advanced-object-search');
    const btnCloseModal = document.getElementById('close-advanced-object-search');
    const btnCancelModal = document.getElementById('cancel-advanced-object-search');
    const btnApplySearch = document.getElementById('btn-apply-object-search');
    const btnClearSearch = document.getElementById('btn-clear-object-search');

    const openModal = () => modal.classList.add('is-active');
    const closeModal = () => modal.classList.remove('is-active');

    if (btnAdvancedSearch) btnAdvancedSearch.onclick = openModal;
    if (btnCloseModal) btnCloseModal.onclick = closeModal;
    if (btnCancelModal) btnCancelModal.onclick = closeModal;
    if (modal) modal.querySelector('.modal-background')?.addEventListener('click', closeModal);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal?.classList.contains('is-active')) {
            closeModal();
        }
    });

    if (btnApplySearch) {
        btnApplySearch.onclick = () => {
            loadData();
            closeModal();
        };
    }

    if (btnClearSearch) {
        btnClearSearch.onclick = () => {
            document.querySelectorAll('#modal-advanced-object-search input[type="text"]').forEach(input => input.value = '');
        };
    }

    // 필터 초기화 버튼 이벤트
    const btnResetFilters = document.getElementById('btn-reset-objects-filters');
    if (btnResetFilters) {
        btnResetFilters.onclick = () => {
            // AG Grid 필터 초기화
            [networkObjectsGrid, networkGroupsGrid, servicesGrid, serviceGroupsGrid].forEach(grid => {
                if (grid) grid.setFilterModel(null);
            });
            // 상세 검색 필터 초기화
            document.querySelectorAll('#modal-advanced-object-search input[type="text"]').forEach(input => input.value = '');
            // 데이터 다시 로드
            loadData();
        };
    }

    // 엑셀 내보내기 버튼 이벤트
    const btnExport = document.getElementById('btn-export-objects-excel');
    if (btnExport) {
        btnExport.onclick = () => exportToExcel();
    }
}
