import { api } from "../api.js";

let policyGridApi;
let allDevices = []; // 장비 목록 저장

async function initGrid() {
  const gridDiv = document.getElementById('policies-grid');
  if (!gridDiv) return;
  const getCols = () => ([
    { field:'device_name', headerName:'장비', width:150, filter:'agTextColumnFilter', pinned:'left' },
    { field:'seq', headerName:'순서', width:90, sort:'asc' },
    { field:'vsys', headerName:'가상시스템', width:120 },
    { field:'rule_name', headerName:'정책명', flex:1, minWidth:160 },
    { field:'enable', headerName:'활성화', width:100, valueFormatter:p=>p.value===true?'활성':p.value===false?'비활성':'' },
    { field:'action', headerName:'액션', width:110 },
    { field:'source', headerName:'출발지', width:200 },
    { field:'user', headerName:'사용자', width:140 },
    { field:'destination', headerName:'목적지', width:200 },
    { field:'service', headerName:'서비스', width:200 },
    { field:'application', headerName:'애플리케이션', width:150 },
    { field:'security_profile', headerName:'보안프로파일', width:180 },
    { field:'category', headerName:'카테고리', width:140 },
    { field:'description', headerName:'설명', flex:1, minWidth:200 },
    { field:'last_hit_date', headerName:'마지막매칭일시', width:190 },
  ]);
  const options = { columnDefs: getCols(), rowData: [], defaultColDef:{ resizable:true, sortable:false, filter:true } };
  options.pagination = true;
  options.paginationPageSize = 50;
  if (agGrid.createGrid) policyGridApi = agGrid.createGrid(gridDiv, options); else { new agGrid.Grid(gridDiv, options); policyGridApi = options.api; }
}

async function loadDevicesIntoSelect() {
  const sel = document.getElementById('policy-device-select');
  if (!sel) return;
  try {
    allDevices = await api.listDevices(); // 전역 변수에 저장
    if (!allDevices || allDevices.length === 0) {
      sel.innerHTML = `<option value="">등록된 장비 없음</option>`;
      return;
    }
    sel.innerHTML = allDevices.map(d=>`<option value="${d.id}">${d.name} (${d.vendor})</option>`).join('');
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
    // Inject seq-based row ID and device_name
    const rows = data.map((r, idx)=>{
      const device = allDevices.find(d => d.id === r.device_id);
      const deviceName = device ? device.name : `장비 ${r.device_id}`;
      return { ...r, _seq_row: idx+1, device_name: deviceName };
    });
    if (policyGridApi) {
      if (typeof policyGridApi.setGridOption==='function') policyGridApi.setGridOption('rowData', rows);
      else if (typeof policyGridApi.setRowData==='function') policyGridApi.setRowData(rows);
    }
  }
}

function buildSearchPayload(deviceIds){
  const g = (id) => document.getElementById(id);
  const b = (v) => v === 'true' ? true : v === 'false' ? false : null;
  const splitCsv = (v) => (v||'').split(',').map(s=>s.trim()).filter(Boolean);
  return {
    device_ids: deviceIds,
    // grid에서 필터링할 기본 컬럼은 요청에서 제외 (간소화)
    src_ips: splitCsv(g('f-src')?.value || ''),
    dst_ips: splitCsv(g('f-dst')?.value || ''),
    services: splitCsv(g('f-svc')?.value || ''),
  };
}

export async function initPolicies(){
  await initGrid();
  await loadDevicesIntoSelect();
  const sel = document.getElementById('policy-device-select');
  if (!sel) return;
  // Initialize Tom Select for device selector only
  try {
    if (window.TomSelect && sel) {
      if (sel.tomselect) { try { sel.tomselect.destroy(); } catch {} }
      sel.tomselect = new window.TomSelect(sel, { 
        placeholder: '장비 선택',
        plugins: ['remove_button'],
        maxOptions: null,
      });
    }
  } catch {}

  const bind = () => {
    const btnSearch = document.getElementById('btn-search');
    const btnReset = document.getElementById('btn-reset');
    const btnExport = document.getElementById('btn-export-excel');
    if (btnSearch) btnSearch.onclick = () => searchAndLoadPolicies();
    if (btnReset) btnReset.onclick = () => { 
      // Reset all filter inputs
      document.querySelectorAll('[id^="f-"]').forEach(el => {
        el.value = '';
      });
      searchAndLoadPolicies();
    };
    if (btnExport) btnExport.onclick = () => exportToExcel();
    // re-query when device selection changes
    sel.onchange = () => searchAndLoadPolicies();
  };
  bind();

  async function exportToExcel() {
    if (!policyGridApi) {
      alert('데이터가 없습니다.');
      return;
    }
    try {
      // Get filtered rows from grid
      const rowData = [];
      policyGridApi.forEachNodeAfterFilter((node) => {
        rowData.push(node.data);
      });
      
      if (rowData.length === 0) {
        alert('내보낼 데이터가 없습니다.');
        return;
      }
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      await api.exportToExcel(rowData, `policies_${timestamp}`);
    } catch (error) {
      alert(`내보내기 실패: ${error.message}`);
    }
  }

  // Auto-select first two devices (if none saved) and search
  try {
    const options = Array.from(sel.options || []);
    if (options.length > 0 && !options.some(o=>o.selected)) {
      options.slice(0, Math.min(2, options.length)).forEach(o=>o.selected = true);
    }
  } catch {}
  await searchAndLoadPolicies();
}


