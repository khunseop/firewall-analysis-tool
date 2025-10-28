import { api } from '../api.js';

let deviceStatsGrid = null;

// 통계 데이터 가져오기
async function loadStatistics() {
  try {
    const devices = await api.listDevices();
    
    // 총 장비 수
    document.getElementById('stat-total-devices').textContent = devices.length;

    // 각 장비의 통계 데이터 수집
    let totalPolicies = 0;
    let totalNetworkObjects = 0;
    let totalServices = 0;

    const deviceStatsData = [];

    for (const device of devices) {
      try {
        // 정책 수 가져오기
        const policies = await api.searchPolicies({ device_ids: [device.id] });
        const policyCount = Array.isArray(policies) ? policies.length : 0;
        totalPolicies += policyCount;

        // 비활성화 정책 수 카운트
        const disabledPolicyCount = Array.isArray(policies) 
          ? policies.filter(p => p.enable === false).length 
          : 0;

        // 네트워크 객체 수 가져오기
        const networkObjects = await api.getNetworkObjects(device.id);
        const networkObjectCount = Array.isArray(networkObjects) ? networkObjects.length : 0;
        totalNetworkObjects += networkObjectCount;

        // 서비스 객체 수 가져오기
        const services = await api.getServices(device.id);
        const serviceCount = Array.isArray(services) ? services.length : 0;
        totalServices += serviceCount;

        // 장비별 통계 데이터 저장
        deviceStatsData.push({
          name: device.name,
          vendor: device.vendor,
          ip_address: device.ip_address,
          policies: policyCount,
          disabled_policies: disabledPolicyCount,
          network_objects: networkObjectCount,
          services: serviceCount
        });
      } catch (err) {
        console.error(`Failed to load stats for device ${device.id}:`, err);
        deviceStatsData.push({
          name: device.name,
          vendor: device.vendor,
          ip_address: device.ip_address,
          policies: 0,
          disabled_policies: 0,
          network_objects: 0,
          services: 0
        });
      }
    }

    // 통계 카드 업데이트
    document.getElementById('stat-total-policies').textContent = totalPolicies;
    document.getElementById('stat-network-objects').textContent = totalNetworkObjects;
    document.getElementById('stat-service-objects').textContent = totalServices;

    // 장비별 통계 그리드 업데이트
    if (deviceStatsGrid) {
      deviceStatsGrid.setGridOption('rowData', deviceStatsData);
    }
  } catch (err) {
    console.error('Failed to load statistics:', err);
    document.getElementById('stat-total-devices').textContent = '오류';
    document.getElementById('stat-total-policies').textContent = '오류';
    document.getElementById('stat-network-objects').textContent = '오류';
    document.getElementById('stat-service-objects').textContent = '오류';
  }
}

// 장비별 통계 그리드 초기화
function initDeviceStatsGrid() {
  const gridDiv = document.getElementById('device-stats-grid');
  if (!gridDiv) return;

  const columnDefs = [
    { field: 'name', headerName: '장비명', width: 180, filter: 'agTextColumnFilter' },
    { field: 'vendor', headerName: '벤더', width: 100, filter: 'agTextColumnFilter' },
    { field: 'ip_address', headerName: 'IP 주소', width: 140, filter: 'agTextColumnFilter' },
    { field: 'policies', headerName: '정책 수', width: 100, filter: 'agNumberColumnFilter' },
    { field: 'disabled_policies', headerName: '비활성화 정책', width: 130, filter: 'agNumberColumnFilter' },
    { field: 'network_objects', headerName: '네트워크 객체', width: 140, filter: 'agNumberColumnFilter' },
    { field: 'services', headerName: '서비스 객체', width: 130, filter: 'agNumberColumnFilter' }
  ];

  const gridOptions = {
    columnDefs: columnDefs,
    rowData: [],
    defaultColDef: {
      resizable: true,
      sortable: true,
      filter: true
    }
  };

  if (typeof agGrid !== 'undefined') {
    if (agGrid.createGrid) {
      deviceStatsGrid = agGrid.createGrid(gridDiv, gridOptions);
    } else {
      new agGrid.Grid(gridDiv, gridOptions);
      deviceStatsGrid = gridOptions.api;
    }
  }
}

// 대시보드 초기화
export async function initDashboard() {
  initDeviceStatsGrid();
  await loadStatistics();
}

