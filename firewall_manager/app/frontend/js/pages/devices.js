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
let miniModal;
let consoleModal;
let consoleAutoscroll = true;
let consolePoller;
let lastSeq = 0;

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
  const close = () => modal.classList.remove('is-active');
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
      rowSelection: {mode:'multiRow'},
      pagination: true,
      paginationAutoPageSize: true,
      animateRows: true,
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
    if (gridApi) {
      if (typeof gridApi.setGridOption === 'function') gridApi.setGridOption('rowData', data);
      else if (typeof gridApi.setRowData === 'function') gridApi.setRowData(data);
      else if (gridOptions && gridOptions.api) gridOptions.api.setRowData(data);
    } else if (gridOptions && gridOptions.api) {
      gridOptions.api.setRowData(data);
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

function getColumns(){
  return [
    { field: 'id', headerName:'ID', width: 80 },
    { field: 'name', headerName:'이름', flex: 1 },
    { field: 'vendor', headerName:'벤더', width: 140, valueFormatter: p => codeToLabel.get(normalizeVendorCode(p.value)) || p.value },
    { field: 'ip_address', headerName:'IP 주소', width: 160 },
    { field: 'username', headerName:'사용자', width: 140 },
    { field: 'description', headerName:'설명', flex: 1 },
    { field: 'last_sync_status', headerName:'동기화 상태', width: 140 },
    { field: 'last_sync_at', headerName:'동기화 시간', width: 180 },
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
  const logBtn = root.querySelector('#btn-log');
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
      if (!sel || sel.length !== 1) { return showAlert('수정은 장비 1개만 선택하세요.'); }
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
      if (!sel || sel.length === 0) { return showAlert('삭제할 장비를 선택하세요.'); }
      const ok = await showConfirm(`${sel.length}개 장비를 삭제하시겠습니까?`);
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
      if (!sel || sel.length === 0) { return showAlert('동기화할 장비를 선택하세요.'); }
      const ok = await showConfirm(`${sel.length}개 장비의 전체 동기화를 시작할까요?`);
      if (!ok) return;
      // Simple queue: max 4 concurrent
      const ids = sel.map(d=>d.id);
      const concurrency = 4;
      let idx = 0; let active = 0; let done = 0; let failed = 0;
      return new Promise((resolve)=>{
        const next = () => {
          while (active < concurrency && idx < ids.length) {
            const id = ids[idx++];
            active++;
            api.syncAll(id).then(()=>{ done++; window.pushNotice && window.pushNotice(`장비 ${id} 동기화 시작됨`, 'info'); streamLogsToNavbar(id, 60000); }).catch((e)=>{ failed++; window.pushNotice && window.pushNotice(`장비 ${id} 동기화 시작 실패: ${e.message||e}`, 'error'); }).finally(()=>{
              active--; if (done+failed === ids.length) { showAlert(`동기화 시작됨: ${done} 성공, ${failed} 실패(시작 단계)`); resolve(); }
              else next();
            });
          }
        };
        next();
      });
    };
  }
  if (logBtn) {
    logBtn.onclick = async () => {
      const apiRef = gridApi || (gridOptions && gridOptions.api);
      if (!apiRef) return;
      const sel = apiRef.getSelectedRows ? apiRef.getSelectedRows() : [];
      if (!sel || sel.length !== 1) { return showAlert('로그는 장비 1개만 선택하세요.'); }
      // Instead of console modal: stream to navbar notices inline for a short session
      streamLogsToNavbar(sel[0].id, 8000);
    };
  }
  if (search) {
    search.oninput = () => {
      const value = search.value;
      const api = gridApi || (gridOptions && gridOptions.api);
      if (!api) return;
      if (typeof api.setGridOption === 'function') api.setGridOption('quickFilterText', value);
      else if (typeof api.setQuickFilter === 'function') api.setQuickFilter(value);
    };
  }
  reload();
}


// ---------- Mini modal helpers ----------
function ensureMiniModal(){
  if (miniModal) return miniModal;
  const root = document.getElementById('modal-mini');
  const title = root.querySelector('#mini-title');
  const message = root.querySelector('#mini-message');
  const close = root.querySelector('#mini-close');
  const ok = root.querySelector('#mini-ok');
  const confirmBtn = root.querySelector('#mini-confirm');
  const cancel = root.querySelector('#mini-cancel');
  miniModal = { root, title, message, close, ok, confirmBtn, cancel };
  const hide = ()=> root.classList.remove('is-active');
  close.onclick = hide;
  return miniModal;
}

function showAlert(msg){
  const m = ensureMiniModal();
  m.title.textContent = '알림';
  m.message.textContent = msg || '';
  m.ok.classList.remove('is-hidden');
  m.confirmBtn.classList.add('is-hidden');
  m.cancel.classList.add('is-hidden');
  return new Promise((resolve)=>{
    const hide = ()=>{ m.root.classList.remove('is-active'); m.ok.onclick = null; resolve(true); };
    m.ok.onclick = hide;
    m.root.classList.add('is-active');
  });
}

