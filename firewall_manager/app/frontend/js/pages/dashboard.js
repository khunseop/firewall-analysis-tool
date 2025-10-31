import { api } from '../api.js';

let deviceStatsGrid = null;

// 통계 데이터 가져오기
async function loadStatistics() {
  try {
    const devices = await api.listDevices();
    
    // 총 장비 수
    const statTotalDevices = document.getElementById('stat-total-devices');
    if (statTotalDevices) statTotalDevices.textContent = devices.length;

    // 각 장비의 통계 데이터 수집
    let totalPolicies = 0;
    let totalDisabledPolicies = 0;
    let totalNetworkObjects = 0;
    let totalServices = 0;

    const deviceStatsData = [];

    for (const device of devices) {
      try {
        // 정책 수 가져오기 (카운트 API 사용)
        const policyCounts = await api.getPolicyCount(device.id);
        const policyCount = policyCounts.total || 0;
        const disabledPolicyCount = policyCounts.disabled || 0;
        
        totalPolicies += policyCount;
        totalDisabledPolicies += disabledPolicyCount;

        // 객체 수 가져오기 (카운트 API 사용)
        const objectCounts = await api.getObjectCount(device.id);
        const networkObjectCount = objectCounts.network_objects || 0;
        const serviceCount = objectCounts.services || 0;
        
        totalNetworkObjects += networkObjectCount;
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
    const statTotalPolicies = document.getElementById('stat-total-policies');
    const statDisabledPolicies = document.getElementById('stat-disabled-policies');
    const statNetworkObjects = document.getElementById('stat-network-objects');
    const statServiceObjects = document.getElementById('stat-service-objects');
    
    if (statTotalPolicies) statTotalPolicies.textContent = totalPolicies;
    if (statDisabledPolicies) statDisabledPolicies.textContent = totalDisabledPolicies;
    if (statNetworkObjects) statNetworkObjects.textContent = totalNetworkObjects;
    if (statServiceObjects) statServiceObjects.textContent = totalServices;

    // 장비별 통계 그리드 업데이트
    if (deviceStatsGrid) {
      deviceStatsGrid.setGridOption('rowData', deviceStatsData);
    }
  } catch (err) {
    console.error('Failed to load statistics:', err);
    const statTotalDevices = document.getElementById('stat-total-devices');
    const statTotalPolicies = document.getElementById('stat-total-policies');
    const statNetworkObjects = document.getElementById('stat-network-objects');
    const statServiceObjects = document.getElementById('stat-service-objects');
    
    if (statTotalDevices) statTotalDevices.textContent = '오류';
    if (statTotalPolicies) statTotalPolicies.textContent = '오류';
    if (statNetworkObjects) statNetworkObjects.textContent = '오류';
    if (statServiceObjects) statServiceObjects.textContent = '오류';
  }
}

// 장비별 통계 그리드 초기화
function initDeviceStatsGrid() {
  const gridDiv = document.getElementById('device-stats-grid');
  if (!gridDiv) return;

  const columnDefs = [
    { field: 'name', headerName: '장비명', filter: 'agTextColumnFilter' },
    { field: 'vendor', headerName: '벤더', filter: 'agTextColumnFilter' },
    { field: 'ip_address', headerName: 'IP 주소', filter: 'agTextColumnFilter' },
    { field: 'policies', headerName: '정책 수', filter: 'agNumberColumnFilter' },
    { field: 'disabled_policies', headerName: '비활성화 정책', filter: 'agNumberColumnFilter' },
    { field: 'network_objects', headerName: '네트워크 객체', filter: 'agNumberColumnFilter' },
    { field: 'services', headerName: '서비스 객체', filter: 'agNumberColumnFilter' }
  ];

  const gridOptions = {
    columnDefs: columnDefs,
    rowData: [],
    defaultColDef: {
      resizable: false,
      sortable: true,
      filter: true
    },
    autoSizeStrategy: { type: 'fitGridWidth', defaultMinWidth: 80, defaultMaxWidth: 500 },
    enableCellTextSelection: true
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

