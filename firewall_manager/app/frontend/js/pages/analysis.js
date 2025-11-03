
import { api } from '../api.js';

let resultGridApi = null;
let deviceSelect = null;
let statusInterval = null;

function getColumnDefs(analysisType) {
    const commonColumns = [
        { field: 'policy.seq', headerName: 'Seq', width: 80, valueGetter: params => params.data.policy?.seq },
        { field: 'policy.rule_name', headerName: '규칙 이름', minWidth: 200, filter: 'agTextColumnFilter', valueGetter: params => params.data.policy?.rule_name },
        { field: 'policy.source', headerName: '출발지', minWidth: 250, filter: 'agTextColumnFilter', valueGetter: params => params.data.policy?.source },
        { field: 'policy.destination', headerName: '목적지', minWidth: 250, filter: 'agTextColumnFilter', valueGetter: params => params.data.policy?.destination },
        { field: 'policy.service', headerName: '서비스', minWidth: 200, filter: 'agTextColumnFilter', valueGetter: params => params.data.policy?.service },
        { field: 'policy.action', headerName: 'Action', width: 100, valueGetter: params => params.data.policy?.action },
        { field: 'policy.description', headerName: '설명', minWidth: 300, filter: 'agTextColumnFilter', valueGetter: params => params.data.policy?.description }
    ];

    if (analysisType === 'redundancy') { // 서버에서 사용하는 실제 값으로 변경
        return [
            { field: 'set_number', headerName: 'No', width: 80, sort: 'asc' },
            { field: 'type', headerName: '구분', width: 100 },
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
            rowData: rowData,
            defaultColDef: {
                sortable: true,
                resizable: true,
                filter: true,
            },
            pagination: true,
            paginationPageSize: 50,
            enableCellTextSelection: true,
            rowSelection: 'multiple',
            onGridReady: (params) => {
                resultGridApi = params.api;
            },
            onFirstDataRendered: (params) => {
                params.api.autoSizeAllColumns();
            }
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

function updateStatusLog(message) {
    const statusContainer = document.getElementById('analysis-status-container');
    const statusText = document.getElementById('analysis-status-text');
    if (statusContainer.style.display === 'none') {
        statusContainer.style.display = 'block';
    }
    const timestamp = new Date().toLocaleTimeString();
    statusText.innerHTML += `<p class="is-size-7 has-text-grey">[${timestamp}] ${message}</p>`;
    statusText.scrollTop = statusText.scrollHeight;
}

function resetStatusUI() {
    stopPolling();
    const statusContainer = document.getElementById('analysis-status-container');
    const statusText = document.getElementById('analysis-status-text');
    const resultBox = document.getElementById('analysis-result-box');
    const startButton = document.getElementById('btn-start-analysis');

    if (statusText) statusText.innerHTML = '';
    if (statusContainer) statusContainer.style.display = 'none';
    if (resultBox) resultBox.style.display = 'none';
    if (startButton) {
        startButton.disabled = false;
        startButton.classList.remove('is-loading');
    }
    if (resultGridApi) {
        try { resultGridApi.destroy(); } catch (e) {}
        resultGridApi = null;
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
function displayResults(resultData, analysisType) {
    resetStatusUI();
    const resultBox = document.getElementById('analysis-result-box');
    if(resultData && resultData.length > 0) {
        const columnDefs = getColumnDefs(analysisType);
        createGrid(columnDefs, resultData);
        if (resultBox) resultBox.style.display = 'block';
    } else {
        if (resultBox) resultBox.style.display = 'none';
    }
}

async function displayTaskResults(taskId) {
    try {
        updateStatusLog('분석 결과를 가져오는 중...');
        const results = await api.getAnalysisResults(taskId);
        displayResults(results, 'redundancy');
        updateStatusLog('결과 표시 완료.');
    } catch (error) {
        console.error('결과를 가져오는 데 실패했습니다:', error);
        updateStatusLog(`결과 로딩 실패: ${error.message}`);
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
                    updateStatusLog(`분석 진행 중... (상태: ${task.task_status}, 단계: ${task.task_step || 'N/A'})`);
                    break;
                case 'success':
                    stopPolling();
                    updateStatusLog('분석 성공.');
                    await displayTaskResults(task.id); // 태스크 결과 조회 및 표시
                    break;
                case 'failure':
                    stopPolling();
                    updateStatusLog(`분석 실패. (Task ID: ${task.id})`);
                    break;
                case 'pending':
                    updateStatusLog(`분석 대기 중... (상태: ${task.task_status})`);
                    break;
            }
        } catch (error) {
            stopPolling();
            console.error('상태 조회 실패:', error);
            updateStatusLog('상태 조회 실패.');
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
    updateStatusLog('분석 시작을 요청합니다...');
    try {
        await api.startAnalysis(deviceId);
        startPolling(deviceId);
    } catch (error) {
        console.error('분석 시작 실패:', error);
        updateStatusLog(`분석 시작 실패: ${error.message}`);
        stopPolling();
    }
}

async function loadLatestResult() {
    const deviceId = deviceSelect.getValue();
    const analysisTypeEl = document.getElementById('analysis-type-select');
    // 현재는 '중복 정책 분석'만 지원하므로, 실제 API가 요구하는 'redundancy' 값으로 하드코딩
    const analysisType = 'redundancy';

    if (!deviceId) {
        resetStatusUI();
        return;
    }

    try {
        const latestResult = await api.getLatestAnalysisResult(deviceId, analysisType);
        if (latestResult && latestResult.result_data) {
            displayResults(latestResult.result_data, latestResult.analysis_type);
        } else {
             resetStatusUI();
        }
    } catch (error) {
        if (error.message.includes('404')) {
             resetStatusUI(); // 404는 결과가 없는 것이므로 UI 초기화
        } else {
            console.error('최신 분석 결과 로드 실패:', error);
        }
    }
}

async function exportToExcel() {
    if (!resultGridApi) {
      alert('데이터가 없습니다.');
      return;
    }
    try {
      const rowData = [];
      resultGridApi.forEachNodeAfterFilter((node) => {
        rowData.push(node.data);
      });
      if (rowData.length === 0) {
        alert('내보낼 데이터가 없습니다.');
        return;
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      await api.exportToExcel(rowData, `analysis_result_${timestamp}`);
    } catch (error) {
      alert(`내보내기 실패: ${error.message}`);
    }
}

export async function initAnalysis() {
    await loadDevices();

    const startButton = document.getElementById('btn-start-analysis');
    if (startButton) {
        startButton.addEventListener('click', startAnalysis);
    }

    const exportButton = document.getElementById('btn-export-excel');
    if (exportButton) {
        exportButton.addEventListener('click', exportToExcel);
    }

    // 페이지 초기 로드 시 첫 번째 장비의 최신 결과를 불러옴
    await loadLatestResult();
}
