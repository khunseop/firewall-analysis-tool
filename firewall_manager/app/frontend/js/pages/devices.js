import { api } from "../api.js";
import { openConfirm, openAlert, openFormModal } from "../utils/modal.js";
import { showEmptyMessage, hideEmptyMessage } from "../utils/message.js";
import { formatDateTime } from "../utils/date.js";
import { saveSearchParams, loadSearchParams } from "../utils/storage.js";
import { notifySyncComplete } from "../utils/notification.js";
import { createCommonGridOptions, createGridEventHandlers, adjustGridHeight } from "../utils/grid.js";

// ==================== 상수 및 전역 변수 ====================

const VENDOR_OPTIONS = [
  { code: "paloalto", label: "Palo Alto" },
  { code: "ngf", label: "SECUI NGF" },
  { code: "mock", label: "Mock" },
];

const codeToLabel = new Map(VENDOR_OPTIONS.map(v => [v.code, v.label]));
const labelToCode = new Map(VENDOR_OPTIONS.map(v => [v.label, v.code]));

let gridOptions;
let gridApi;
let gridHostEl;
let websocket = null;

// ==================== 유틸리티 함수 ====================

/**
 * 벤더 코드 정규화
 */
function normalizeVendorCode(value) {
  if (!value) return value;
  const raw = String(value).trim();
  if (codeToLabel.has(raw)) return raw;
  if (labelToCode.has(raw)) return labelToCode.get(raw);
  const compact = raw.toLowerCase().replace(/\s+/g, "");
  for (const { code, label } of VENDOR_OPTIONS) {
    if (compact === code || compact === label.toLowerCase().replace(/\s+/g, "")) return code;
  }
  return raw;
}

/**
 * 폼 필드 값 설정
 */
function setFormField(form, name, value) {
  const el = form.elements.namedItem(name);
  if (el) el.value = value ?? "";
}

/**
 * 장비 폼 채우기
 */
function fillDeviceForm(initial = {}) {
  const root = document.getElementById('modal-device');
  if (!root) return;
  
  const form = root.querySelector('#device-form');
  if (!form) return;
  
  const vendorSelect = root.querySelector('#vendor-select');
  if (vendorSelect) {
    vendorSelect.innerHTML = VENDOR_OPTIONS.map(x => 
      `<option value="${x.code}">${x.label}</option>`
    ).join("");
    vendorSelect.value = normalizeVendorCode(initial.vendor) || VENDOR_OPTIONS[0].code;
  }
  
  setFormField(form, 'name', initial.name);
  setFormField(form, 'ip_address', initial.ip_address);
  setFormField(form, 'ha_peer_ip', initial.ha_peer_ip);
  setFormField(form, 'model', initial.model);
  setFormField(form, 'username', initial.username);
  setFormField(form, 'description', initial.description);
  
  const collectHitDateCheckbox = form.elements.namedItem('collect_last_hit_date');
  if (collectHitDateCheckbox) {
    collectHitDateCheckbox.checked = initial.collect_last_hit_date !== undefined ? initial.collect_last_hit_date : true;
  }
  
  const useSshCheckbox = form.elements.namedItem('use_ssh_for_last_hit_date');
  if (useSshCheckbox) {
    useSshCheckbox.checked = initial.use_ssh_for_last_hit_date || false;
  }
  
  const pw = root.querySelector('#password-input');
  if (pw) pw.value = "";
  
  const pwConfirm = form.elements.namedItem('password_confirm');
  if (pwConfirm) pwConfirm.value = "";
}

/**
 * 장비 모달 열기
 */
function openDeviceModal(onSubmit) {
  const modal = document.getElementById('modal-device');
  if (!modal) return;
  
  const handleSubmit = async (payload) => {
    payload.vendor = normalizeVendorCode(payload.vendor);
    
    // 비밀번호 확인
    if (payload.password && payload.password !== payload.password_confirm) {
      throw new Error('비밀번호가 일치하지 않습니다.');
    }
    
    // 비밀번호가 없으면 필드 제거
    if (!payload.password) {
      delete payload.password;
      delete payload.password_confirm;
    }
    
    // 체크박스 처리
    const form = modal.querySelector('#device-form');
    if (form) {
      const collectHitDateCheckbox = form.elements.namedItem('collect_last_hit_date');
      payload.collect_last_hit_date = collectHitDateCheckbox?.checked !== false; // 기본값은 true
      
      const useSshCheckbox = form.elements.namedItem('use_ssh_for_last_hit_date');
      payload.use_ssh_for_last_hit_date = useSshCheckbox?.checked || false;
    }
    
    await onSubmit(payload);
  };
  
  return openFormModal(modal, handleSubmit);
}


