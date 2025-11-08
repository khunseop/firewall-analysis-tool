import { api } from '../api.js';

let networkObjectsGrid = null;
let networkGroupsGrid = null;
let servicesGrid = null;
let serviceGroupsGrid = null;

let currentTab = 'network-objects';

// 그리드 높이를 자동으로 조절하는 함수 (세로 스크롤 없이 모든 행 표시)
function adjustGridHeight(gridDiv) {
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
    bodyHeight = bodyViewport.scrollHeight;
    
    // bodyViewport의 padding/margin도 고려
    const bodyViewportStyle = window.getComputedStyle(bodyViewport);
    const paddingTop = parseInt(bodyViewportStyle.paddingTop) || 0;
    const paddingBottom = parseInt(bodyViewportStyle.paddingBottom) || 0;
    bodyHeight += paddingTop + paddingBottom;
  } else {
    // fallback: 행 요소들의 높이 합계
    const rowElements = gridDiv.querySelectorAll('.ag-row:not(.ag-header-row)');
    rowElements.forEach(row => {
      bodyHeight += row.offsetHeight || 0;
    });
  }
  
  // ag-center-cols-container의 높이도 확인 (더 정확한 측정)
  const centerColsContainer = gridDiv.querySelector('.ag-center-cols-container');
  if (centerColsContainer && centerColsContainer.offsetHeight > bodyHeight) {
    bodyHeight = centerColsContainer.offsetHeight;
  }
  
  // 높이 계산: 헤더 + 본문 높이 + 페이지네이션
  const calculatedHeight = headerHeight + bodyHeight + paginationHeight;
  const minHeight = 200;
  const finalHeight = Math.max(calculatedHeight, minHeight);
  
  gridDiv.style.height = `${finalHeight}px`;
  
  // 세로 스크롤 강제 제거
  if (bodyViewport) {
    bodyViewport.style.overflowY = 'hidden';
    bodyViewport.style.overflowX = 'auto';
  }
}

// 네트워크 객체 그리드 컬럼 정의
const networkObjectsColumns = [
  { field: 'device_name', headerName: '장비', filter: 'agTextColumnFilter', minWidth: 120, sortable: false, filterParams: { buttons: ['apply', 'reset'], debounceMs: 200 } },
  { field: 'name', headerName: '이름', filter: 'agTextColumnFilter', minWidth: 150, sortable: false, filterParams: { buttons: ['apply', 'reset'], debounceMs: 200 } },
  { field: 'ip_address', headerName: 'IP 주소', filter: 'agTextColumnFilter', minWidth: 150, sortable: false, filterParams: { buttons: ['apply', 'reset'], debounceMs: 200 } },
  { field: 'type', headerName: '타입', filter: 'agTextColumnFilter', minWidth: 100, sortable: false, filterParams: { buttons: ['apply', 'reset'], debounceMs: 200 } },
  { field: 'description', headerName: '설명', filter: 'agTextColumnFilter', minWidth: 200, sortable: false, filterParams: { buttons: ['apply', 'reset'], debounceMs: 200 } }
];

// 네트워크 그룹 그리드 컬럼 정의
const networkGroupsColumns = [
  { field: 'device_name', headerName: '장비', filter: 'agTextColumnFilter', minWidth: 120, sortable: false, filterParams: { buttons: ['apply', 'reset'], debounceMs: 200 } },
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
  { field: 'device_name', headerName: '장비', filter: 'agTextColumnFilter', minWidth: 120, sortable: false, filterParams: { buttons: ['apply', 'reset'], debounceMs: 200 } },
  { field: 'name', headerName: '이름', filter: 'agTextColumnFilter', minWidth: 150, sortable: false, filterParams: { buttons: ['apply', 'reset'], debounceMs: 200 } },
  { field: 'protocol', headerName: '프로토콜', filter: 'agTextColumnFilter', minWidth: 100, sortable: false, filterParams: { buttons: ['apply', 'reset'], debounceMs: 200 } },
  { field: 'port', headerName: '포트', filter: 'agTextColumnFilter', minWidth: 100, sortable: false, filterParams: { buttons: ['apply', 'reset'], debounceMs: 200 } },
  { field: 'description', headerName: '설명', filter: 'agTextColumnFilter', minWidth: 200, sortable: false, filterParams: { buttons: ['apply', 'reset'], debounceMs: 200 } }
];

