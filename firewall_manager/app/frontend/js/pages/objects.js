import { api } from '../api.js';

let networkObjectsGrid = null;
let networkGroupsGrid = null;
let servicesGrid = null;
let serviceGroupsGrid = null;

let currentTab = 'network-objects';

// 네트워크 객체 그리드 컬럼 정의
const networkObjectsColumns = [
  { field: 'id', headerName: 'ID', width: 80, filter: 'agNumberColumnFilter' },
  { field: 'name', headerName: '이름', width: 200, filter: 'agTextColumnFilter' },
  { field: 'ip_address', headerName: 'IP 주소', width: 200, filter: 'agTextColumnFilter' },
  { field: 'type', headerName: '타입', width: 120, filter: 'agTextColumnFilter' },
  { field: 'description', headerName: '설명', flex: 1, filter: 'agTextColumnFilter' },
  { 
    field: 'is_active', 
    headerName: '활성', 
    width: 100,
    cellRenderer: (params) => params.value ? '✓' : '✗'
  },
  { 
    field: 'last_seen_at', 
    headerName: '마지막 확인', 
    width: 180,
    valueFormatter: (params) => params.value ? new Date(params.value).toLocaleString('ko-KR') : ''
  }
];

// 네트워크 그룹 그리드 컬럼 정의
const networkGroupsColumns = [
  { field: 'id', headerName: 'ID', width: 80, filter: 'agNumberColumnFilter' },
  { field: 'name', headerName: '이름', width: 200, filter: 'agTextColumnFilter' },
  { field: 'members', headerName: '멤버', flex: 1, filter: 'agTextColumnFilter' },
  { field: 'description', headerName: '설명', width: 200, filter: 'agTextColumnFilter' },
  { 
    field: 'is_active', 
    headerName: '활성', 
    width: 100,
    cellRenderer: (params) => params.value ? '✓' : '✗'
  },
  { 
    field: 'last_seen_at', 
    headerName: '마지막 확인', 
    width: 180,
    valueFormatter: (params) => params.value ? new Date(params.value).toLocaleString('ko-KR') : ''
  }
];

// 서비스 객체 그리드 컬럼 정의
const servicesColumns = [
  { field: 'id', headerName: 'ID', width: 80, filter: 'agNumberColumnFilter' },
  { field: 'name', headerName: '이름', width: 200, filter: 'agTextColumnFilter' },
  { field: 'protocol', headerName: '프로토콜', width: 120, filter: 'agTextColumnFilter' },
  { field: 'port', headerName: '포트', width: 150, filter: 'agTextColumnFilter' },
  { field: 'description', headerName: '설명', flex: 1, filter: 'agTextColumnFilter' },
  { 
    field: 'is_active', 
    headerName: '활성', 
    width: 100,
    cellRenderer: (params) => params.value ? '✓' : '✗'
  },
  { 
    field: 'last_seen_at', 
    headerName: '마지막 확인', 
    width: 180,
    valueFormatter: (params) => params.value ? new Date(params.value).toLocaleString('ko-KR') : ''
  }
];

