import { api } from '../api.js';
import { navigate } from '../router.js';
import { formatDateTime, formatNumber } from '../utils/date.js';
import { updateElementText, updateElements } from '../utils/dom.js';
import { showEmptyMessage, hideEmptyMessage } from '../utils/message.js';
import { createCommonGridOptions, createGridEventHandlers, adjustGridHeight } from '../utils/grid.js';

let deviceStatsGrid = null;
let currentDeviceStatsData = []; // 현재 장비 통계 데이터 (동기화 상태 요약 업데이트용)

// ==================== 유틸리티 함수 ====================


/**
 * 기본 에러 상태로 통계 카드 업데이트
 */
function setStatisticsError() {
  updateElements({
    'stat-total-devices': '오류',
    'stat-total-policies': '오류',
    'stat-network-objects': '오류',
    'stat-service-objects': '오류'
  });
}

// ==================== 통계 계산 함수 ====================

/**
 * 장비 통계 데이터를 API 응답 형식에서 그리드 형식으로 변환
 */
function transformDeviceStats(deviceStats) {
  return {
    id: deviceStats.id,
    name: deviceStats.name,
    vendor: deviceStats.vendor,
    ip_address: deviceStats.ip_address,
    policies: deviceStats.policies || 0,
    active_policies: deviceStats.active_policies || 0,
    disabled_policies: deviceStats.disabled_policies || 0,
    network_objects: deviceStats.network_objects || 0,
    services: deviceStats.services || 0,
    sync_status: deviceStats.sync_status || 'unknown',
    sync_step: deviceStats.sync_step || '',
    sync_time: deviceStats.sync_time || null
  };
}

// ==================== 통계 로드 함수 ====================

/**
 * 통계 데이터 가져오기 (새로운 집계 API 사용)
 */
async function loadStatistics() {
  // 로딩 상태 표시
  const loadingElements = ['stat-total-devices', 'stat-total-policies', 'stat-network-objects', 'stat-service-objects'];
  loadingElements.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '...';
  });

  try {
    // 새로운 집계 API 사용 (한 번의 호출로 모든 통계 조회)
    const stats = await api.getDashboardStats();

    // 통계 카드 업데이트 (숫자 포맷 적용)
    updateElements({
      'stat-total-devices': formatNumber(stats.total_devices),
      'stat-total-policies': formatNumber(stats.total_policies),
      'stat-network-objects': formatNumber(stats.total_network_objects),
      'stat-service-objects': formatNumber(stats.total_services)
    });

    // 활성 장비 수 표시
    const activeDevicesTextEl = document.getElementById('stat-active-devices-text');
    if (activeDevicesTextEl) {
      activeDevicesTextEl.textContent = `활성: ${formatNumber(stats.active_devices)}`;
    }

    // 정책 통계 서브타이틀 업데이트
    const activePoliciesTextEl = document.getElementById('stat-active-policies-text');
    const disabledPoliciesTextEl = document.getElementById('stat-disabled-policies-text');
    if (activePoliciesTextEl) {
      activePoliciesTextEl.textContent = `활성: ${formatNumber(stats.total_active_policies)}`;
    }
    if (disabledPoliciesTextEl) {
      disabledPoliciesTextEl.textContent = `비활성: ${formatNumber(stats.total_disabled_policies)}`;
    }

    // 장비별 통계 데이터 변환
    const deviceStatsData = stats.device_stats.map(transformDeviceStats);

    // 장비별 통계 그리드 업데이트
    const messageContainer = document.getElementById('device-stats-message-container');
    const gridDiv = document.getElementById('device-stats-grid');
    
    if (deviceStatsData.length === 0) {
      // 장비가 없으면 메시지 표시
      showEmptyMessage(messageContainer, '장비를 추가하세요', 'fa-plus-circle');
      if (gridDiv) gridDiv.style.display = 'none';
    } else {
      // 장비가 있으면 메시지 숨기고 그리드 표시
      hideEmptyMessage(messageContainer);
      if (gridDiv) gridDiv.style.display = 'block';
      
      if (deviceStatsGrid) {
        deviceStatsGrid.setGridOption('rowData', deviceStatsData);
        // 높이 조절
        setTimeout(() => {
          if (gridDiv) {
            adjustGridHeight(gridDiv);
          }
        }, 200);
      }
    }

    // 전역 변수에 저장 (WebSocket 업데이트용)
    currentDeviceStatsData = deviceStatsData;

    // 동기화 상태 요약 업데이트
    updateSyncStatusSummary(deviceStatsData);

    // 벤더별 통계 업데이트
    updateVendorStats(deviceStatsData);
  } catch (err) {
    console.error('Failed to load statistics:', err);
    setStatisticsError();
  }
}