// ==================== 그리드 관련 함수 ====================

/**
 * AG Grid 라이브러리 로딩 대기
 */
async function waitForAgGrid(attempt = 0) {
  if (window.agGrid && (window.agGrid.Grid || window.agGrid.createGrid)) {
    return true;
  }
  if (attempt < 10) {
    return new Promise(resolve => 
      setTimeout(() => resolve(waitForAgGrid(attempt + 1)), 100)
    );
  }
  console.warn('AG Grid not available. Skipping grid init.');
  return false;
}

/**
 * 빠른 필터 적용
 */
function applyQuickFilter(value) {
  const api = gridApi || (gridOptions && gridOptions.api);
  if (!api) return;
  
  // 빈 값일 때도 필터를 초기화하기 위해 빈 문자열로 설정
  const filterValue = value || '';
  
  if (typeof api.setGridOption === 'function') {
    api.setGridOption('quickFilterText', filterValue);
  } else if (typeof api.setQuickFilter === 'function') {
    api.setQuickFilter(filterValue);
  }
}

/**
 * 그리드 데이터 업데이트
 */
function updateGridData(data) {
  const api = gridApi || (gridOptions && gridOptions.api);
  if (!api) return;
  
  if (typeof api.setRowData === 'function') {
    api.setRowData(data);
  } else if (typeof api.setGridOption === 'function') {
    api.setGridOption('rowData', data);
  }
  
  // 빠른 필터 재적용
  const input = document.getElementById('devices-search');
  if (input && input.value) {
    applyQuickFilter(input.value);
  }
  
  // 높이 조절
  if (gridHostEl) {
    setTimeout(() => {
      adjustGridHeight(gridHostEl);
    }, 200);
  }
}

/**
 * 그리드 생성
 */
function createGrid(gridDiv, data) {
  if (gridApi && typeof gridApi.destroy === 'function') {
    try {
      gridApi.destroy();
    } catch (e) {
      console.warn('Failed to destroy grid:', e);
    }
  }
  
  const commonOptions = createCommonGridOptions({
    pagination: true,
    paginationPageSize: 50,
    paginationPageSizeSelector: [50, 100, 200],
    animateRows: true,
    autoSizeStrategy: { 
      type: 'fitGridWidth', 
      defaultMinWidth: 10, 
      defaultMaxWidth: 400 
    }
  });
  
  const handlers = createGridEventHandlers(gridDiv, null);
  
  gridOptions = {
    ...commonOptions,
    columnDefs: getColumns(),
    rowData: data,
    defaultColDef: { 
      ...commonOptions.defaultColDef,
      sortable: true, 
      filter: false // 빠른 필터 사용
    },
    rowSelection: { 
      mode: 'multiRow', 
      checkboxes: true, 
      headerCheckbox: true, 
      enableClickSelection: true
    },
    onGridReady: (params) => {
      gridApi = params.api;
      gridHostEl = gridDiv;
      
      // 빠른 필터 적용
      const input = document.getElementById('devices-search');
      if (input && input.value) {
        applyQuickFilter(input.value);
      }
      
      // 이벤트 핸들러 적용
      const updatedHandlers = createGridEventHandlers(gridDiv, params.api);
      Object.assign(gridOptions, updatedHandlers);
    },
    ...handlers
  };
  
  if (agGrid.createGrid) {
    gridApi = agGrid.createGrid(gridDiv, gridOptions);
  } else {
    new agGrid.Grid(gridDiv, gridOptions);
    gridApi = gridOptions.api;
  }
  
  // 초기 높이 조절
  setTimeout(() => {
    adjustGridHeight(gridDiv);
  }, 200);
}

/**
 * 그리드 로드
 */
async function loadGrid(gridDiv) {
  const isReady = await waitForAgGrid();
  if (!isReady) return;
  
  const data = await api.listDevices();
  const messageContainer = document.getElementById('devices-message-container');
  
  // 장비가 없으면 메시지 표시
  if (data.length === 0) {
    showEmptyMessage(messageContainer, '장비를 추가하세요', 'fa-plus-circle');
    if (gridDiv) gridDiv.style.display = 'none';
    return;
  }
  
  // 장비가 있으면 메시지 숨기고 그리드 표시
  hideEmptyMessage(messageContainer);
  if (gridDiv) gridDiv.style.display = 'block';
  
  const needRecreate = !gridApi || !gridHostEl || gridHostEl !== gridDiv;
  
  if (needRecreate) {
    createGrid(gridDiv, data);
  } else {
    updateGridData(data);
  }
}

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
 * IP 주소 셀 렌더러 (클릭 가능한 링크)
 */
