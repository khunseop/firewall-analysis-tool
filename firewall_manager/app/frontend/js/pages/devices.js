import { api } from "../api.js";

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
let handlersBound = false;
let pollTimer = null;

function normalizeVendorCode(value) {
  if (!value) return value;
  const raw = String(value).trim();
  if (codeToLabel.has(raw)) return raw; // already code
  if (labelToCode.has(raw)) return labelToCode.get(raw);
  const compact = raw.toLowerCase().replace(/\s+/g, "");
  for (const { code, label } of VENDOR_OPTIONS) {
    if (compact === code || compact === label.toLowerCase().replace(/\s+/g, "")) return code;
  }
  return raw;
}

function fillForm(initial = {}){
  const root = document.getElementById('modal-device');
  const form = root.querySelector('#device-form');
  const vendorSelect = root.querySelector('#vendor-select');
  vendorSelect.innerHTML = VENDOR_OPTIONS.map(x => `<option value="${x.code}">${x.label}</option>`).join("");
  const set = (name,val)=>{ const el=form.elements.namedItem(name); if(el) el.value = val ?? "" };
  set('name', initial.name);
  set('ip_address', initial.ip_address);
  set('username', initial.username);
  set('description', initial.description);
  vendorSelect.value = normalizeVendorCode(initial.vendor) || VENDOR_OPTIONS[0].code;
  const pw = root.querySelector('#password-input'); if (pw) pw.value = "";
}

function openModal(onSubmit){
  const modal = document.getElementById('modal-device');
  modal.classList.add('is-active');
  const close = () => {
    modal.classList.remove('is-active');
    document.removeEventListener('keydown', handleEsc);
  };
  
  const handleEsc = (e) => {
    if (e.key === 'Escape') close();
  };
  
  document.addEventListener('keydown', handleEsc);
  
  // 배경 클릭으로 닫기
  const background = modal.querySelector('.modal-background');
  if (background) background.onclick = close;
  
  modal.querySelector('#close-device').onclick = close;
  modal.querySelector('#cancel-device').onclick = (e)=>{e.preventDefault(); close();};
  modal.querySelector('#submit-device').onclick = async (e)=>{
    e.preventDefault();
    const form = modal.querySelector('#device-form');
    const fd = new FormData(form);
    const payload = Object.fromEntries(fd.entries());
    payload.vendor = normalizeVendorCode(payload.vendor);
    if (!payload.password) delete payload.password;
    try { await onSubmit(payload); close(); } catch (err){
      const el = modal.querySelector('#form-error');
      el.textContent = err.message || '요청 실패';
      el.classList.remove('is-hidden');
    }
  };
}

function openConfirm({ title = '확인', message = '이 작업을 진행하시겠습니까?', okText = '확인', cancelText = '취소' } = {}){
  return new Promise(resolve => {
    const modal = document.getElementById('modal-confirm');
    if (!modal) { return resolve(false); }
    modal.classList.add('is-active');
    const $ = (sel)=>modal.querySelector(sel);
    $('#confirm-title').textContent = title;
    $('#confirm-message').textContent = message;
    $('#confirm-ok').textContent = okText;
    $('#confirm-cancel').textContent = cancelText;
    
    const close = (val)=>{ 
      modal.classList.remove('is-active'); 
      document.removeEventListener('keydown', handleEsc);
      resolve(val); 
    };
    
    const handleEsc = (e) => {
      if (e.key === 'Escape') close(false);
    };
    
    document.addEventListener('keydown', handleEsc);
    
    // 배경 클릭으로 닫기
    const background = modal.querySelector('.modal-background');
    if (background) background.onclick = () => close(false);
    
    $('#confirm-close').onclick = ()=>close(false);
    $('#confirm-cancel').onclick = ()=>close(false);
    $('#confirm-ok').onclick = ()=>close(true);
  });
}