// 서비스 그룹 그리드 컬럼 정의
const serviceGroupsColumns = [
  { field: 'device_name', headerName: '장비', filter: 'agTextColumnFilter', minWidth: 120, sortable: false, filterParams: { buttons: ['apply', 'reset'], debounceMs: 200 } },
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
    suppressSizeToFit: true,
    suppressHorizontalScroll: false,
    suppressVerticalScroll: true,
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
        onChange: function() {
          const selectedDevices = this.getValue();
          loadData(selectedDevices);
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
  }

  if (deviceIdArray.length === 0) {
    // 선택된 장비가 없으면 빈 데이터 표시 및 필터 초기화
    if (networkObjectsGrid) {
      networkObjectsGrid.setGridOption('rowData', []);
      networkObjectsGrid.setFilterModel(null);
    }
    if (networkGroupsGrid) {
      networkGroupsGrid.setGridOption('rowData', []);
      networkGroupsGrid.setFilterModel(null);
    }
    if (servicesGrid) {
      servicesGrid.setGridOption('rowData', []);
      servicesGrid.setFilterModel(null);
    }
    if (serviceGroupsGrid) {
      serviceGroupsGrid.setGridOption('rowData', []);
      serviceGroupsGrid.setFilterModel(null);
    }
    return;
  }

  try {
    // 여러 장비의 데이터를 병렬로 가져오기
    const dataPromises = deviceIdArray.map(async (deviceId) => {
      const device = allDevices.find(d => d.id === parseInt(deviceId));
      const deviceName = device ? device.name : `장비 ${deviceId}`;
      
      let data = [];
      if (currentTab === 'network-objects') {
        data = await api.getNetworkObjects(deviceId);
      } else if (currentTab === 'network-groups') {
        data = await api.getNetworkGroups(deviceId);
      } else if (currentTab === 'services') {
        data = await api.getServices(deviceId);
      } else if (currentTab === 'service-groups') {
        data = await api.getServiceGroups(deviceId);
      }
      
      // 각 항목에 device_name 추가
      return data.map(item => ({
        ...item,
        device_name: deviceName
      }));
    });

    const results = await Promise.all(dataPromises);
    const mergedData = results.flat();

    // 해당 그리드에 데이터 설정
    let currentGrid = null;
    let gridElement = null;
    
    if (currentTab === 'network-objects' && networkObjectsGrid) {
      currentGrid = networkObjectsGrid;
      gridElement = document.getElementById('network-objects-grid');
      currentGrid.setGridOption('rowData', mergedData);
    } else if (currentTab === 'network-groups' && networkGroupsGrid) {
      currentGrid = networkGroupsGrid;
      gridElement = document.getElementById('network-groups-grid');
      currentGrid.setGridOption('rowData', mergedData);
    } else if (currentTab === 'services' && servicesGrid) {
      currentGrid = servicesGrid;
      gridElement = document.getElementById('services-grid');
      currentGrid.setGridOption('rowData', mergedData);
    } else if (currentTab === 'service-groups' && serviceGroupsGrid) {
      currentGrid = serviceGroupsGrid;
      gridElement = document.getElementById('service-groups-grid');
      currentGrid.setGridOption('rowData', mergedData);
    }
    
    // 컬럼 크기 조절 및 높이 조절
    if (currentGrid && gridElement) {
      setTimeout(() => {
        if (typeof currentGrid.autoSizeAllColumns === 'function') {
          currentGrid.autoSizeAllColumns({ skipHeader: false });
        }
        adjustGridHeight(gridElement);
      }, 600);
    }
  } catch (err) {
    console.error(`Failed to load ${currentTab}:`, err);
    alert(`데이터 로드 실패: ${err.message}`);
  }
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

// 엑셀 내보내기
async function exportToExcel() {
  let currentGrid = null;
  let fileName = '';
  
  switch (currentTab) {
    case 'network-objects':
      currentGrid = networkObjectsGrid;
      fileName = 'network_objects';
      break;
    case 'network-groups':
      currentGrid = networkGroupsGrid;
      fileName = 'network_groups';
      break;
    case 'services':
      currentGrid = servicesGrid;
      fileName = 'services';
      break;
    case 'service-groups':
      currentGrid = serviceGroupsGrid;
      fileName = 'service_groups';
      break;
  }
  
  if (!currentGrid) {
    alert('데이터가 없습니다.');
    return;
  }
  
  try {
    // Get filtered rows from grid
    const rowData = [];
    currentGrid.forEachNodeAfterFilter((node) => {
      rowData.push(node.data);
    });
    
    if (rowData.length === 0) {
      alert('내보낼 데이터가 없습니다.');
      return;
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    await api.exportToExcel(rowData, `${fileName}_${timestamp}`);
  } catch (error) {
    alert(`내보내기 실패: ${error.message}`);
  }
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

  // 엑셀 내보내기 버튼 이벤트
  const btnExport = document.getElementById('btn-export-objects-excel');
  if (btnExport) {
    btnExport.onclick = () => exportToExcel();
  }
}
