import { api } from '../api.js';
import { navigate } from '../router.js';
import { formatDateTime } from '../utils/date.js';
import { updateElementText, updateElements } from '../utils/dom.js';
import { showEmptyMessage, hideEmptyMessage } from '../utils/message.js';

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
 * 장비의 통계 데이터를 수집
 */
async function collectDeviceStats(device) {
  try {
    const [policyCounts, objectCounts, syncStatusData] = await Promise.allSettled([
      api.getPolicyCount(device.id),
      api.getObjectCount(device.id),
      api.syncStatus(device.id).catch(() => null)
    ]);

    const policyCount = policyCounts.status === 'fulfilled' ? policyCounts.value : {};
    const objectCount = objectCounts.status === 'fulfilled' ? objectCounts.value : {};
    const syncData = syncStatusData.status === 'fulfilled' ? syncStatusData.value : null;

    return {
      id: device.id,
      name: device.name,
      vendor: device.vendor,
      ip_address: device.ip_address,
      policies: policyCount.total || 0,
      active_policies: policyCount.active || 0,
      disabled_policies: policyCount.disabled || 0,
      network_objects: objectCount.network_objects || 0,
      services: objectCount.services || 0,
      sync_status: syncData?.last_sync_status || 'unknown',
      sync_step: syncData?.last_sync_step || '',
      sync_time: syncData?.last_sync_at || null
    };
  } catch (err) {
    console.error(`Failed to load stats for device ${device.id}:`, err);
    return {
      id: device.id,
      name: device.name,
      vendor: device.vendor,
      ip_address: device.ip_address,
      policies: 0,
      active_policies: 0,
      disabled_policies: 0,
      network_objects: 0,
      services: 0,
      sync_status: 'error',
      sync_step: '',
      sync_time: null
    };
  }
}

/**
 * 전체 통계를 집계
 */
function aggregateStatistics(deviceStatsData) {
  return deviceStatsData.reduce((acc, device) => ({
    totalPolicies: acc.totalPolicies + device.policies,
    totalActivePolicies: acc.totalActivePolicies + device.active_policies,
    totalDisabledPolicies: acc.totalDisabledPolicies + device.disabled_policies,
    totalNetworkObjects: acc.totalNetworkObjects + device.network_objects,
    totalServices: acc.totalServices + device.services
  }), {
    totalPolicies: 0,
    totalActivePolicies: 0,
    totalDisabledPolicies: 0,
    totalNetworkObjects: 0,
    totalServices: 0
  });
}

// ==================== 통계 로드 함수 ====================

/**
 * 통계 데이터 가져오기
 */
async function loadStatistics() {
  try {
    const devices = await api.listDevices();
    
    // 총 장비 수 및 활성 장비 수 업데이트
    updateElementText('stat-total-devices', devices.length);
    const activeDevices = devices.filter(d => d.last_sync_status === 'success').length;
    updateElementText('stat-active-devices', `활성: ${activeDevices}`);

    // 각 장비의 통계 데이터 수집 (병렬 처리)
    const deviceStatsData = await Promise.all(
      devices.map(device => collectDeviceStats(device))
    );

    // 전체 통계 집계
    const totals = aggregateStatistics(deviceStatsData);

    // 통계 카드 업데이트
    updateElements({
      'stat-total-policies': totals.totalPolicies,
      'stat-active-policies': totals.totalActivePolicies,
      'stat-disabled-policies': totals.totalDisabledPolicies,
      'stat-network-objects': totals.totalNetworkObjects,
      'stat-service-objects': totals.totalServices
    });

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
      }
    }

    // 전역 변수에 저장 (WebSocket 업데이트용)
    currentDeviceStatsData = deviceStatsData;

    // 동기화 상태 요약 업데이트
    updateSyncStatusSummary(deviceStatsData);
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
 * 동기화 상태 카드 HTML 생성
 */
function createSyncStatusCard(device) {
  const statusColor = getSyncStatusColor(device.sync_status);
  const statusText = getSyncStatusText(device.sync_status);
  const syncTimeText = formatDateTime(device.sync_time);

  return `
    <div class="column is-3">
      <div class="box sync-status-card">
        <div class="level mb-2">
          <div class="level-left">
            <strong>${device.name}</strong>
          </div>
          <div class="level-right">
            <span class="tag ${statusColor}">${statusText}</span>
          </div>
        </div>
        <div class="content is-small">
          <p class="mb-1"><strong>벤더:</strong> ${device.vendor}</p>
          <p class="mb-1"><strong>IP:</strong> ${device.ip_address}</p>
          <p class="mb-1"><strong>마지막 동기화:</strong> ${syncTimeText}</p>
          ${device.sync_step ? `<p class="mb-1"><strong>단계:</strong> ${device.sync_step}</p>` : ''}
        </div>
      </div>
    </div>
  `;
}

