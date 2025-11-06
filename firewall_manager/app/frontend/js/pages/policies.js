import { api } from "../api.js";
import { showObjectDetailModal } from '../components/objectDetailModal.js';
import { createDualFilter } from '../components/dualFilter.js';

let policyGridApi;
let allDevices = []; // 장비 목록 저장
let validObjectNames = new Set(); // 유효한 객체 이름 저장

function objectCellRenderer(params) {
    if (!params.value) return '';
    const deviceId = params.data.device_id;
    const objectNames = params.value.split(',').map(s => s.trim()).filter(Boolean);

    const container = document.createElement('div');
    container.style.maxHeight = '150px';
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
    {
      field: 'device_name', headerName: '장비', width: 150, filter: 'agTextColumnFilter', pinned: 'left',
      filterParams: { buttons: ['apply', 'reset'] }
    },
    { field: 'seq', headerName: '순서', width: 90, sort: 'asc', filter: false },
    {
      field: 'vsys', headerName: '가상시스템', width: 120, filter: 'agTextColumnFilter',
      filterParams: { buttons: ['apply', 'reset'] }
    },
    {
      field: 'rule_name', headerName: '정책명', minWidth: 250,
      filter: createDualFilter,
      filterParams: { buttons: ['apply', 'reset'], applyValueSearch: () => searchAndLoadPolicies() }
    },
    { field: 'enable', headerName: '활성화', width: 100, filter: false, valueFormatter: p => p.value === true ? '활성' : p.value === false ? '비활성' : '' },
    {
      field: 'action', headerName: '액션', width: 110, filter: 'agTextColumnFilter',
      filterParams: { buttons: ['apply', 'reset'] }
    },
    {
      field: 'source', headerName: '출발지', minWidth: 250, wrapText: true, cellRenderer: objectCellRenderer,
      filter: createDualFilter,
      filterParams: { buttons: ['apply', 'reset'], applyValueSearch: () => searchAndLoadPolicies() }
    },
    {
      field: 'user', headerName: '사용자', minWidth: 250, wrapText: true, cellRenderer: objectCellRenderer,
      filter: 'agTextColumnFilter',
      filterParams: { buttons: ['apply', 'reset'] }
    },
    {
      field: 'destination', headerName: '목적지', minWidth: 250, wrapText: true, cellRenderer: objectCellRenderer,
      filter: createDualFilter,
      filterParams: { buttons: ['apply', 'reset'], applyValueSearch: () => searchAndLoadPolicies() }
    },
    {
      field: 'service', headerName: '서비스', minWidth: 250, wrapText: true, cellRenderer: objectCellRenderer,
      filter: createDualFilter,
      filterParams: { buttons: ['apply', 'reset'], applyValueSearch: () => searchAndLoadPolicies() }
    },
    {
      field: 'application', headerName: '애플리케이션', minWidth: 250, wrapText: true, cellRenderer: objectCellRenderer,
      filter: 'agTextColumnFilter',
      filterParams: { buttons: ['apply', 'reset'] }
    },
    { field: 'security_profile', headerName: '보안프로파일', width: 180, filter: false },
    { field: 'category', headerName: '카테고리', width: 140, filter: 'agTextColumnFilter', filterParams: { buttons: ['apply', 'reset'] } },
    { field: 'description', headerName: '설명', minWidth: 300, filter: 'agTextColumnFilter', filterParams: { buttons: ['apply', 'reset'] } },
    { field: 'last_hit_date', headerName: '마지막매칭일시', minWidth: 200, filter: false },
  ]);

  const options = {
    columnDefs: getCols(),
    rowData: [],
    defaultColDef: { resizable: true, sortable: true, filter: true },
    autoSizeStrategy: { type: 'fitGridWidth', defaultMaxWidth: 400 },
    enableCellTextSelection: true,
    getRowId: params => String(params.data.id),
    enableFilterHandlers: true,
    onGridReady: params => { policyGridApi = params.api; },
    onFirstDataRendered: params => params.api.autoSizeAllColumns(),
    pagination: true,
    paginationPageSize: 50,
    suppressRowClickSelection: true,
  };

  if (typeof agGrid !== 'undefined') {
    policyGridApi = agGrid.createGrid(gridDiv, options);
  }
}