// ==================== 동기화 상태 관련 함수 ====================

let dashboardWebSocket = null;

/**
 * 동기화 상태에 따른 색상 반환
 */
function getSyncStatusColor(status) {
  const statusMap = {
    pending: 'is-warning',
    success: 'is-success',
    in_progress: 'is-info',
    failure: 'is-danger',
    error: 'is-danger'
  };
  return statusMap[status] || 'is-light';
}

/**
 * 동기화 상태에 따른 텍스트 반환
 */
function getSyncStatusText(status) {
  const statusMap = {
    pending: '대기중',
    success: '성공',
    in_progress: '진행중',
    failure: '실패',
    error: '오류'
  };
  return statusMap[status] || '알 수 없음';
}

/**
 * 동기화 상태 요약 업데이트 (개선된 카드 스타일)
 */
function updateSyncStatusSummary(deviceStatsData) {
  const container = document.getElementById('sync-status-summary');
  if (!container) return;

  if (deviceStatsData.length === 0) {
    container.innerHTML = '<div class="has-text-centered py-4"><p class="has-text-grey">등록된 장비가 없습니다.</p></div>';
    return;
  }

  // 상태별 통계 계산
  const statusCounts = deviceStatsData.reduce((acc, device) => {
    const status = device.sync_status || 'unknown';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});

  const statusConfig = {
    'success': { 
      label: '성공', 
      icon: 'fa-check-circle',
      class: 'success'
    },
    'in_progress': { 
      label: '진행중', 
      icon: 'fa-sync-alt fa-spin',
      class: 'in_progress'
    },
    'pending': { 
      label: '대기중', 
      icon: 'fa-clock',
      class: 'pending'
    },
    'failure': { 
      label: '실패', 
      icon: 'fa-exclamation-circle',
      class: 'failure'
    },
    'error': { 
      label: '오류', 
      icon: 'fa-times-circle',
      class: 'error'
    },
    'unknown': { 
      label: '알 수 없음', 
      icon: 'fa-question-circle',
      class: 'pending'
    }
  };

  const statusHtml = Object.entries(statusCounts)
    .map(([status, count]) => {
      const config = statusConfig[status] || statusConfig['unknown'];
      return `
        <div class="column is-4">
          <div class="sync-status-card ${config.class}">
            <div class="sync-status-icon">
              <i class="fas ${config.icon}"></i>
            </div>
            <div class="sync-status-label">${config.label}</div>
            <div class="sync-status-value">${formatNumber(count)}</div>
          </div>
        </div>
      `;
    })
    .join('');

  container.innerHTML = `
    <div class="columns is-multiline">
      ${statusHtml}
    </div>
    <div class="mt-4 has-text-centered">
      <p class="is-size-7 has-text-grey">
        총 ${formatNumber(deviceStatsData.length)}개 장비
      </p>
    </div>
  `;
}

/**
 * 벤더별 통계 업데이트
 * 
 * ApexCharts 사용 예제 (로컬 파일 추가 후 활성화):
 * 
 * if (typeof ApexCharts !== 'undefined') {
 *   // ApexCharts로 파이 차트 또는 바 차트 생성
 *   const chart = new ApexCharts(document.querySelector("#vendor-chart"), {
 *     series: vendorList.map(v => v.deviceCount),
 *     chart: { type: 'donut', height: 300 },
 *     labels: vendorList.map(v => vendorLabelMap[v.vendor] || v.vendor),
 *     // ... 기타 옵션
 *   });
 *   chart.render();
 * }
 */