function openAlert({ title = '알림', message = '처리되었습니다.', okText = '확인' } = {}){
  return new Promise(resolve => {
    const modal = document.getElementById('modal-alert');
    if (!modal) { return resolve(); }
    modal.classList.add('is-active');
    const $ = (sel)=>modal.querySelector(sel);
    $('#alert-title').textContent = title;
    $('#alert-message').textContent = message;
    $('#alert-ok').textContent = okText;
    
    const close = ()=>{ 
      modal.classList.remove('is-active'); 
      document.removeEventListener('keydown', handleEsc);
      resolve(); 
    };
    
    const handleEsc = (e) => {
      if (e.key === 'Escape') close();
    };
    
    document.addEventListener('keydown', handleEsc);
    
    // 배경 클릭으로 닫기
    const background = modal.querySelector('.modal-background');
    if (background) background.onclick = close;
    
    $('#alert-close').onclick = close;
    $('#alert-ok').onclick = close;
  });
}

async function loadGrid(gridDiv, attempt = 0) {
  // agGrid 스크립트 로딩 대기 (보수적으로 재시도)
  if (!window.agGrid || (!window.agGrid.Grid && !window.agGrid.createGrid)) {
    if (attempt < 10) {
      return new Promise(resolve => setTimeout(() => resolve(loadGrid(gridDiv, attempt + 1)), 100));
    }
    console.warn('AG Grid not available. Skipping grid init.');
    return;
  }
  const data = await api.listDevices();
  const needRecreate = !gridApi || !gridHostEl || gridHostEl !== gridDiv;
  if (needRecreate) {
    if (gridApi && typeof gridApi.destroy === 'function') {
      try { gridApi.destroy(); } catch {}
    }
    gridOptions = {
      columnDefs: getColumns(),
      rowData: data,
      defaultColDef: { resizable: true, sortable: true, filter: false },
      rowSelection: { mode: 'multiRow', checkboxes: true, headerCheckbox: true, enableClickSelection: true} ,
      pagination: true,
      paginationAutoPageSize: true,
      animateRows: true,
      getRowId: (params) => String(params.data.id),
      autoSizeStrategy: { type: 'fitGridWidth', defaultMinWidth: 10, defaultMaxWidth: 400 },
      enableCellTextSelection: true,
    };
    if (agGrid.createGrid) {
      gridApi = agGrid.createGrid(gridDiv, gridOptions);
    } else {
      new agGrid.Grid(gridDiv, gridOptions);
      gridApi = gridOptions.api;
    }
    gridHostEl = gridDiv;
    // Apply quick filter from input if present after (re)creation
    try {
      const input = document.getElementById('devices-search');
      const value = input ? input.value : '';
      if (value) {
        if (gridApi && typeof gridApi.setGridOption === 'function') {
          gridApi.setGridOption('quickFilterText', value);
        } else if (gridApi && typeof gridApi.setQuickFilter === 'function') {
          gridApi.setQuickFilter(value);
        } else if (gridOptions && gridOptions.api && typeof gridOptions.api.setQuickFilter === 'function') {
          gridOptions.api.setQuickFilter(value);
        }
      }
    } catch {}
  } else {
    const api = gridApi || (gridOptions && gridOptions.api);
    if (api) {
      // setRowData로 교체하여 그리드를 항상 완전히 새로 고침
      // applyTransaction은 신규/삭제된 행을 반영하지 못함
      if (typeof api.setRowData === 'function') {
        api.setRowData(data);
      } else if (typeof api.setGridOption === 'function') {
        api.setGridOption('rowData', data);
      }
    }
    // Re-apply quick filter if any
    try {
      const input = document.getElementById('devices-search');
      const value = input ? input.value : '';
      const api = gridApi || (gridOptions && gridOptions.api);
      if (api && value) {
        if (typeof api.setGridOption === 'function') api.setGridOption('quickFilterText', value);
        else if (typeof api.setQuickFilter === 'function') api.setQuickFilter(value);
      }
    } catch {}
  }
}

function statusCellRenderer(params){
  const status = params.value;
  const step = params.data ? params.data.last_sync_step : null;
  const el = document.createElement('span');
  el.textContent = status || '-';

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
  }
  return el;
}