function ipAddressCellRenderer(params) {
  const ip = params.value;
  if (!ip) return '';
  
  // IP 주소를 https:// 링크로 변환 (새 탭에서 열림)
  const url = `https://${ip}`;
  return `
    <a href="${url}" target="_blank" rel="noopener noreferrer" 
       style="color: #3273dc; text-decoration: none; cursor: pointer;"
       onmouseover="this.style.textDecoration='underline'"
       onmouseout="this.style.textDecoration='none'">
      ${ip}
    </a>
  `;
}

/**
 * 동기화 상태 셀 렌더러 (동그라미 아이콘 + 호버 툴팁)
 */
function statusCellRenderer(params) {
  const status = params.value || 'unknown';
  const step = params.data?.last_sync_step || '';
  
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

/**
 * 그리드 컬럼 정의
 */
function getColumns() {
  return [
    { 
      field: 'id', 
      headerName: 'ID', 
      maxWidth: 100
    },
    { field: 'name', headerName: '이름' },
    { 
      field: 'vendor', 
      headerName: '벤더', 
      maxWidth: 150, 
      valueFormatter: p => codeToLabel.get(normalizeVendorCode(p.value)) || p.value 
    },
    { field: 'model', headerName: '모델', maxWidth: 150 },
    { 
      field: 'ip_address', 
      headerName: 'IP 주소',
      cellRenderer: ipAddressCellRenderer
    },
    { field: 'description', headerName: '설명' },
    { 
      field: 'last_sync_status', 
      headerName: '동기화 상태',
      width: 120,
      cellRenderer: statusCellRenderer,
      headerClass: 'text-left',
      cellStyle: { display: 'flex', alignItems: 'center', justifyContent: 'center' }
    },
    { 
      field: 'last_sync_at', 
      headerName: '마지막 동기화',
      valueFormatter: (params) => formatDateTime(params.value)
    },
  ];
}

// ==================== 이벤트 핸들러 ====================

/**
 * 선택된 행 가져오기
 */
function getSelectedRows() {
  const apiRef = gridApi || (gridOptions && gridOptions.api);
  if (!apiRef || !apiRef.getSelectedRows) return [];
  return apiRef.getSelectedRows() || [];
}

/**
 * 그리드 새로고침
 */
async function reload() {
  const gridDiv = document.getElementById('devices-grid');
  if (gridDiv) await loadGrid(gridDiv);
}

/**
 * 장비 추가 핸들러
 */
function handleAdd() {
  fillDeviceForm({});
  openDeviceModal(async (payload) => {
    await api.createDevice(payload);
    await reload();
  });
}

/**
 * 장비 수정 핸들러
 */
async function handleEdit() {
  const sel = getSelectedRows();
  
  if (sel.length === 0) {
    await openAlert({ title: '수정', message: '수정할 장비를 선택하세요.' });
    return;
  }
  
  if (sel.length > 1) {
    await openAlert({ title: '수정', message: '수정은 장비 1개만 선택하세요.' });
    return;
  }
  
  const device = sel[0];
  fillDeviceForm(device);
  openDeviceModal(async (payload) => {
    await api.updateDevice(device.id, payload);
    await reload();
  });
}

/**
 * 장비 삭제 핸들러
 */
async function handleDelete() {
  const sel = getSelectedRows();
  
  if (sel.length === 0) {
    await openAlert({ title: '삭제', message: '삭제할 장비를 선택하세요.' });
    return;
  }
  
  const ok = await openConfirm({
    title: '삭제 확인',
    message: `${sel.length}개 장비를 삭제하시겠습니까?`,
    okText: '삭제',
    cancelText: '취소'
  });
  
  if (!ok) return;
  
  for (const device of sel) {
    try {
      await api.deleteDevice(device.id);
    } catch (e) {
      console.warn('delete failed', device.id, e);
    }
  }
  
  await reload();
}

/**
 * 장비 동기화 핸들러
 */
async function handleSync() {
  const sel = getSelectedRows();
  
  if (sel.length === 0) {
    await openAlert({ title: '동기화', message: '동기화할 장비를 선택하세요.' });
    return;
  }
  
  const ok = await openConfirm({
    title: '동기화 확인',
    message: `${sel.length}개 장비에 대해 동기화를 시작할까요?`,
    okText: '동기화',
    cancelText: '취소'
  });
  
  if (!ok) return;
  
  // 서버는 글로벌 동시성(4)을 보장. 클라이언트는 단순히 모든 선택에 대해 트리거.
  const ids = sel.map(d => d.id);
  for (const id of ids) {
    try {
      await api.syncAll(id);
    } catch (e) {
      console.warn('sync start failed', id, e);
    }
  }
  
  // WebSocket을 통해 실시간 상태 업데이트가 자동으로 반영됨
}

/**
 * 검색 핸들러
 */
function handleSearch(event) {
  const value = event.target.value;
  applyQuickFilter(value);
  
  // 검색 조건 저장
  saveSearchParams('devices', { searchText: value });
  
  // 헤더 체크박스 갱신
  const apiRef = gridApi || (gridOptions && gridOptions.api);
  if (apiRef && apiRef.refreshHeader) {
    try {
      apiRef.refreshHeader();
    } catch (e) {
      // 무시
    }
  }
}

/**
 * 엑셀 서식 다운로드 핸들러
 */
async function handleDownloadTemplate() {
  try {
    await api.downloadDeviceTemplate();
    await openAlert({ 
      title: '다운로드 완료', 
      message: '엑셀 서식 파일이 다운로드되었습니다.' 
    });
  } catch (e) {
    await openAlert({ 
      title: '다운로드 실패', 
      message: e.message || '엑셀 서식 다운로드에 실패했습니다.' 
    });
  }
}

/**
 * 엑셀 파일 업로드 핸들러
 */
async function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  // 파일 확장자 확인
  if (!file.name.match(/\.(xlsx|xls)$/i)) {
    await openAlert({ 
      title: '파일 형식 오류', 
      message: '엑셀 파일(.xlsx, .xls)만 업로드 가능합니다.' 
    });
    event.target.value = ''; // 파일 선택 초기화
    return;
  }
  
  // 확인 대화상자
  const ok = await openConfirm({
    title: '일괄 등록 확인',
    message: `'${file.name}' 파일로 장비를 일괄 등록하시겠습니까?`,
    okText: '등록',
    cancelText: '취소'
  });
  
  if (!ok) {
    event.target.value = ''; // 파일 선택 초기화
    return;
  }
  
  try {
    const result = await api.bulkImportDevices(file);
    
    // 결과 메시지 구성
    let message = result.message || `총 ${result.total}개 중 ${result.success_count}개 장비가 등록되었습니다.`;
    
    if (result.failed_count > 0) {
      message += `\n\n실패: ${result.failed_count}개`;
      if (result.failed_devices && result.failed_devices.length > 0) {
        message += '\n\n' + result.failed_devices.slice(0, 10).join('\n');
        if (result.failed_devices.length > 10) {
          message += `\n... 외 ${result.failed_devices.length - 10}개`;
        }
      }
    }
    
    await openAlert({ 
      title: '일괄 등록 완료', 
      message: message 
    });
    
    // 그리드 새로고침
    await reload();
    
  } catch (e) {
    await openAlert({ 
      title: '일괄 등록 실패', 
      message: e.message || '엑셀 파일 처리에 실패했습니다.' 
    });
  } finally {
    event.target.value = ''; // 파일 선택 초기화
  }
}

