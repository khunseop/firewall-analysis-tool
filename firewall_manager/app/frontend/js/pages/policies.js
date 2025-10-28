import { api } from "../api.js";

let policyGridApi;

async function initGrid() {
  const gridDiv = document.getElementById('policies-grid');
  if (!gridDiv) return;
  const getCols = () => ([
    { field:'id', headerName:'ID', width:80 },
    { field:'rule_name', headerName:'Rule', flex:1 },
    { field:'source', headerName:'출발지', width:160 },
    { field:'destination', headerName:'목적지', width:160 },
    { field:'service', headerName:'서비스', width:160 },
    { field:'action', headerName:'액션', width:120 },
    { field:'last_hit_date', headerName:'Last Hit', width:180 },
  ]);
  const options = { columnDefs: getCols(), rowData: [], defaultColDef:{ resizable:true, sortable:true, filter:true } };
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

async function loadPolicies(deviceId){
  if (!deviceId) return;
  const data = await apiRequest(`/firewall/${deviceId}/policies`);
  if (policyGridApi) {
    if (typeof policyGridApi.setGridOption==='function') policyGridApi.setGridOption('rowData', data);
    else if (typeof policyGridApi.setRowData==='function') policyGridApi.setRowData(data);
  }
}

async function apiRequest(path){
  const res = await fetch(`/api/v1${path}`);
  if (!res.ok) throw new Error('Failed to fetch');
  return res.json();
}

export async function initPolicies(){
  await initGrid();
  await loadDevicesIntoSelect();
  const sel = document.getElementById('policy-device-select');
  if (!sel) return;
  // Initialize Tom Select if available (local vendor)
  try {
    if (window.TomSelect) {
      if (sel._tomSelect) { try { sel._tomSelect.destroy(); } catch {} }
      sel._tomSelect = new window.TomSelect(sel, { placeholder: '장비 검색' });
    }
  } catch {}
  // Bind change to load policies
  sel.onchange = () => {
    try { localStorage.setItem('policy-selected-device-id', sel.value || ''); } catch {}
    loadPolicies(sel.value);
  };
  // Select first device by default
  try {
    const saved = localStorage.getItem('policy-selected-device-id');
    if (saved && Array.from(sel.options).some(o=>o.value===saved)) sel.value = saved;
  } catch {}
  if (!sel.value && sel.options && sel.options.length > 0) sel.value = sel.options[0].value;
  if (sel.value) loadPolicies(sel.value);
}


