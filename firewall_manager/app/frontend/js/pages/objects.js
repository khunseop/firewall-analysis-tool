import { api } from '../api.js';

let networkObjectsGrid = null;
let networkGroupsGrid = null;
let servicesGrid = null;
let serviceGroupsGrid = null;

let currentTab = 'network-objects';

// 네트워크 객체 그리드 컬럼 정의
const networkObjectsColumns = [
  { field: 'device_name', headerName: '장비', width: 150, filter: 'agTextColumnFilter' },
  { field: 'name', headerName: '이름', width: 200, filter: 'agTextColumnFilter' },
  { field: 'ip_address', headerName: 'IP 주소', width: 200, filter: 'agTextColumnFilter' },
  { field: 'type', headerName: '타입', width: 120, filter: 'agTextColumnFilter' },
  { field: 'description', headerName: '설명', flex: 1, filter: 'agTextColumnFilter' }
];

// 네트워크 그룹 그리드 컬럼 정의
const networkGroupsColumns = [
  { field: 'device_name', headerName: '장비', width: 150, filter: 'agTextColumnFilter' },
  { field: 'name', headerName: '이름', width: 200, filter: 'agTextColumnFilter' },
  { field: 'members', headerName: '멤버', flex: 1, filter: 'agTextColumnFilter' },
  { field: 'description', headerName: '설명', width: 200, filter: 'agTextColumnFilter' }
];

// 서비스 객체 그리드 컬럼 정의
const servicesColumns = [
  { field: 'device_name', headerName: '장비', width: 150, filter: 'agTextColumnFilter' },
  { field: 'name', headerName: '이름', width: 200, filter: 'agTextColumnFilter' },
  { field: 'protocol', headerName: '프로토콜', width: 120, filter: 'agTextColumnFilter' },
  { field: 'port', headerName: '포트', width: 150, filter: 'agTextColumnFilter' },
  { field: 'description', headerName: '설명', flex: 1, filter: 'agTextColumnFilter' }
];

// 서비스 그룹 그리드 컬럼 정의
const serviceGroupsColumns = [
  { field: 'device_name', headerName: '장비', width: 150, filter: 'agTextColumnFilter' },
  { field: 'name', headerName: '이름', width: 200, filter: 'agTextColumnFilter' },
  { field: 'members', headerName: '멤버', flex: 1, filter: 'agTextColumnFilter' },
  { field: 'description', headerName: '설명', width: 200, filter: 'agTextColumnFilter' }
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

      // 첫 번째 장비 자동 선택
      if (allDevices.length > 0) {
        const firstDeviceId = allDevices[0].id.toString();
        select.tomselect.setValue([firstDeviceId], true); // silent=true로 설정하여 onChange 트리거 방지
        // 수동으로 loadData 호출
        await loadData([firstDeviceId]);
      }
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
    // 선택된 장비가 없으면 빈 데이터 표시
    if (networkObjectsGrid) networkObjectsGrid.setGridOption('rowData', []);
    if (networkGroupsGrid) networkGroupsGrid.setGridOption('rowData', []);
    if (servicesGrid) servicesGrid.setGridOption('rowData', []);
    if (serviceGroupsGrid) serviceGroupsGrid.setGridOption('rowData', []);
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
    if (currentTab === 'network-objects' && networkObjectsGrid) {
      networkObjectsGrid.setGridOption('rowData', mergedData);
    } else if (currentTab === 'network-groups' && networkGroupsGrid) {
      networkGroupsGrid.setGridOption('rowData', mergedData);
    } else if (currentTab === 'services' && servicesGrid) {
      servicesGrid.setGridOption('rowData', mergedData);
    } else if (currentTab === 'service-groups' && serviceGroupsGrid) {
      serviceGroupsGrid.setGridOption('rowData', mergedData);
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
  await loadDevices(); // Tom-select 초기화 및 데이터 로드 포함

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