function updateVendorStats(deviceStatsData) {
  const container = document.getElementById('vendor-stats-container');
  if (!container) return;

  if (deviceStatsData.length === 0) {
    container.innerHTML = '<div class="has-text-centered py-4"><p class="has-text-grey">장비 데이터가 없습니다.</p></div>';
    return;
  }

  // 벤더별 통계 집계
  const vendorStats = deviceStatsData.reduce((acc, device) => {
    const vendor = device.vendor || 'Unknown';
    if (!acc[vendor]) {
      acc[vendor] = {
        vendor: vendor,
        deviceCount: 0,
        totalPolicies: 0,
        totalActivePolicies: 0,
        totalNetworkObjects: 0,
        totalServices: 0
      };
    }
    acc[vendor].deviceCount += 1;
    acc[vendor].totalPolicies += device.policies || 0;
    acc[vendor].totalActivePolicies += device.active_policies || 0;
    acc[vendor].totalNetworkObjects += device.network_objects || 0;
    acc[vendor].totalServices += device.services || 0;
    return acc;
  }, {});

  const vendorList = Object.values(vendorStats).sort((a, b) => b.deviceCount - a.deviceCount);

  const vendorLabelMap = {
    'paloalto': 'Palo Alto',
    'ngf': 'SECUI NGF',
    'mf2': 'SECUI MF2',
    'mock': 'Mock'
  };

  const vendorHtml = vendorList.map(vendor => {
    const vendorLabel = vendorLabelMap[vendor.vendor.toLowerCase()] || vendor.vendor;

    return `
      <div class="vendor-stat-card mb-3">
        <div class="level mb-2">
          <div class="level-left">
            <div>
              <strong class="is-size-5">${vendorLabel}</strong>
              <p class="is-size-7 has-text-grey mt-1">${formatNumber(vendor.deviceCount)}개 장비</p>
            </div>
          </div>
        </div>
        <div class="columns is-multiline">
          <div class="column is-6">
            <div class="vendor-stat-item">
              <span class="vendor-stat-label">정책</span>
              <span class="vendor-stat-value">${formatNumber(vendor.totalPolicies)}</span>
            </div>
          </div>
          <div class="column is-6">
            <div class="vendor-stat-item">
              <span class="vendor-stat-label">활성 정책</span>
              <span class="vendor-stat-value">${formatNumber(vendor.totalActivePolicies)}</span>
            </div>
          </div>
          <div class="column is-6">
            <div class="vendor-stat-item">
              <span class="vendor-stat-label">네트워크 객체</span>
              <span class="vendor-stat-value">${formatNumber(vendor.totalNetworkObjects)}</span>
            </div>
          </div>
          <div class="column is-6">
            <div class="vendor-stat-item">
              <span class="vendor-stat-label">서비스 객체</span>
              <span class="vendor-stat-value">${formatNumber(vendor.totalServices)}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = vendorHtml;
}


// ==================== 그리드 초기화 함수 ====================

/**
 * 장비별 통계 그리드 초기화
 */
function initDeviceStatsGrid() {
  const gridDiv = document.getElementById('device-stats-grid');
  if (!gridDiv) return;

  const columnDefs = [
    { field: 'name', headerName: '장비명', filter: 'agTextColumnFilter', width: 150 },
    { field: 'vendor', headerName: '벤더', filter: 'agTextColumnFilter', width: 100 },
    { field: 'ip_address', headerName: 'IP 주소', filter: 'agTextColumnFilter', width: 130 },
    { 
      field: 'policies', 
      headerName: '정책 수', 
      filter: 'agNumberColumnFilter', 
      width: 100,
      valueFormatter: (params) => formatNumber(params.value)
    },
    { 
      field: 'active_policies', 
      headerName: '활성 정책', 
      filter: 'agNumberColumnFilter', 
      width: 100,
      valueFormatter: (params) => formatNumber(params.value)
    },
    { 
      field: 'disabled_policies', 
      headerName: '비활성 정책', 
      filter: 'agNumberColumnFilter', 
      width: 120,
      valueFormatter: (params) => formatNumber(params.value)
    },
    { 
      field: 'network_objects', 
      headerName: '네트워크 객체', 
      filter: 'agNumberColumnFilter', 
      width: 130,
      valueFormatter: (params) => formatNumber(params.value)
    },
    { 
      field: 'services', 
      headerName: '서비스 객체', 
      filter: 'agNumberColumnFilter', 
      width: 130,
      valueFormatter: (params) => formatNumber(params.value)
    },
    { 
      field: 'sync_status', 
      headerName: '동기화 상태', 
      filter: 'agTextColumnFilter',
      width: 120,
      headerClass: 'text-left',
      cellStyle: { display: 'flex', alignItems: 'center', justifyContent: 'center' },
      cellRenderer: (params) => {
        const status = params.value || 'unknown';
        const step = params.data?.sync_step || '';
        
        // 상태별 색상 및 스타일
        const statusConfig = {
          'success': { color: '#48c774', class: 'sync-status-success' },
          'in_progress': { color: '#3273dc', class: 'sync-status-progress' },
          'pending': { color: '#ff9800', class: 'sync-status-pending' },
          'failure': { color: '#f14668', class: 'sync-status-failure' },
          'error': { color: '#f14668', class: 'sync-status-failure' }
        };
        
        const config = statusConfig[status] || { color: '#95a5a6', class: 'sync-status-unknown' };
        const statusText = getSyncStatusText(status);
        const tooltipText = step ? `${statusText}: ${step}` : statusText;
        
        // 진행중일 때 점멸 효과
        const blinkStyle = status === 'in_progress' ? 'animation: blink 1s ease-in-out infinite;' : '';
        
        return `
          <div style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; padding: 0;" title="${tooltipText}">
            <span 
              class="${config.class}" 
              style="
                display: block;
                width: 12px;
                height: 12px;
                border-radius: 50%;
                background-color: ${config.color};
                flex-shrink: 0;
                ${blinkStyle}
              "
            ></span>
          </div>
        `;
      }
    }
  ];

  const commonOptions = createCommonGridOptions({
    paginationPageSizeSelector: [25, 50, 100, 200],
    autoSizeStrategy: { type: 'fitGridWidth', defaultMinWidth: 80, defaultMaxWidth: 500 },
    animateRows: true,
    suppressRowHoverHighlight: false
  });
  
  const handlers = createGridEventHandlers(gridDiv, null);
  
  const gridOptions = {
    ...commonOptions,
    columnDefs: columnDefs,
    rowData: [],
    defaultColDef: {
      ...commonOptions.defaultColDef,
      sortable: true
    },
    getRowId: (params) => String(params.data.id),
    onGridReady: (params) => {
      deviceStatsGrid = params.api;
      const updatedHandlers = createGridEventHandlers(gridDiv, params.api);
      Object.assign(gridOptions, updatedHandlers);
    },
    ...handlers
  };

  if (typeof agGrid !== 'undefined') {
    if (agGrid.createGrid) {
      deviceStatsGrid = agGrid.createGrid(gridDiv, gridOptions);
    } else {
      new agGrid.Grid(gridDiv, gridOptions);
      deviceStatsGrid = gridOptions.api;
    }
  }
  
  // 초기 높이 조절
  setTimeout(() => {
    adjustGridHeight(gridDiv);
  }, 200);
}

// ==================== 이벤트 리스너 설정 ====================

/**
 * 이벤트 리스너 설정
 */
function setupEventListeners() {
  const refreshSyncStatusBtn = document.getElementById('refresh-sync-status');
  if (refreshSyncStatusBtn) {
    refreshSyncStatusBtn.addEventListener('click', loadStatistics);
  }
}

// ==================== 전역 함수 (HTML에서 호출) ====================

// ==================== WebSocket 관련 함수 ====================

/**
 * WebSocket 연결 시작
 */
function connectDashboardWebSocket() {
  if (dashboardWebSocket && dashboardWebSocket.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/api/v1/ws/sync-status`;

  return new Promise((resolve, reject) => {
    try {
      dashboardWebSocket = new WebSocket(wsUrl);

      dashboardWebSocket.onopen = () => {
        console.log('대시보드 WebSocket 연결됨');
        resolve();
      };

    dashboardWebSocket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'device_sync_status') {
          // 그리드 즉시 업데이트 (실시간 반영)
          if (deviceStatsGrid) {
            const rowNode = deviceStatsGrid.getRowNode(String(message.device_id));
            if (rowNode && rowNode.data) {
              // 그리드에 행이 있으면 즉시 업데이트
              const updatedData = {
                ...rowNode.data,
                sync_status: message.status,
                sync_step: message.step || null  // sync_step은 collectDeviceStats에서 last_sync_step을 매핑한 필드
              };
              
              // 완료 상태일 때 타임스탬프 업데이트
              if (message.status === 'success' || message.status === 'failure') {
                updatedData.sync_time = new Date().toISOString();
              }
              
              try {
                rowNode.setData(updatedData);
              } catch (e) {
                // setData가 실패하면 applyTransaction 사용
                console.warn(`대시보드 그리드 업데이트 실패, 대체 방법 사용:`, e);
                deviceStatsGrid.applyTransaction({ update: [updatedData] });
                
                // 셀 강제 새로고침
                try {
                  if (deviceStatsGrid.refreshCells) {
                    deviceStatsGrid.refreshCells({ 
                      rowNodes: [rowNode],
                      columns: ['sync_status'],
                      force: true 
                    });
                  } else if (deviceStatsGrid.redrawRows) {
                    deviceStatsGrid.redrawRows({ rowNodes: [rowNode] });
                  }
                } catch (refreshError) {
                  console.warn(`대시보드 셀 새로고침 실패:`, refreshError);
                }
              }
              
              // 동기화 상태 요약 및 벤더별 통계도 업데이트
              const deviceIndex = currentDeviceStatsData.findIndex(d => d.id === message.device_id);
              if (deviceIndex !== -1) {
                currentDeviceStatsData[deviceIndex] = updatedData;
                updateSyncStatusSummary(currentDeviceStatsData);
                updateVendorStats(currentDeviceStatsData);
              }
            } else {
              // 그리드에 행이 없으면 전체 데이터 다시 로드 (초기 로드 전에 메시지가 온 경우)
              loadStatistics();
              return; // loadStatistics()가 완료되면 자동으로 업데이트됨
            }
          }
          
          // 완료 상태일 때만 전체 통계 다시 로드 (통계 수치 업데이트)
          // 진행 중일 때는 그리드 업데이트만으로 충분
          if (message.status === 'success' || message.status === 'failure') {
            // 전체 통계 다시 로드 (벤더별 통계도 함께 업데이트됨)
            loadStatistics();
          } else {
            // 진행 중일 때는 벤더별 통계만 업데이트
            const deviceIndex = currentDeviceStatsData.findIndex(d => d.id === message.device_id);
            if (deviceIndex !== -1) {
              updateVendorStats(currentDeviceStatsData);
            }
          }
        }
      } catch (e) {
        console.error('WebSocket 메시지 파싱 실패:', e);
      }
    };

      dashboardWebSocket.onerror = (error) => {
        console.error('대시보드 WebSocket 오류:', error);
        // 연결 실패 시에만 reject (이미 연결된 경우는 무시)
        if (dashboardWebSocket.readyState !== WebSocket.OPEN) {
          reject(error);
        }
      };

      dashboardWebSocket.onclose = () => {
        console.log('대시보드 WebSocket 연결 종료됨. 3초 후 재연결 시도...');
        // 재연결은 백그라운드에서 진행 (Promise와 무관)
        setTimeout(() => {
          if (dashboardWebSocket && dashboardWebSocket.readyState === WebSocket.CLOSED) {
            connectDashboardWebSocket().catch(() => {
              // 재연결 실패는 무시 (백그라운드 작업)
            });
          }
        }, 3000);
      };
    } catch (e) {
      console.error('대시보드 WebSocket 연결 실패:', e);
      reject(e);
    }
  });
}

/**
 * WebSocket 연결 종료
 */
function disconnectDashboardWebSocket() {
  if (dashboardWebSocket) {
    dashboardWebSocket.close();
    dashboardWebSocket = null;
  }
}

// ==================== 대시보드 초기화 ====================

/**
 * 대시보드 초기화
 */
export async function initDashboard() {
  initDeviceStatsGrid();
  setupEventListeners();
  
  // WebSocket 연결 후 초기 데이터 로드 (연결 완료를 기다림)
  try {
    await connectDashboardWebSocket();
  } catch (e) {
    console.warn('WebSocket 연결 실패, 폴링 모드로 진행:', e);
  }
  
  await loadStatistics();
}

/**
 * 대시보드 정리
 */
export function cleanupDashboard() {
  disconnectDashboardWebSocket();
}

