import { api } from '../api.js';
import { adjustGridHeight, createGridEventHandlers, createCommonGridOptions } from '../utils/grid.js';
import { exportGridToExcel } from '../utils/export.js';

// ==================== 전역 변수 ====================

let resultGridApi = null;
let deviceSelect = null;
let statusInterval = null;

function getColumnDefs(analysisType) {
    const commonColumns = [
        { field: 'policy.seq', headerName: 'Seq', minWidth: 80, sortable: false, filter: 'agTextColumnFilter', valueGetter: params => params.data.policy?.seq, filterParams: { buttons: ['apply', 'reset'], debounceMs: 200 } },
        { field: 'policy.rule_name', headerName: '규칙 이름', minWidth: 200, sortable: false, filter: 'agTextColumnFilter', valueGetter: params => params.data.policy?.rule_name, filterParams: { buttons: ['apply', 'reset'], debounceMs: 200 } },
        { field: 'policy.source', headerName: '출발지', minWidth: 250, sortable: false, filter: 'agTextColumnFilter', valueGetter: params => params.data.policy?.source, filterParams: { buttons: ['apply', 'reset'], debounceMs: 200 } },
        { field: 'policy.destination', headerName: '목적지', minWidth: 250, sortable: false, filter: 'agTextColumnFilter', valueGetter: params => params.data.policy?.destination, filterParams: { buttons: ['apply', 'reset'], debounceMs: 200 } },
        { field: 'policy.service', headerName: '서비스', minWidth: 200, sortable: false, filter: 'agTextColumnFilter', valueGetter: params => params.data.policy?.service, filterParams: { buttons: ['apply', 'reset'], debounceMs: 200 } },
        { field: 'policy.action', headerName: 'Action', minWidth: 100, sortable: false, filter: 'agTextColumnFilter', valueGetter: params => params.data.policy?.action, filterParams: { buttons: ['apply', 'reset'], debounceMs: 200 } },
        { field: 'policy.description', headerName: '설명', minWidth: 300, sortable: false, filter: 'agTextColumnFilter', valueGetter: params => params.data.policy?.description, filterParams: { buttons: ['apply', 'reset'], debounceMs: 200 } }
    ];

    if (analysisType === 'redundancy') { // 서버에서 사용하는 실제 값으로 변경
        return [
            { field: 'set_number', headerName: 'No', minWidth: 80, sortable: false, filter: 'agTextColumnFilter', filterParams: { buttons: ['apply', 'reset'], debounceMs: 200 } },
            { field: 'type', headerName: '구분', minWidth: 100, sortable: false, filter: 'agTextColumnFilter', filterParams: { buttons: ['apply', 'reset'], debounceMs: 200 } },
            ...commonColumns
        ];
    }
    return commonColumns;
}

function createGrid(columnDefs, rowData) {
    if (resultGridApi) {
        try { resultGridApi.destroy(); } catch (e) {}
        resultGridApi = null;
    }

    const gridEl = document.getElementById('analysis-result-grid');
    if (gridEl) {
        const gridOptions = {
            columnDefs: columnDefs,
            rowData: rowData || [],
            defaultColDef: {
                resizable: true,
                sortable: false,
                filter: true,
            },
            enableCellTextSelection: true,
            getRowId: params => {
                // set_number와 type을 조합하여 고유 ID 생성
                if (params.data.set_number !== undefined && params.data.type) {
                    return `${params.data.set_number}_${params.data.type}_${params.data.policy?.id || params.rowIndex}`;
                }
                return String(params.data.policy?.id || params.rowIndex);
            },
            enableFilterHandlers: true,
            suppressHorizontalScroll: false,
            overlayNoRowsTemplate: '<div style="padding: 20px; text-align: center; color: #666;">분석 결과가 없습니다.</div>',
            pagination: true,
            paginationPageSize: 50,
            paginationPageSizeSelector: [50, 100, 200],
            onGridReady: (params) => {
                resultGridApi = params.api;
                const gridDiv = document.getElementById('analysis-result-grid');
                if (gridDiv) {
                    const handlers = createGridEventHandlers(gridDiv, params.api);
                    Object.assign(gridOptions, handlers);
                }
            },
        };
        resultGridApi = agGrid.createGrid(gridEl, gridOptions);
    }
}

async function loadDevices() {
    try {
        const devices = await api.listDevices();
        const selectEl = document.getElementById('analysis-device-select');
        if (!selectEl) return;

        selectEl.innerHTML = '';
        devices.forEach(dev => {
            const opt = document.createElement('option');
            opt.value = dev.id;
            opt.textContent = `${dev.name} (${dev.ip_address})`;
            selectEl.appendChild(opt);
        });

        if (window.TomSelect && selectEl) {
            if (selectEl.tomselect) {
                try { selectEl.tomselect.destroy(); } catch (e) {}
            }
            deviceSelect = new window.TomSelect(selectEl, {
                placeholder: '분석할 장비를 선택하세요',
                maxOptions: null,
                onChange: () => loadLatestResult() // 장비 변경 시 최신 결과 로드
            });
        }
    } catch (err) {
        console.error('Failed to load devices:', err);
    }
}

function resetStatusUI() {
    stopPolling();
    const startButton = document.getElementById('btn-start-analysis');
    const resetFiltersBtn = document.getElementById('btn-reset-filters');
    const exportBtn = document.getElementById('btn-export-excel');

    if (startButton) {
        startButton.disabled = false;
        startButton.classList.remove('is-loading');
    }
    if (resetFiltersBtn) resetFiltersBtn.style.display = 'none';
    if (exportBtn) exportBtn.style.display = 'none';
    
    // 그리드를 빈 상태로 초기화 (메시지 표시를 위해 그리드는 유지)
    if (resultGridApi) {
        try {
            resultGridApi.setGridOption('rowData', []);
        } catch (e) {
            console.warn('Failed to reset grid data:', e);
        }
    } else {
        // 그리드가 없으면 생성 (빈 상태)
        const columnDefs = getColumnDefs('redundancy');
        createGrid(columnDefs, []);
    }
}