function getColumns(){
  return [
    { field: 'id', headerName:'ID', maxWidth: 100 },
    { field: 'name', headerName:'이름', flex: 1 },
    { field: 'vendor', headerName:'벤더', maxWidth: 150, valueFormatter: p => codeToLabel.get(normalizeVendorCode(p.value)) || p.value },
    { field: 'ip_address', headerName:'IP 주소' },
    { field: 'description', headerName:'설명', flex: 1 },
    { field: 'last_sync_status', headerName:'진행 상태', cellRenderer: statusCellRenderer },
    { field: 'last_sync_at', headerName:'마지막 동기화' },
  ];
}

async function reload(){
  const gridDiv = document.getElementById('devices-grid');
  if (gridDiv) await loadGrid(gridDiv);
}

export function initDevices(root){
  const addBtn = root.querySelector('#btn-add');
  const editBtn = root.querySelector('#btn-edit');
  const deleteBtn = root.querySelector('#btn-delete');
  const syncBtn = root.querySelector('#btn-sync');
  const search = root.querySelector('#devices-search');
  if (addBtn) {
    addBtn.onclick = () => {
      fillForm({});
      openModal(async (payload)=>{
        await api.createDevice(payload);
        await reload();
      });
    };
  }
  if (editBtn) {
    editBtn.onclick = async () => {
      const apiRef = gridApi || (gridOptions && gridOptions.api);
      if (!apiRef) return;
      const sel = apiRef.getSelectedRows ? apiRef.getSelectedRows() : [];
      if (!sel || sel.length === 0) { await openAlert({ title:'수정', message:'수정할 장비를 선택하세요.' }); return; }
      if (sel.length > 1) { await openAlert({ title:'수정', message:'수정은 장비 1개만 선택하세요.' }); return; }
      const d = sel[0];
      fillForm(d);
      openModal(async (payload)=>{
        await api.updateDevice(d.id, payload);
        await reload();
      });
    };
  }
  if (deleteBtn) {
    deleteBtn.onclick = async () => {
      const apiRef = gridApi || (gridOptions && gridOptions.api);
      if (!apiRef) return;
      const sel = apiRef.getSelectedRows ? apiRef.getSelectedRows() : [];
      if (!sel || sel.length === 0) { await openAlert({ title:'삭제', message:'삭제할 장비를 선택하세요.' }); return; }
      const ok = await openConfirm({ title:'삭제 확인', message:`${sel.length}개 장비를 삭제하시겠습니까?`, okText:'삭제', cancelText:'취소' });
      if (!ok) return;
      for (const d of sel) { try { await api.deleteDevice(d.id); } catch (e) { console.warn('delete failed', d.id, e); } }
      await reload();
    };
  }
  if (syncBtn) {
    syncBtn.onclick = async () => {
      const apiRef = gridApi || (gridOptions && gridOptions.api);
      if (!apiRef) return;
      const sel = apiRef.getSelectedRows ? apiRef.getSelectedRows() : [];
      if (!sel || sel.length === 0) { await openAlert({ title:'동기화', message:'동기화할 장비를 선택하세요.' }); return; }
      const ok = await openConfirm({ title:'동기화 확인', message:`${sel.length}개 장비에 대해 동기화를 시작할까요?`, okText:'동기화', cancelText:'취소' });
      if (!ok) return;
      // 서버는 글로벌 동시성(4)을 보장. 클라이언트는 단순히 모든 선택에 대해 트리거.
      const ids = sel.map(d=>d.id);
      for (const id of ids) {
        try { await api.syncAll(id); } catch (e) { console.warn('sync start failed', id, e); }
      }
      // 폴링 시작: in_progress 상태가 없어질 때까지 주기적으로 갱신
      startPolling();
    };
  }
  if (search) {
    search.oninput = () => {
      const value = search.value;
      const api = gridApi || (gridOptions && gridOptions.api);
      if (!api) return;
      if (typeof api.setGridOption === 'function') api.setGridOption('quickFilterText', value);
      else if (typeof api.setQuickFilter === 'function') api.setQuickFilter(value);
      // ensure header checkbox reflects filtered-only selection mode when filter changes
      try { if (api.refreshHeader) api.refreshHeader(); } catch {}
    };
  }
  reload();
  startPolling();
}

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

function stopPolling(){
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
}