function showConfirm(msg){
  const m = ensureMiniModal();
  m.title.textContent = '확인';
  m.message.textContent = msg || '';
  m.ok.classList.add('is-hidden');
  m.confirmBtn.classList.remove('is-hidden');
  m.cancel.classList.remove('is-hidden');
  return new Promise((resolve)=>{
    const cleanup = ()=>{ m.confirmBtn.onclick = null; m.cancel.onclick = null; };
    m.confirmBtn.onclick = ()=>{ cleanup(); m.root.classList.remove('is-active'); resolve(true); };
    m.cancel.onclick = ()=>{ cleanup(); m.root.classList.remove('is-active'); resolve(false); };
    m.root.classList.add('is-active');
  });
}

// ---------- Sync console modal ----------
function ensureConsole(){
  if (consoleModal) return consoleModal;
  const root = document.getElementById('modal-sync-console');
  const close = document.getElementById('console-close');
  const ok = document.getElementById('console-ok');
  const out = document.getElementById('sync-console-output');
  const clearBtn = document.getElementById('console-clear');
  const autoscrollBtn = document.getElementById('console-autoscroll');
  const refreshBtn = document.getElementById('console-refresh-status');
  const deviceTag = document.getElementById('console-device-tag');
  const statusTag = document.getElementById('console-status-tag');
  const title = document.getElementById('console-title');
  consoleModal = { root, close, ok, out, clearBtn, autoscrollBtn, refreshBtn, deviceTag, statusTag, title };
  const hide = ()=>{ stopPolling(); root.classList.remove('is-active'); };
  close.onclick = hide; ok.onclick = hide;
  clearBtn.onclick = ()=>{ out.textContent = ''; lastSeq = 0; };
  autoscrollBtn.onclick = ()=>{ consoleAutoscroll = !consoleAutoscroll; autoscrollBtn.textContent = `자동스크롤: ${consoleAutoscroll? '켜짐':'꺼짐'}`; };
  refreshBtn.onclick = ()=> refreshStatus(root.getAttribute('data-device-id'));
  return consoleModal;
}

function openConsole(device){
  const m = ensureConsole();
  m.title.textContent = `동기화 로그 - ${device.name}`;
  m.deviceTag.textContent = `${device.name} (${device.id})`;
  m.statusTag.textContent = `status: ${device.last_sync_status ?? '-'}`;
  m.out.textContent = '';
  lastSeq = 0;
  m.root.setAttribute('data-device-id', String(device.id));
  m.root.classList.add('is-active');
  startPolling(device.id);
}

function appendEvents(events){
  if (!events || !events.length) return;
  const m = ensureConsole();
  for (const e of events){
    const line = `[${e.ts}] ${e.level.toUpperCase()} ${e.msg}`;
    const span = document.createElement('span');
    const ts = document.createElement('span'); ts.textContent = `[${e.ts}] `; ts.className = 'ts';
    const lvl = document.createElement('span'); lvl.textContent = `${e.level.toUpperCase()} `; lvl.className = `level-${e.level}`;
    const msg = document.createElement('span'); msg.textContent = e.msg;
    const div = document.createElement('div');
    div.appendChild(ts); div.appendChild(lvl); div.appendChild(msg);
    m.out.appendChild(div);
    lastSeq = e.seq;
  }
  if (consoleAutoscroll) m.out.scrollTop = m.out.scrollHeight;
}

function startPolling(deviceId){
  stopPolling();
  const tick = async ()=>{
    try{
      const { events, last_seq } = await api.syncLogs(deviceId, lastSeq);
      appendEvents(events);
    }catch(err){
      // ignore transient errors
    }finally{
      consolePoller = setTimeout(tick, 1000);
    }
  };
  tick();
}

function stopPolling(){
  if (consolePoller) { clearTimeout(consolePoller); consolePoller = null; }
}

async function refreshStatus(deviceId){
  try{
    const d = await api.syncStatus(deviceId);
    const m = ensureConsole();
    m.statusTag.textContent = `status: ${d.last_sync_status ?? '-'}`;
  }catch(err){ /* ignore */ }
}

// --- Navbar notice stream (lightweight) ---
async function streamLogsToNavbar(deviceId, durationMs = 10000){
  let seq = 0;
  const startedAt = Date.now();
  const pump = async()=>{
    if (Date.now() - startedAt > durationMs) return; // stop after duration
    try{
      const { events } = await api.syncLogs(deviceId, seq);
      if (events && events.length){
        seq = events[events.length-1].seq;
        for (const e of events){
          const lvl = e.level === 'error' ? 'error' : 'info';
          window.pushNotice && window.pushNotice(`${e.msg}`, lvl, 3000);
        }
      }
    }catch(err){ /* ignore */ }
    setTimeout(pump, 1000);
  };
  pump();
}

