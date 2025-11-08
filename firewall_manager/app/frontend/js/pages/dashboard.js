import { api } from '../api.js';
import { navigate } from '../router.js';

let deviceStatsGrid = null;

// ==================== 유틸리티 함수 ====================

/**
 * 날짜를 한국어 형식으로 포맷팅
 */
function formatDateTime(dateString) {
  if (!dateString) return '없음';
  return new Date(dateString).toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * DOM 요소의 텍스트를 안전하게 업데이트
 */
function updateElementText(id, text) {
  const element = document.getElementById(id);
  if (element) element.textContent = text;
}

/**
 * 여러 DOM 요소를 한 번에 업데이트
 */
function updateElements(updates) {
  Object.entries(updates).forEach(([id, text]) => {
    updateElementText(id, text);
  });
}

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
    if (deviceStatsGrid) {
      deviceStatsGrid.setGridOption('rowData', deviceStatsData);
    }

    // 동기화 상태 요약 업데이트
    updateSyncStatusSummary(deviceStatsData);
  } catch (err) {
    console.error('Failed to load statistics:', err);
    setStatisticsError();
  }
}

// ==================== 동기화 상태 관련 함수 ====================

/**
 * 동기화 상태에 따른 색상 반환
 */
function getSyncStatusColor(status) {
  const statusMap = {
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
            <span class="icon is-small"><i class="fas fa-arrow-right"></i></span>
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
          <i class="far fa-clock"></i> 분석 시간: ${analysisTime}
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
            <span class="icon is-small"><i class="fas fa-play"></i></span>
            <span>분석 시작</span>
          </button>
        </div>
      </div>
      <p class="has-text-grey has-text-centered py-3">
        <i class="far fa-info-circle"></i> 아직 분석 결과가 없습니다. 분석을 시작해주세요.
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
        <i class="fas fa-exclamation-triangle"></i> 분석 결과를 불러오는 중 오류가 발생했습니다.
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
      cellRenderer: (params) => {
        const status = params.value || 'unknown';
        const color = getSyncStatusColor(status);
        const text = getSyncStatusText(status);
        return `<span class="tag ${color}">${text}</span>`;
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

// ==================== 대시보드 초기화 ====================

/**
 * 대시보드 초기화
 */
export async function initDashboard() {
  initDeviceStatsGrid();
  setupEventListeners();
  await Promise.all([
    loadStatistics(),
    loadAnalysisResults()
  ]);
}

