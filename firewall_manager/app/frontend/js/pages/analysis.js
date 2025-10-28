import { api } from "../api.js";

let gridDup, gridShadow, gridWide, gridUnused;

function createGrid(el, columnDefs){
  const options = {
    columnDefs,
    rowData: [],
    defaultColDef: { resizable:true, sortable:false, filter:true },
    pagination: true,
    paginationPageSize: 50,
  };
  if (agGrid.createGrid) return agGrid.createGrid(el, options);
  const grid = new agGrid.Grid(el, options); return options.api;
}

function dupCols(){
  return [
    { field:'device_id', headerName:'장비ID', width:100 },
    { field:'vsys', headerName:'가상시스템', width:120 },
    { field:'action', headerName:'액션', width:110 },
    { field:'enable', headerName:'활성', width:90 },
    { field:'key_summary', headerName:'조건요약', flex:1, minWidth:250 },
    { field:'rule_names', headerName:'정책들', flex:1, minWidth:250, valueFormatter:p=>Array.isArray(p.value)?p.value.join(', '):p.value },
  ];
}

function shadowCols(){
  return [
    { field:'device_id', headerName:'장비ID', width:100 },
    { field:'vsys', headerName:'가상시스템', width:120 },
    { field:'action', headerName:'액션', width:110 },
    { field:'shadowed_rule_name', headerName:'차단된정책', flex:1, minWidth:200 },
    { field:'by_rule_name', headerName:'상위정책', flex:1, minWidth:200 },
  ];
}

function wideCols(){
  return [
    { field:'device_id', headerName:'장비ID', width:100 },
    { field:'vsys', headerName:'가상시스템', width:120 },
    { field:'rule_name', headerName:'정책명', flex:1, minWidth:200 },
    { field:'reasons', headerName:'사유', flex:1, minWidth:220, valueFormatter:p=>Array.isArray(p.value)?p.value.join(', '):p.value },
  ];
}

function unusedCols(){
  return [
    { field:'device_id', headerName:'장비ID', width:100 },
    { field:'vsys', headerName:'가상시스템', width:120 },
    { field:'rule_name', headerName:'정책명', flex:1, minWidth:200 },
    { field:'last_hit_date', headerName:'마지막매칭일시', width:190 },
    { field:'days_since_last_hit', headerName:'지난일수', width:120 },
  ];
}

function buildPayload(deviceIds){
  const g = id => document.getElementById(id);
  const b = id => !!g(id)?.checked;
  const num = (id, def) => {
    const v = parseInt(g(id)?.value || `${def}`, 10);
    return Number.isFinite(v) ? v : def;
  };
  return {
    device_ids: deviceIds,
    find_duplicates: b('opt-dup'),
    find_shadow: b('opt-shadow'),
    find_wide: b('opt-wide'),
    find_unused: b('opt-unused'),
    enabled_only: b('opt-enabled-only'),
    unused_days: num('opt-unused-days', 90),
    wide_cidr_max_prefix: num('opt-wide-cidr', 16),
  };
}

function bindTabs(){
  const tabs = document.querySelectorAll('.tabs li');
  tabs.forEach(li => {
    li.addEventListener('click', ()=>{
      tabs.forEach(x=>x.classList.remove('is-active'));
      li.classList.add('is-active');
      const key = li.dataset.tab;
      document.querySelectorAll('[id^="tab-"]').forEach(el => el.classList.add('is-hidden'));
      const tgt = document.getElementById(`tab-${key}`);
      if (tgt) tgt.classList.remove('is-hidden');
    });
  });
}

async function runAnalysis(){
  const sel = document.getElementById('analysis-device-select');
  const deviceIds = Array.from(sel?.selectedOptions || []).map(o=>parseInt(o.value,10)).filter(Boolean);
  if (!deviceIds.length){
    alert('장비를 선택하세요.');
    return;
  }
  const payload = buildPayload(deviceIds);
  const res = await api.analyzePolicies(payload);
  if (gridDup) { const rows = (res.duplicates||[]); if (gridDup.setGridOption) gridDup.setGridOption('rowData', rows); else gridDup.setRowData(rows); }
  if (gridShadow) { const rows = (res.shadowed||[]); if (gridShadow.setGridOption) gridShadow.setGridOption('rowData', rows); else gridShadow.setRowData(rows); }
  if (gridWide) { const rows = (res.wide||[]); if (gridWide.setGridOption) gridWide.setGridOption('rowData', rows); else gridWide.setRowData(rows); }
  if (gridUnused) { const rows = (res.unused||[]); if (gridUnused.setGridOption) gridUnused.setGridOption('rowData', rows); else gridUnused.setRowData(rows); }
}

async function exportAnalysis(){
  const activeTab = document.querySelector('.tabs li.is-active')?.dataset.tab || 'dup';
  const apiGrid = ({dup:gridDup, shadow:gridShadow, wide:gridWide, unused:gridUnused})[activeTab];
  if (!apiGrid){ alert('데이터가 없습니다.'); return; }
  const rowData = [];
  try {
    if (apiGrid.forEachNodeAfterFilter){
      apiGrid.forEachNodeAfterFilter(node=>rowData.push(node.data));
    } else if (apiGrid.getDisplayedRowAtIndex){
      const count = apiGrid.getDisplayedRowCount?.() || 0;
      for (let i=0;i<count;i++){ rowData.push(apiGrid.getDisplayedRowAtIndex(i)?.data); }
    }
  } catch {}
  if (!rowData.length){ alert('내보낼 데이터가 없습니다.'); return; }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  await api.exportToExcel(rowData, `analysis_${activeTab}_${timestamp}`);
}

async function loadDevices(){
  const sel = document.getElementById('analysis-device-select');
  const devices = await api.listDevices();
  if (!devices?.length){ sel.innerHTML = `<option value="">등록된 장비 없음</option>`; return; }
  sel.innerHTML = devices.map(d=>`<option value="${d.id}">${d.name} (${d.vendor})</option>`).join('');
  try {
    if (window.TomSelect && sel) {
      if (sel.tomselect) { try { sel.tomselect.destroy(); } catch {} }
      sel.tomselect = new window.TomSelect(sel, { placeholder:'장비 선택', plugins:['remove_button'], maxOptions:null });
    }
  } catch {}
  // auto-select up to 2
  const opts = Array.from(sel.options||[]);
  if (opts.length>0 && !opts.some(o=>o.selected)) { opts.slice(0, Math.min(2, opts.length)).forEach(o=>o.selected=true); }
}

export async function initAnalysis(){
  // Build grids
  gridDup = createGrid(document.getElementById('tab-dup'), dupCols());
  gridShadow = createGrid(document.getElementById('tab-shadow'), shadowCols());
  gridWide = createGrid(document.getElementById('tab-wide'), wideCols());
  gridUnused = createGrid(document.getElementById('tab-unused'), unusedCols());

  bindTabs();
  await loadDevices();

  const btnRun = document.getElementById('btn-run-analysis');
  const btnExport = document.getElementById('btn-export-analysis');
  if (btnRun) btnRun.onclick = () => runAnalysis();
  if (btnExport) btnExport.onclick = () => exportAnalysis();

  // auto run once
  await runAnalysis();
}