// ==================== WebSocket 관련 함수 ====================

/**
 * WebSocket 연결 시작
 */
function connectWebSocket() {
  // 이미 연결되어 있으면 재연결하지 않음
  if (websocket && websocket.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }

  // WebSocket URL 구성 (ws:// 또는 wss://)
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/api/v1/ws/sync-status`;

  return new Promise((resolve, reject) => {
    try {
      websocket = new WebSocket(wsUrl);

      websocket.onopen = () => {
        console.log('WebSocket 연결됨');
        resolve();
      };

    websocket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'device_sync_status') {
          handleSyncStatusUpdate(message);
        }
      } catch (e) {
        console.error('WebSocket 메시지 파싱 실패:', e);
      }
    };

      websocket.onerror = (error) => {
        console.error('WebSocket 오류:', error);
        // 연결 실패 시에만 reject (이미 연결된 경우는 무시)
        if (websocket.readyState !== WebSocket.OPEN) {
          reject(error);
        }
      };

      websocket.onclose = () => {
        console.log('WebSocket 연결 종료됨. 3초 후 재연결 시도...');
        // 재연결은 백그라운드에서 진행 (Promise와 무관)
        setTimeout(() => {
          if (websocket && websocket.readyState === WebSocket.CLOSED) {
            connectWebSocket().catch(() => {
              // 재연결 실패는 무시 (백그라운드 작업)
            });
          }
        }, 3000);
      };
    } catch (e) {
      console.error('WebSocket 연결 실패:', e);
      reject(e);
    }
  });
}

/**
 * WebSocket 연결 종료
 */
function disconnectWebSocket() {
  if (websocket) {
    websocket.close();
    websocket = null;
  }
}

/**
 * 동기화 상태 업데이트 처리
 */
function handleSyncStatusUpdate(message) {
  const { device_id, status, step } = message;
  const apiRef = gridApi || (gridOptions && gridOptions.api);

  if (!apiRef) {
    // 그리드가 아직 초기화되지 않았으면 전체 데이터 다시 로드
    reload();
    return;
  }

  const rowNode = apiRef.getRowNode(String(device_id));
  
  if (rowNode && rowNode.data) {
    // 그리드에 행이 있으면 즉시 업데이트
    const updatedData = {
      ...rowNode.data,
      last_sync_status: status,
      last_sync_step: step || null
    };

    // 완료 상태일 때 타임스탬프도 업데이트 (서버에서 설정됨)
    if (status === 'success' || status === 'failure') {
      updatedData.last_sync_at = new Date().toISOString();
      
      // 동기화 완료 알림
      const deviceName = updatedData.name || `장비 ${device_id}`;
      notifySyncComplete(deviceName, status === 'success', device_id).catch(err => {
        console.warn('알림 표시 실패:', err);
      });
    }

    // rowNode.setData를 사용하여 데이터 업데이트 (셀 자동 새로고침)
    try {
      rowNode.setData(updatedData);
    } catch (e) {
      // setData가 실패하면 applyTransaction 사용
      console.warn(`그리드 업데이트 실패, 대체 방법 사용:`, e);
      apiRef.applyTransaction({ update: [updatedData] });
      
      // 셀 강제 새로고침
      try {
        if (apiRef.refreshCells) {
          apiRef.refreshCells({ 
            rowNodes: [rowNode],
            columns: ['last_sync_status'],
            force: true 
          });
        } else if (apiRef.redrawRows) {
          apiRef.redrawRows({ rowNodes: [rowNode] });
        }
      } catch (refreshError) {
        console.warn(`셀 새로고침 실패:`, refreshError);
      }
    }
  } else {
    // 그리드에 행이 없으면 전체 데이터 다시 로드 (초기 로드 전에 메시지가 온 경우)
    reload();
  }
}

// ==================== 초기화 ====================

/**
 * 장비 페이지 초기화
 */
export async function initDevices(root) {
  const addBtn = root.querySelector('#btn-add');
  const editBtn = root.querySelector('#btn-edit');
  const deleteBtn = root.querySelector('#btn-delete');
  const syncBtn = root.querySelector('#btn-sync');
  const downloadTemplateBtn = root.querySelector('#btn-download-template');
  const fileUpload = root.querySelector('#file-upload');
  const search = root.querySelector('#devices-search');
  
  if (addBtn) addBtn.onclick = handleAdd;
  if (editBtn) editBtn.onclick = handleEdit;
  if (deleteBtn) deleteBtn.onclick = handleDelete;
  if (syncBtn) syncBtn.onclick = handleSync;
  if (downloadTemplateBtn) downloadTemplateBtn.onclick = handleDownloadTemplate;
  if (fileUpload) fileUpload.onchange = handleFileUpload;
  if (search) {
    search.oninput = handleSearch;
    
    // 저장된 검색 조건 복원
    const savedState = loadSearchParams('devices');
    if (savedState && savedState.searchText) {
      search.value = savedState.searchText;
    }
  }
  
  // WebSocket 연결 후 초기 데이터 로드 (연결 완료를 기다림)
  try {
    await connectWebSocket();
  } catch (e) {
    console.warn('WebSocket 연결 실패, 폴링 모드로 진행:', e);
  }
  
  await reload();
  
  // 저장된 검색 조건 적용
  if (search && search.value) {
    applyQuickFilter(search.value);
  }
}

/**
 * 페이지 언마운트 시 WebSocket 연결 종료
 */
export function cleanupDevices() {
  disconnectWebSocket();
}


