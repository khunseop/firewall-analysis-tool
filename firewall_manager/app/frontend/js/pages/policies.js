import { api } from "../api.js";
import { showObjectDetailModal } from '../components/objectDetailModal.js';

let policyGridApi;
let allDevices = []; // 장비 목록 저장
let validObjectNames = new Set(); // 유효한 객체 이름 저장

// Function to render object links in a cell
function objectCellRenderer(params) {
    if (!params.value) return '';
    const deviceId = params.data.device_id;
    const objectNames = params.value.split(',').map(s => s.trim()).filter(Boolean);

    const container = document.createElement('div');
    container.style.height = '100%';
    container.style.overflowY = 'auto';
    container.style.lineHeight = '1.5';

    objectNames.forEach(name => {
        const line = document.createElement('div');
        if (validObjectNames.has(name)) {
            const link = document.createElement('a');
            link.href = '#';
            link.textContent = name;
            link.style.cursor = 'pointer';
            link.onclick = async (e) => {
                e.preventDefault();
                try {
                    const objectDetails = await api.getObjectDetails(deviceId, name);
                    showObjectDetailModal(objectDetails);
                } catch (error) {
                    alert(`객체 '${name}'의 상세 정보를 가져오는 데 실패했습니다: ${error.message}`);
                }
            };
            line.appendChild(link);
        } else {
            line.textContent = name;
        }
        container.appendChild(line);
    });

    return container;
}


async function initGrid() {
  const gridDiv = document.getElementById('policies-grid');
  if (!gridDiv) return;
  const getCols = () => ([
    { field:'device_name', headerName:'장비', width:150, filter:'agTextColumnFilter', pinned:'left' },
    { field:'seq', headerName:'순서', width:90, sort:'asc' },
    { field:'vsys', headerName:'가상시스템', width:120 },
    { field:'rule_name', headerName:'정책명', minWidth:250, maxWidth: 400 },
    { field:'enable', headerName:'활성화', width:100, valueFormatter:p=>p.value===true?'활성':p.value===false?'비활성':'' },
    { field:'action', headerName:'액션', width:110 },
    {
      field:'source', headerName:'출발지', minWidth:250, maxWidth: 400, wrapText:true,
      cellRenderer: objectCellRenderer
    },
    {
      field:'user', headerName:'사용자', width:140, wrapText:true,
      cellRenderer: params => (params.value || '').replace(/,/g, ',<br>')
    },
    {
      field:'destination', headerName:'목적지', minWidth:250, maxWidth: 400, wrapText:true,
      cellRenderer: objectCellRenderer
    },
    {
      field:'service', headerName:'서비스', minWidth:250, maxWidth: 400, wrapText:true,
      cellRenderer: objectCellRenderer
    },
    {
      field:'application', headerName:'애플리케이션', width:150, wrapText:true,
      cellRenderer: params => (params.value || '').replace(/,/g, ',<br>')
    },
    { field:'security_profile', headerName:'보안프로파일', width:180 },
    { field:'category', headerName:'카테고리', width:140 },
    { field:'description', headerName:'설명', minWidth:300, maxWidth: 500 },
    { field:'last_hit_date', headerName:'마지막매칭일시', width:190 },
  ]);
  const options = {
    columnDefs: getCols(),
    rowData: [],
    defaultColDef:{ resizable:true, sortable:true, filter:true },
    rowHeight: 120, // 5줄 + 여백에 해당하는 높이
    autoSizeStrategy: { type: 'fitCellContents' },
    getRowId: params => String(params.data.id),
    onGridReady: params => {
        policyGridApi = params.api;
    },
    onFirstDataRendered: params => params.api.autoSizeAllColumns(),
  };
  options.pagination = true;
  options.paginationPageSize = 50;

  if (typeof agGrid !== 'undefined') {
      if (agGrid.createGrid) {
          policyGridApi = agGrid.createGrid(gridDiv, options);
      } else {
          new agGrid.Grid(gridDiv, options);
          policyGridApi = options.api;
      }
  }
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
  if (!deviceIds.length) {
    // 선택된 장비가 없으면 그리드를 빈 상태로 초기화
    if (policyGridApi) {
      if (typeof policyGridApi.setGridOption==='function') policyGridApi.setGridOption('rowData', []);
      else if (typeof policyGridApi.setRowData==='function') policyGridApi.setRowData([]);
    }
    return;
  }

  const payload = buildSearchPayload(deviceIds);
  const response = await api.searchPolicies(payload);

  if (response && Array.isArray(response.policies)) {
    // Update the set of valid object names
    validObjectNames = new Set(response.valid_object_names || []);

    // Inject seq-based row ID and device_name
    const rows = response.policies.map((r, idx) => {
      const device = allDevices.find(d => d.id === r.device_id);
      const deviceName = device ? device.name : `장비 ${r.device_id}`;
      return { ...r, _seq_row: idx + 1, device_name: deviceName };
    });

    if (policyGridApi) {
      if (typeof policyGridApi.setGridOption === 'function') {
        policyGridApi.setGridOption('rowData', rows);
      } else if (typeof policyGridApi.setRowData === 'function') {
        policyGridApi.setRowData(rows);
      }
      // Refresh cells to apply the new link logic
      policyGridApi.refreshCells({ force: true });
    }
  }
}

function buildSearchPayload(deviceIds){
  const g = (id) => document.getElementById(id);
  const v = (id) => g(id)?.value?.trim() || null; // 값이 없으면 null 반환
  const splitCsv = (val) => (val || '').split(',').map(s => s.trim()).filter(Boolean);

  const payload = {
    device_ids: deviceIds,
    rule_name: v('f-rule-name'),
    vsys: v('f-vsys'),
    // `source`, `destination`, `service`는 더 이상 Pydantic 모델에 없는 일반 텍스트 필드입니다.
    // 대신 `src_ips`, `dst_ips`, `services`를 사용합니다.
    user: v('f-user'),
    application: v('f-app'),
    description: v('f-desc'),
    action: v('f-action'),
    last_hit_date_from: v('f-hit-from'),
    last_hit_date_to: v('f-hit-to'),
    enable: g('f-enable')?.value === 'true' ? true : g('f-enable')?.value === 'false' ? false : null,

    // Corrected fields for indexed search
    src_ips: splitCsv(v('f-src')),
    dst_ips: splitCsv(v('f-dst')),
    services: splitCsv(v('f-svc')),
  };

  const isAllFiltersEmpty = Object.keys(payload).every(key => {
    if (key === 'device_ids') return !payload[key] || payload[key].length === 0;
    const value = payload[key];
    if (Array.isArray(value)) return value.length === 0;
    return value === null || value === '';
  });

  if (isAllFiltersEmpty && deviceIds.length > 0) {
    payload.limit = 500;
  }

  return payload;
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
      document.querySelectorAll('input[id^="f-"]').forEach(el => {
        el.value = '';
      });
      // Reset ag-grid filters
      if (policyGridApi) {
        if (typeof policyGridApi.setFilterModel==='function') policyGridApi.setFilterModel(null);
      }
      // TomSelect는 별도로 초기화해야 할 수 있지만, 여기서는 간단히 값만 비웁니다.
      // sel.tomselect.clear(); (필요 시)
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

  // 초기 로딩 시 자동 선택/자동 조회를 수행하지 않습니다.
}


