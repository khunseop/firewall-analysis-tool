import { api } from "../api.js";
import { openConfirm, openAlert, openFormModal } from "../utils/modal.js";
import { showEmptyMessage, hideEmptyMessage } from "../utils/message.js";

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
let pollTimer = null;

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
  setFormField(form, 'username', initial.username);
  setFormField(form, 'description', initial.description);
  
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
    
    // SSH 체크박스 처리
    const form = modal.querySelector('#device-form');
    if (form) {
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
  if (!value) return;
  
  const api = gridApi || (gridOptions && gridOptions.api);
  if (!api) return;
  
  if (typeof api.setGridOption === 'function') {
    api.setGridOption('quickFilterText', value);
  } else if (typeof api.setQuickFilter === 'function') {
    api.setQuickFilter(value);
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
  
  gridOptions = {
    columnDefs: getColumns(),
    rowData: data,
    defaultColDef: { 
      resizable: true, 
      sortable: true, 
      filter: false 
    },
    rowSelection: { 
      mode: 'multiRow', 
      checkboxes: true, 
      headerCheckbox: true, 
      enableClickSelection: true
    },
    pagination: true,
    paginationAutoPageSize: true,
    animateRows: true,
    getRowId: (params) => String(params.data.id),
    autoSizeStrategy: { 
      type: 'fitGridWidth', 
      defaultMinWidth: 10, 
      defaultMaxWidth: 400 
    },
    enableCellTextSelection: true,
  };
  
  if (agGrid.createGrid) {
    gridApi = agGrid.createGrid(gridDiv, gridOptions);
  } else {
    new agGrid.Grid(gridDiv, gridOptions);
    gridApi = gridOptions.api;
  }
  
  gridHostEl = gridDiv;
  
  // 빠른 필터 적용
  const input = document.getElementById('devices-search');
  if (input && input.value) {
    applyQuickFilter(input.value);
  }
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
 * 동기화 상태 셀 렌더러
 */
function statusCellRenderer(params) {
  const status = params.value;
  const step = params.data?.last_sync_step;
  const el = document.createElement('span');
  
  if (status === 'in_progress') {
    const stepText = step || '진행 중...';
    el.innerHTML = `
      <span class="icon is-small" style="margin-right:6px">
        <svg class="spinner" width="14" height="14" viewBox="0 0 50 50">
          <circle cx="25" cy="25" r="20" fill="none" stroke="#3273dc" stroke-width="6" stroke-linecap="round" stroke-dasharray="31.4 31.4">
            <animateTransform attributeName="transform" type="rotate" from="0 25 25" to="360 25 25" dur="0.8s" repeatCount="indefinite" />
          </circle>
        </svg>
      </span> ${stepText}`;
  } else if (status === 'success') {
    el.innerHTML = `<span class="tag is-success is-light">성공</span>`;
  } else if (status === 'failure') {
    el.innerHTML = `<span class="tag is-danger is-light">실패</span>`;
  } else {
    el.textContent = status || '-';
  }
  
  return el;
}

/**
 * 그리드 컬럼 정의
 */
function getColumns() {
  return [
    { field: 'id', headerName: 'ID', maxWidth: 100 },
    { field: 'name', headerName: '이름' },
    { 
      field: 'vendor', 
      headerName: '벤더', 
      maxWidth: 150, 
      valueFormatter: p => codeToLabel.get(normalizeVendorCode(p.value)) || p.value 
    },
    { field: 'ip_address', headerName: 'IP 주소' },
    { field: 'description', headerName: '설명' },
    { 
      field: 'last_sync_status', 
      headerName: '진행 상태', 
      cellRenderer: statusCellRenderer 
    },
    { field: 'last_sync_at', headerName: '마지막 동기화' },
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
  
  // 폴링 시작: in_progress 상태가 없어질 때까지 주기적으로 갱신
  startPolling();
}

/**
 * 검색 핸들러
 */
function handleSearch(event) {
  const value = event.target.value;
  applyQuickFilter(value);
  
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

// ==================== 폴링 관련 함수 ====================

/**
 * 폴링 시작
 */
async function startPolling() {
  stopPolling();
  
  const tick = async () => {
    let nextInterval = 8000; // 기본 폴링 간격
    
    try {
      const latestDevices = await api.listDevices();
      const apiRef = gridApi || (gridOptions && gridOptions.api);

      if (apiRef && latestDevices) {
        const rowsToUpdate = [];
        let hasInProgress = false;

        latestDevices.forEach(device => {
          const rowNode = apiRef.getRowNode(String(device.id));
          if (rowNode) {
            // 기존 행과 데이터 비교하여 변경된 경우에만 업데이트 목록에 추가
            const currentData = rowNode.data;
            if (JSON.stringify(currentData) !== JSON.stringify(device)) {
              rowsToUpdate.push(device);
            }
          }
          if (device.last_sync_status === 'in_progress') {
            hasInProgress = true;
          }
        });

        if (rowsToUpdate.length > 0) {
          apiRef.applyTransaction({ update: rowsToUpdate });
        }

        if (hasInProgress) {
          nextInterval = 2000; // 동기화 진행 중일 때는 더 자주 폴링
        }
      }
    } catch (e) {
      console.error("Polling failed:", e);
      nextInterval = 15000; // 에러 발생 시 폴링 간격 늘림
    } finally {
      pollTimer = setTimeout(tick, nextInterval);
    }
  };
  
  pollTimer = setTimeout(tick, 1500); // 즉시 첫 실행
}

/**
 * 폴링 중지
 */
function stopPolling() {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

// ==================== 초기화 ====================

/**
 * 장비 페이지 초기화
 */
export function initDevices(root) {
  const addBtn = root.querySelector('#btn-add');
  const editBtn = root.querySelector('#btn-edit');
  const deleteBtn = root.querySelector('#btn-delete');
  const syncBtn = root.querySelector('#btn-sync');
  const search = root.querySelector('#devices-search');
  
  if (addBtn) addBtn.onclick = handleAdd;
  if (editBtn) editBtn.onclick = handleEdit;
  if (deleteBtn) deleteBtn.onclick = handleDelete;
  if (syncBtn) syncBtn.onclick = handleSync;
  if (search) search.oninput = handleSearch;
  
  reload();
  startPolling();
}