async function loadDevicesIntoSelect() {
  const sel = document.getElementById('policy-device-select');
  if (!sel) return;
  try {
    allDevices = await api.listDevices();
    if (!allDevices || allDevices.length === 0) {
      sel.innerHTML = `<option value="">등록된 장비 없음</option>`;
      return;
    }
    sel.innerHTML = allDevices.map(d => `<option value="${d.id}">${d.name} (${d.vendor})</option>`).join('');
  } catch {
    sel.innerHTML = `<option value="">장비 불러오기 실패</option>`;
  }
}

async function searchAndLoadPolicies() {
  if (policyGridApi) {
    policyGridApi.showLoadingOverlay();
  }
  try {
    const sel = document.getElementById('policy-device-select');
    const deviceIds = Array.from(sel?.selectedOptions || []).map(o => parseInt(o.value, 10)).filter(Boolean);
    if (!deviceIds.length) {
      if (policyGridApi) policyGridApi.setGridOption('rowData', []);
      return;
    }

    const payload = buildSearchPayload(deviceIds);
    const response = await api.searchPolicies(payload);

    if (response && Array.isArray(response.policies)) {
      validObjectNames = new Set(response.valid_object_names || []);
      const rows = response.policies.map((r, idx) => {
        const device = allDevices.find(d => d.id === r.device_id);
        const deviceName = device ? device.name : `장비 ${r.device_id}`;
        return { ...r, _seq_row: idx + 1, device_name: deviceName };
      });
      if (policyGridApi) {
        policyGridApi.setGridOption('rowData', rows);
        policyGridApi.refreshCells({ force: true });
      }
    }
  } finally {
    if (policyGridApi) {
      policyGridApi.hideOverlay();
    }
  }
}

function buildSearchPayload(deviceIds) {
  const filterModel = policyGridApi ? policyGridApi.getFilterModel() : {};
  const payload = { device_ids: deviceIds };

  const serverSideTextFilters = ['device_name', 'vsys', 'action', 'user', 'application', 'category', 'description'];
  const serverSideValueFilters = {
    'rule_name': 'rule_name',
    'source': 'src_ips',
    'destination': 'dst_ips',
    'service': 'services'
  };

  for (const colId in filterModel) {
    const model = filterModel[colId];
    if (serverSideValueFilters[colId] && model.filterType === 'values' && model.values?.length > 0) {
      payload[serverSideValueFilters[colId]] = model.values;
    } else if (model.filterType === 'text' && model.filter) {
      // For dualFilter, text search is also server-side
      if (serverSideValueFilters[colId]) {
         payload[serverSideValueFilters[colId]] = [model.filter];
      }
    } else if (serverSideTextFilters.includes(colId) && model.filter) {
      payload[colId] = model.filter;
    }
  }
  return payload;
}

export async function initPolicies() {
  await initGrid();
  await loadDevicesIntoSelect();
  const sel = document.getElementById('policy-device-select');
  if (!sel) return;

  try {
    if (window.TomSelect && sel) {
      if (sel.tomselect) { try { sel.tomselect.destroy(); } catch {} }
      new window.TomSelect(sel, {
        placeholder: '장비 선택',
        plugins: ['remove_button'],
        maxOptions: null,
      });
    }
  } catch {}

  const bind = () => {
    const btnReset = document.getElementById('btn-reset');
    const btnExport = document.getElementById('btn-export-excel');

    if (btnReset) btnReset.onclick = () => {
      if (policyGridApi) {
        policyGridApi.setFilterModel(null);
      }
      searchAndLoadPolicies();
    };
    if (btnExport) btnExport.onclick = () => exportToExcel();
    sel.onchange = () => searchAndLoadPolicies();
  };
  bind();

  async function exportToExcel() {
    if (!policyGridApi) return;
    try {
      const rowData = [];
      policyGridApi.forEachNodeAfterFilter(node => rowData.push(node.data));
      if (rowData.length === 0) return alert('내보낼 데이터가 없습니다.');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      await api.exportToExcel(rowData, `policies_${timestamp}`);
    } catch (error) {
      alert(`내보내기 실패: ${error.message}`);
    }
  }
}