function stopPolling() {
    if (statusInterval) {
        clearInterval(statusInterval);
        statusInterval = null;
    }
    const startButton = document.getElementById('btn-start-analysis');
    if (startButton) {
        startButton.disabled = false;
        startButton.classList.remove('is-loading');
    }
}

// 저장된 결과 또는 태스크 완료 후 결과를 그리드에 표시
function displayResults(resultData, analysisType, source = 'latest') {
    if (source === 'task') {
        resetStatusUI(); // 태스크 완료 시에만 전체 UI 초기화
    }

    // 결과가 있든 없든 그리드를 생성하여 메시지 표시
    const columnDefs = getColumnDefs(analysisType);
    createGrid(columnDefs, resultData || []);
    
    if(resultData && resultData.length > 0) {
        // 버튼 표시
        const resetFiltersBtn = document.getElementById('btn-reset-filters');
        const exportBtn = document.getElementById('btn-export-excel');
        if (resetFiltersBtn) resetFiltersBtn.style.display = 'inline-block';
        if (exportBtn) exportBtn.style.display = 'inline-block';
    } else {
        // 결과가 없을 때는 버튼 숨김
        const resetFiltersBtn = document.getElementById('btn-reset-filters');
        const exportBtn = document.getElementById('btn-export-excel');
        if (resetFiltersBtn) resetFiltersBtn.style.display = 'none';
        if (exportBtn) exportBtn.style.display = 'none';
    }
}

async function displayTaskResults(taskId) {
    try {
        const results = await api.getAnalysisResults(taskId);
        displayResults(results, 'redundancy', 'task');
    } catch (error) {
        console.error('결과를 가져오는 데 실패했습니다:', error);
        alert(`결과 로딩 실패: ${error.message}`);
    }
}

function startPolling(deviceId) {
    stopPolling();
    const startButton = document.getElementById('btn-start-analysis');
    if (startButton) {
        startButton.disabled = true;
        startButton.classList.add('is-loading');
    }
    statusInterval = setInterval(async () => {
        try {
            const task = await api.getAnalysisStatus(deviceId);
            switch (task.task_status) {
                case 'in_progress':
                    // 로그 없이 진행 상태만 표시 (버튼 로딩 상태로 표시)
                    break;
                case 'success':
                    stopPolling();
                    setTimeout(() => displayTaskResults(task.id), 100);
                    break;
                case 'failure':
                    stopPolling();
                    alert(`분석 실패. (Task ID: ${task.id})`);
                    break;
                case 'pending':
                    // 로그 없이 대기 상태만 표시
                    break;
            }
        } catch (error) {
            stopPolling();
            console.error('상태 조회 실패:', error);
            alert('상태 조회 실패.');
        }
    }, 3000);
}

async function startAnalysis() {
    const deviceId = deviceSelect.getValue();
    if (!deviceId) {
        alert('분석할 장비를 선택하세요.');
        return;
    }
    resetStatusUI();
    try {
        await api.startAnalysis(deviceId);
        startPolling(deviceId);
    } catch (error) {
        console.error('분석 시작 실패:', error);
        alert(`분석 시작 실패: ${error.message}`);
        stopPolling();
    }
}

async function loadLatestResult() {
    const deviceId = deviceSelect.getValue();
    // 현재는 '중복 정책 분석'만 지원하므로, 실제 API가 요구하는 'redundancy' 값으로 하드코딩
    const analysisType = 'redundancy';

    if (!deviceId) {
        resetStatusUI();
        return;
    }

    // 새 장비를 선택했으므로 이전 상태와 결과를 초기화
    resetStatusUI();

    try {
        const latestResult = await api.getLatestAnalysisResult(deviceId, analysisType);
        if (latestResult && latestResult.result_data && latestResult.result_data.length > 0) {
            displayResults(latestResult.result_data, latestResult.analysis_type);
        } else {
            resetStatusUI();
        }
    } catch (error) {
        if (error.status !== 404) {
            console.error('최신 분석 결과 로드 실패:', error);
        }
        resetStatusUI();
    }
}

async function exportToExcel() {
    await exportGridToExcel(
        resultGridApi,
        api.exportToExcel,
        'analysis_result',
        '데이터가 없습니다.'
    );
}

export async function initAnalysis() {
    await loadDevices();

    // 초기 그리드 생성 (빈 상태)
    const columnDefs = getColumnDefs('redundancy');
    createGrid(columnDefs, []);

    const startButton = document.getElementById('btn-start-analysis');
    if (startButton) {
        startButton.addEventListener('click', startAnalysis);
    }

    const exportButton = document.getElementById('btn-export-excel');
    if (exportButton) {
        exportButton.addEventListener('click', exportToExcel);
    }

    // 필터 초기화 버튼
    const resetFiltersBtn = document.getElementById('btn-reset-filters');
    if (resetFiltersBtn) {
        resetFiltersBtn.addEventListener('click', () => {
            if (resultGridApi && typeof resultGridApi.setFilterModel === 'function') {
                resultGridApi.setFilterModel(null);
            }
        });
    }

    // 페이지 초기 로드 시 첫 번째 장비의 최신 결과를 불러옴
    await loadLatestResult();
}
