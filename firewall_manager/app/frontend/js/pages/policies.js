import { api } from "../api.js";
import { showObjectDetailModal } from '../components/objectDetailModal.js';
import { DualFilter } from '../components/dualFilter.js';

let policyGridApi;
let allDevices = [];
let validObjectNames = new Set();

function objectCellRenderer(params) {
    if (!params.value) return '';
    const deviceId = params.data.device_id;
    const objectNames = params.value.split(',').map(s => s.trim()).filter(Boolean);

    const container = document.createElement('div');
    container.style.height = '100%';
    container.style.maxHeight = '150px'
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

    const commonFilterParams = {
        buttons: ['apply', 'reset'],
    };

    const dualFilterParams = {
        ...commonFilterParams,
        applyValueSearch: () => searchAndLoadPolicies(),
    };

    const columnDefs = [
        { field: 'device_name', headerName: '장비', width: 150, filter: 'agTextColumnFilter', pinned: 'left', filterParams: commonFilterParams },
        { field: 'seq', headerName: '순서', width: 90, sort: 'asc', filter: false },
        { field: 'vsys', headerName: '가상시스템', width: 120, filter: 'agTextColumnFilter', filterParams: commonFilterParams },
        { field: 'rule_name', headerName: '정책명', minWidth: 250, maxWidth: 400, filter: DualFilter, filterParams: dualFilterParams },
        { field: 'enable', headerName: '활성화', width: 100, filter: false, valueFormatter: p => p.value === true ? '활성' : p.value === false ? '비활성' : '' },
        { field: 'action', headerName: '액션', width: 110, filter: 'agTextColumnFilter', filterParams: commonFilterParams },
        {
            field: 'source', headerName: '출발지', minWidth: 250, maxWidth: 400, wrapText: true, autoHeight: true,
            cellRenderer: objectCellRenderer, filter: DualFilter, filterParams: dualFilterParams
        },
        {
            field: 'user', headerName: '사용자', minWidth: 250, wrapText: true, autoHeight: true,
            cellRenderer: objectCellRenderer, filter: 'agTextColumnFilter', filterParams: commonFilterParams
        },
        {
            field: 'destination', headerName: '목적지', minWidth: 250, maxWidth: 400, wrapText: true, autoHeight: true,
            cellRenderer: objectCellRenderer, filter: DualFilter, filterParams: dualFilterParams
        },
        {
            field: 'service', headerName: '서비스', minWidth: 250, maxWidth: 400, wrapText: true, autoHeight: true,
            cellRenderer: objectCellRenderer, filter: DualFilter, filterParams: dualFilterParams
        },
        {
            field: 'application', headerName: '애플리케이션', minWidth: 250, wrapText: true, autoHeight: true,
            cellRenderer: objectCellRenderer, filter: 'agTextColumnFilter', filterParams: commonFilterParams
        },
        { field: 'security_profile', headerName: '보안프로파일', width: 180, filter: 'agTextColumnFilter', filterParams: commonFilterParams },
        { field: 'category', headerName: '카테고리', width: 140, filter: 'agTextColumnFilter', filterParams: commonFilterParams },
        { field: 'description', headerName: '설명', minWidth: 300, maxWidth: 1000, filter: 'agTextColumnFilter', filterParams: commonFilterParams },
        { field: 'last_hit_date', headerName: '마지막매칭일시', minWidth: 200, filter: 'agDateColumnFilter', filterParams: commonFilterParams },
    ];

    const options = {
        columnDefs,
        rowData: [],
        defaultColDef: { resizable: true, sortable: true, filter: true },
        autoSizeStrategy: { type: 'fitGridWidth', defaultMaxWidth: 400 },
        enableCellTextSelection: true,
        getRowId: params => String(params.data.id),
        onGridReady: params => {
            policyGridApi = params.api;
        },
        onFirstDataRendered: params => params.api.autoSizeAllColumns(),
        pagination: true,
        paginationPageSize: 50,
        enableFilterHandlers: true, // Enable filter buttons
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
    const sel = document.getElementById('policy-device-select');
    const deviceIds = Array.from(sel?.selectedOptions || []).map(o => parseInt(o.value, 10)).filter(Boolean);
    if (!deviceIds.length) {
        if (policyGridApi) {
            policyGridApi.setRowData([]);
        }
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
            policyGridApi.setRowData(rows);
            policyGridApi.refreshCells({ force: true });
        }
    }
}

function buildSearchPayload(deviceIds) {
    const payload = { device_ids: deviceIds };
    const filterModel = policyGridApi?.getFilterModel() || {};

    const splitCsv = (val) => (val || '').split(',').map(s => s.trim()).filter(Boolean);

    for (const [field, model] of Object.entries(filterModel)) {
        if (!model) continue;

        if (model.filterType === 'values') {
            // DualFilter in 'values' mode
            const values = splitCsv(model.filter);
            if (values.length > 0) {
                if (field === 'source') payload.src_ips = values;
                else if (field === 'destination') payload.dst_ips = values;
                else if (field === 'service') payload.services = values;
                else if (field === 'rule_name') payload.rule_name = model.filter; // rule_name uses raw comma-separated string
            }
        } else if (model.filterType === 'text') {
            // DualFilter in 'text' mode, or standard agTextColumnFilter
            // This is client-side, so no payload needed
        } else if (model.filterType === 'date') {
            // Standard agDateColumnFilter
            if (model.type === 'inRange') {
                 if (field === 'last_hit_date') {
                    payload.last_hit_date_from = model.dateFrom;
                    payload.last_hit_date_to = model.dateTo;
                }
            }
        } else {
             // Standard agTextColumnFilter (without explicit filterType)
            if (model.type === 'contains' && model.filter) {
                 if (field === 'vsys') payload.vsys = model.filter;
                 else if (field === 'action') payload.action = model.filter;
                 // other text fields...
            }
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
            if (sel.tomselect) { try { sel.tomselect.destroy(); } catch { } }
            new window.TomSelect(sel, {
                placeholder: '장비 선택',
                plugins: ['remove_button'],
                maxOptions: null,
            });
        }
    } catch { }

    const bind = () => {
        const btnReset = document.getElementById('btn-reset');
        const btnExport = document.getElementById('btn-export-excel');

        if (btnReset) {
            btnReset.onclick = () => {
                if (policyGridApi) {
                    policyGridApi.setFilterModel(null);
                }
                // When resetting filters, we need to re-fetch data for the selected devices
                searchAndLoadPolicies();
            };
        }
        if (btnExport) {
            btnExport.onclick = () => exportToExcel();
        }

        sel.onchange = () => {
            if (policyGridApi) {
                policyGridApi.setFilterModel(null); // Clear filters on device change
            }
            searchAndLoadPolicies();
        };
    };
    bind();

    async function exportToExcel() {
        if (!policyGridApi) {
            alert('데이터가 없습니다.');
            return;
        }
        try {
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
}