// 서비스 그룹 그리드 컬럼 정의
const serviceGroupsColumns = [
  { field: 'id', headerName: 'ID', width: 80, filter: 'agNumberColumnFilter' },
  { field: 'name', headerName: '이름', width: 200, filter: 'agTextColumnFilter' },
  { field: 'members', headerName: '멤버', flex: 1, filter: 'agTextColumnFilter' },
  { field: 'description', headerName: '설명', width: 200, filter: 'agTextColumnFilter' },
  { 
    field: 'is_active', 
    headerName: '활성', 
    width: 100,
    cellRenderer: (params) => params.value ? '✓' : '✗'
  },
  { 
    field: 'last_seen_at', 
    headerName: '마지막 확인', 
    width: 180,
    valueFormatter: (params) => params.value ? new Date(params.value).toLocaleString('ko-KR') : ''
  }
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

  // 네트워크 객체 그리드
  const networkObjectsEl = document.getElementById('network-objects-grid');
  if (networkObjectsEl) {
    networkObjectsGrid = agGrid.createGrid(networkObjectsEl, {
      columnDefs: networkObjectsColumns,
      defaultColDef: {
        sortable: true,
        resizable: true,
        filter: true,
      },
      pagination: true,
      paginationPageSize: 50,
      paginationPageSizeSelector: [50, 100, 200],
      rowSelection: 'multiple',
    });
  }

  // 네트워크 그룹 그리드
  const networkGroupsEl = document.getElementById('network-groups-grid');
  if (networkGroupsEl) {
    networkGroupsGrid = agGrid.createGrid(networkGroupsEl, {
      columnDefs: networkGroupsColumns,
      defaultColDef: {
        sortable: true,
        resizable: true,
        filter: true,
      },
      pagination: true,
      paginationPageSize: 50,
      paginationPageSizeSelector: [50, 100, 200],
      rowSelection: 'multiple',
    });
  }

  // 서비스 객체 그리드
  const servicesEl = document.getElementById('services-grid');
  if (servicesEl) {
    servicesGrid = agGrid.createGrid(servicesEl, {
      columnDefs: servicesColumns,
      defaultColDef: {
        sortable: true,
        resizable: true,
        filter: true,
      },
      pagination: true,
      paginationPageSize: 50,
      paginationPageSizeSelector: [50, 100, 200],
      rowSelection: 'multiple',
    });
  }

  // 서비스 그룹 그리드
  const serviceGroupsEl = document.getElementById('service-groups-grid');
  if (serviceGroupsEl) {
    serviceGroupsGrid = agGrid.createGrid(serviceGroupsEl, {
      columnDefs: serviceGroupsColumns,
      defaultColDef: {
        sortable: true,
        resizable: true,
        filter: true,
      },
      pagination: true,
      paginationPageSize: 50,
      paginationPageSizeSelector: [50, 100, 200],
      rowSelection: 'multiple',
    });
  }
}

// 장비 목록 로드
async function loadDevices() {
  try {
    const devices = await api.listDevices();
    const select = document.getElementById('object-device-select');
    if (!select) return;

    select.innerHTML = '<option value="">장비를 선택하세요</option>';
    devices.forEach(dev => {
      const opt = document.createElement('option');
      opt.value = dev.id;
      opt.textContent = `${dev.name} (${dev.ip_address})`;
      select.appendChild(opt);
    });
  } catch (err) {
    console.error('Failed to load devices:', err);
  }
}

// 데이터 로드
async function loadData(deviceId) {
  if (!deviceId) return;

  try {
    if (currentTab === 'network-objects') {
      const data = await api.getNetworkObjects(deviceId);
      if (networkObjectsGrid) {
        networkObjectsGrid.setGridOption('rowData', data);
      }
    } else if (currentTab === 'network-groups') {
      const data = await api.getNetworkGroups(deviceId);
      if (networkGroupsGrid) {
        networkGroupsGrid.setGridOption('rowData', data);
      }
    } else if (currentTab === 'services') {
      const data = await api.getServices(deviceId);
      if (servicesGrid) {
        servicesGrid.setGridOption('rowData', data);
      }
    } else if (currentTab === 'service-groups') {
      const data = await api.getServiceGroups(deviceId);
      if (serviceGroupsGrid) {
        serviceGroupsGrid.setGridOption('rowData', data);
      }
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

  // 현재 선택된 장비로 데이터 로드
  const select = document.getElementById('object-device-select');
  if (select && select.value) {
    loadData(select.value);
  }
}

// 초기화
export async function initObjects() {
  await initGrids();
  await loadDevices();

  // 탭 클릭 이벤트
  document.querySelectorAll('.tabs li').forEach(li => {
    li.addEventListener('click', () => {
      const tabName = li.dataset.tab;
      if (tabName) {
        switchTab(tabName);
      }
    });
  });

  // 장비 선택 변경 이벤트
  const select = document.getElementById('object-device-select');
  if (select) {
    select.addEventListener('change', (e) => {
      loadData(e.target.value);
    });
  }

  // 첫 번째 장비 자동 선택
  if (select && select.options.length > 1) {
    select.selectedIndex = 1;
    loadData(select.value);
  }
}
