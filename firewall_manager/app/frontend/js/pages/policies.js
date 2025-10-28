import { api } from "../api.js";

let policyGridApi;

async function initGrid() {
  const gridDiv = document.getElementById('policies-grid');
  if (!gridDiv) return;
  const getCols = () => ([
    { field:'seq', headerName:'seq', width:90, sort:'asc' },
    { field:'vsys', headerName:'vsys', width:120 },
    { field:'rule_name', headerName:'rule_name', flex:1, minWidth:160 },
    { field:'enable', headerName:'enable', width:100, valueFormatter:p=>p.value===true?'true':p.value===false?'false':'', filter:'agSetColumnFilter' },
    { field:'action', headerName:'action', width:110, filter:'agSetColumnFilter' },
    { field:'source', headerName:'source', width:200, filter:'agTextColumnFilter' },
    { field:'user', headerName:'user', width:140 },
    { field:'destination', headerName:'destination', width:200, filter:'agTextColumnFilter' },
    { field:'service', headerName:'service', width:200, filter:'agTextColumnFilter' },
    { field:'application', headerName:'application', width:150 },
    { field:'security_profile', headerName:'security_profile', width:180 },
    { field:'category', headerName:'category', width:140 },
    { field:'description', headerName:'description', flex:1, minWidth:200 },
    { field:'last_hit_date', headerName:'last_hit_date', width:190, filter:'agDateColumnFilter', valueFormatter:p=>p.value?new Date(p.value).toLocaleString():'' },
  ]);
  const options = { columnDefs: getCols(), rowData: [], defaultColDef:{ resizable:true, sortable:true, filter:true, floatingFilter:true } };
  options.pagination = true;
  options.paginationAutoPageSize = true;
  if (agGrid.createGrid) policyGridApi = agGrid.createGrid(gridDiv, options); else { new agGrid.Grid(gridDiv, options); policyGridApi = options.api; }
}

async function loadDevicesIntoSelect() {
  const sel = document.getElementById('policy-device-select');
  if (!sel) return;
  try {
    const devices = await api.listDevices();
    if (!devices || devices.length === 0) {
      sel.innerHTML = `<option value="">등록된 장비 없음</option>`;
      return;
    }
    sel.innerHTML = devices.map(d=>`<option value="${d.id}">${d.name} (${d.vendor})</option>`).join('');
  } catch {
    sel.innerHTML = `<option value="">장비 불러오기 실패</option>`;
  }
}

async function searchAndLoadPolicies() {
  const sel = document.getElementById('policy-device-select');
  const deviceIds = Array.from(sel?.selectedOptions || []).map(o=>parseInt(o.value,10)).filter(Boolean);
  if (!deviceIds.length) return;

  const payload = buildSearchPayload(deviceIds);
  const data = await api.searchPolicies(payload);
  if (Array.isArray(data)) {
    // Inject seq-based row ID to ensure ordering and avoid showing DB id
    const rows = data.map((r, idx)=>({ ...r, _seq_row: idx+1 }));
    if (policyGridApi) {
      if (typeof policyGridApi.setGridOption==='function') policyGridApi.setGridOption('rowData', rows);
      else if (typeof policyGridApi.setRowData==='function') policyGridApi.setRowData(rows);
    }
  }
}

function buildSearchPayload(deviceIds){
  const g = (id) => document.getElementById(id);
  const dt = (el) => {
    const v = el?.value?.trim();
    if (!v) return null;
    // datetime-local -> ISO string; backend expects RFC3339
    try { return new Date(v).toISOString(); } catch { return null; }
  };
  const b = (v) => v === 'true' ? true : v === 'false' ? false : null;
  return {
    device_ids: deviceIds,
    vsys: g('f-vsys')?.value || null,
    rule_name: g('f-rule')?.value || null,
    action: g('f-action')?.value || null,
    enable: b(g('f-enable')?.value || ''),
    user: g('f-user')?.value || null,
    application: g('f-app')?.value || null,
    security_profile: g('f-secprof')?.value || null,
    category: g('f-category')?.value || null,
    description: g('f-desc')?.value || null,
    last_hit_date_from: dt(g('f-hit-from')),
    last_hit_date_to: dt(g('f-hit-to')),
    src_ip: g('f-src')?.value || null,
    dst_ip: g('f-dst')?.value || null,
    protocol: g('f-proto')?.value || null,
    port: g('f-port')?.value || null,
  };
}

export async function initPolicies(){
  await initGrid();
  await loadDevicesIntoSelect();
  const sel = document.getElementById('policy-device-select');
  if (!sel) return;
  // Initialize Tom Select for multi-select if available
  try {
    if (window.TomSelect) {
      if (sel._tomSelect) { try { sel._tomSelect.destroy(); } catch {} }
      sel._tomSelect = new window.TomSelect(sel, { 
        placeholder: '장비 선택',
        plugins: ['remove_button'],
        maxOptions: null,
      });
    }
  } catch {}

  const bind = () => {
    const btnSearch = document.getElementById('btn-search');
    const btnReset = document.getElementById('btn-reset');
    if (btnSearch) btnSearch.onclick = () => searchAndLoadPolicies();
    if (btnReset) btnReset.onclick = () => { 
      document.querySelectorAll('[id^="f-"]').forEach(el=>{ if (el.tagName==='SELECT') el.value=''; else el.value=''; });
      searchAndLoadPolicies();
    };
    // re-query when device selection changes
    sel.onchange = () => searchAndLoadPolicies();
  };
  bind();

  // Auto-select first two devices (if none saved) and search
  try {
    const options = Array.from(sel.options || []);
    if (options.length > 0 && !options.some(o=>o.selected)) {
      options.slice(0, Math.min(2, options.length)).forEach(o=>o.selected = true);
    }
  } catch {}
  await searchAndLoadPolicies();
}