/**
 * 동기화 상태 요약 업데이트
 */
function updateSyncStatusSummary(deviceStatsData) {
  const container = document.getElementById('sync-status-summary');
  if (!container) return;

  if (deviceStatsData.length === 0) {
    container.innerHTML = '<div class="column"><p class="has-text-grey">등록된 장비가 없습니다.</p></div>';
    return;
  }

  container.innerHTML = deviceStatsData
    .map(device => createSyncStatusCard(device))
    .join('');
}

// ==================== 분석 결과 관련 함수 ====================

/**
 * 분석 결과가 있는 경우의 카드 HTML 생성
 */
function createAnalysisResultCard(device, result) {
  const resultData = result.result_data;
  const upperPolicies = resultData.filter(r => r.type === 'UPPER');
  const lowerPolicies = resultData.filter(r => r.type === 'LOWER');
  const duplicateSets = upperPolicies.length;
  const totalAffected = resultData.length;
  const analysisTime = formatDateTime(result.created_at);

  return `
    <div class="box analysis-result-card mb-3">
      <div class="level mb-3">
        <div class="level-left">
          <div>
            <strong class="is-size-5">${device.name}</strong>
            <p class="is-size-7 has-text-grey mt-1">${device.vendor} | ${device.ip_address}</p>
          </div>
        </div>
        <div class="level-right">
          <button class="button is-small is-primary" onclick="viewAnalysisDetails(${device.id})">
            <span>상세 보기</span>
          </button>
        </div>
      </div>
      <div class="columns is-multiline">
        <div class="column is-3">
          <div class="has-text-centered">
            <p class="heading">중복 세트</p>
            <p class="title is-4 has-text-danger">${duplicateSets}</p>
          </div>
        </div>
        <div class="column is-3">
          <div class="has-text-centered">
            <p class="heading">영향받는 정책</p>
            <p class="title is-4">${totalAffected}</p>
          </div>
        </div>
        <div class="column is-3">
          <div class="has-text-centered">
            <p class="heading">상위 정책</p>
            <p class="title is-4">${upperPolicies.length}</p>
          </div>
        </div>
        <div class="column is-3">
          <div class="has-text-centered">
            <p class="heading">하위 정책</p>
            <p class="title is-4">${lowerPolicies.length}</p>
          </div>
        </div>
      </div>
      <div class="mt-3 pt-3" style="border-top: 1px solid #e5e7eb;">
        <p class="is-size-7 has-text-grey">
          분석 시간: ${analysisTime}
        </p>
      </div>
    </div>
  `;
}

/**
 * 분석 결과가 없는 경우의 카드 HTML 생성
 */
function createNoAnalysisResultCard(device) {
  return `
    <div class="box analysis-result-card mb-3">
      <div class="level">
        <div class="level-left">
          <div>
            <strong class="is-size-5">${device.name}</strong>
            <p class="is-size-7 has-text-grey mt-1">${device.vendor} | ${device.ip_address}</p>
          </div>
        </div>
        <div class="level-right">
          <button class="button is-small is-primary" onclick="startAnalysis(${device.id})">
            <span>분석 시작</span>
          </button>
        </div>
      </div>
      <p class="has-text-grey has-text-centered py-3">
        아직 분석 결과가 없습니다. 분석을 시작해주세요.
      </p>
    </div>
  `;
}

/**
 * 분석 결과 오류 카드 HTML 생성
 */
function createAnalysisErrorCard(device) {
  return `
    <div class="box analysis-result-card mb-3">
      <div class="level">
        <div class="level-left">
          <div>
            <strong class="is-size-5">${device.name}</strong>
            <p class="is-size-7 has-text-grey mt-1">${device.vendor} | ${device.ip_address}</p>
          </div>
        </div>
      </div>
      <p class="has-text-danger has-text-centered py-3">
        분석 결과를 불러오는 중 오류가 발생했습니다.
      </p>
    </div>
  `;
}

/**
 * 장비의 분석 결과를 수집
 */
async function collectAnalysisResult(device) {
  try {
    const result = await api.getLatestAnalysisResult(device.id, 'redundancy');
    
    if (result && result.result_data) {
      return { device, result, type: 'success' };
    }
    return { device, result: null, type: 'no_result' };
  } catch (err) {
    if (err.status === 404) {
      return { device, result: null, type: 'no_result' };
    }
    console.error(`Failed to load analysis result for device ${device.id}:`, err);
    return { device, result: null, type: 'error' };
  }
}

/**
 * 정책 분석 결과 로드
 */
async function loadAnalysisResults() {
  const container = document.getElementById('analysis-results-container');
  if (!container) return;

  try {
    const devices = await api.listDevices();
    
    if (devices.length === 0) {
      container.innerHTML = '<div class="has-text-centered py-5"><p class="has-text-grey">등록된 장비가 없습니다.</p></div>';
      return;
    }

    // 모든 장비의 분석 결과를 병렬로 수집
    const results = await Promise.all(
      devices.map(device => collectAnalysisResult(device))
    );

    // 결과에 따라 HTML 생성
    const resultsHtml = results.map(({ device, result, type }) => {
      switch (type) {
        case 'success':
          return createAnalysisResultCard(device, result);
        case 'no_result':
          return createNoAnalysisResultCard(device);
        case 'error':
          return createAnalysisErrorCard(device);
        default:
          return '';
      }
    }).filter(html => html);

    if (resultsHtml.length === 0) {
      container.innerHTML = '<div class="has-text-centered py-5"><p class="has-text-grey">분석 결과가 없습니다.</p></div>';
    } else {
      container.innerHTML = resultsHtml.join('');
    }
  } catch (err) {
    console.error('Failed to load analysis results:', err);
    container.innerHTML = '<div class="has-text-centered py-5"><p class="has-text-danger">분석 결과를 불러오는 중 오류가 발생했습니다.</p></div>';
  }
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
    { field: 'policies', headerName: '정책 수', filter: 'agNumberColumnFilter', width: 100 },
    { field: 'active_policies', headerName: '활성 정책', filter: 'agNumberColumnFilter', width: 100 },
    { field: 'disabled_policies', headerName: '비활성 정책', filter: 'agNumberColumnFilter', width: 120 },
    { field: 'network_objects', headerName: '네트워크 객체', filter: 'agNumberColumnFilter', width: 130 },
    { field: 'services', headerName: '서비스 객체', filter: 'agNumberColumnFilter', width: 130 },
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

  const gridOptions = {
    columnDefs: columnDefs,
    rowData: [],
    defaultColDef: {
      resizable: true,
      sortable: true,
      filter: true
    },
    getRowId: (params) => String(params.data.id),
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

// ==================== 이벤트 리스너 설정 ====================

/**
 * 이벤트 리스너 설정
 */
function setupEventListeners() {
  const refreshSyncStatusBtn = document.getElementById('refresh-sync-status');
  if (refreshSyncStatusBtn) {
    refreshSyncStatusBtn.addEventListener('click', loadStatistics);
  }

  const refreshAnalysisBtn = document.getElementById('refresh-analysis-results');
  if (refreshAnalysisBtn) {
    refreshAnalysisBtn.addEventListener('click', loadAnalysisResults);
  }
}

// ==================== 전역 함수 (HTML에서 호출) ====================

/**
 * 분석 시작 함수 (전역으로 노출)
 */
window.startAnalysis = async function(deviceId) {
  if (!confirm('중복 정책 분석을 시작하시겠습니까?')) {
    return;
  }

  try {
    await api.startAnalysis(deviceId);
    alert('분석이 시작되었습니다. 완료되면 결과가 표시됩니다.');
    // 잠시 후 결과 새로고침
    setTimeout(loadAnalysisResults, 2000);
  } catch (err) {
    alert(`분석 시작 실패: ${err.message}`);
  }
};

/**
 * 분석 상세 보기 함수 (전역으로 노출)
 */
window.viewAnalysisDetails = function(deviceId) {
  navigate(`/analysis?device_id=${deviceId}`);
};

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
              
              // 동기화 상태 요약도 업데이트
              const deviceIndex = currentDeviceStatsData.findIndex(d => d.id === message.device_id);
              if (deviceIndex !== -1) {
                currentDeviceStatsData[deviceIndex] = updatedData;
                updateSyncStatusSummary(currentDeviceStatsData);
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
            loadStatistics();
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
  
  await Promise.all([
    loadStatistics(),
    loadAnalysisResults()
  ]);
}

/**
 * 대시보드 정리
 */
export function cleanupDashboard() {
  disconnectDashboardWebSocket();
}

