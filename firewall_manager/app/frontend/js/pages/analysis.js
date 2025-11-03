import { api } from '../api.js';

let resultGridApi = null;
let deviceSelect = null;
let statusInterval = null;

// 분석 유형에 따른 컬럼 정의 반환
function getColumnDefs(analysisType) {
    const commonColumns = [
        { field: 'policy.seq', headerName: 'Seq', width: 80 },
        { field: 'policy.rule_name', headerName: '규칙 이름', minWidth: 200, filter: 'agTextColumnFilter' },
        { field: 'policy.source', headerName: '출발지', minWidth: 250, filter: 'agTextColumnFilter' },
        { field: 'policy.destination', headerName: '목적지', minWidth: 250, filter: 'agTextColumnFilter' },
        { field: 'policy.service', headerName: '서비스', minWidth: 200, filter: 'agTextColumnFilter' },
        { field: 'policy.action', headerName: 'Action', width: 100 },
        { field: 'policy.description', headerName: '설명', minWidth: 300, filter: 'agTextColumnFilter' }
    ];

    if (analysisType === '중복 정책 분석') {
        return [
            { field: 'set_number', headerName: 'No', width: 80, sort: 'asc' },
            { field: 'type', headerName: '구분', width: 100 },
            ...commonColumns
        ];
    }
    // 다른 분석 유형에 대한 컬럼 정의 추가 가능
    return commonColumns;
}

// 그리드 생성 및 초기화
function createGrid(columnDefs, rowData) {
    if (resultGridApi) {
        try { resultGridApi.destroy(); } catch (e) { console.warn('Failed to destroy resultGrid:', e); }
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

// 장비 목록 로드
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
            });
        }
    } catch (err) {
        console.error('Failed to load devices:', err);
    }
}

// 상태 로그 업데이트
function updateStatusLog(message) {
    const statusContainer = document.getElementById('analysis-status-container');
    const statusText = document.getElementById('analysis-status-text');

    if (statusContainer.style.display === 'none') {
        statusContainer.style.display = 'block';
    }

    const timestamp = new Date().toLocaleTimeString();
    const newMessage = document.createElement('p');
    newMessage.className = 'is-size-7 has-text-grey';
    newMessage.textContent = `[${timestamp}] ${message}`;

    statusText.appendChild(newMessage);
    statusText.scrollTop = statusText.scrollHeight; // Auto-scroll to bottom
}

// 모든 상태 관련 UI 초기화
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

// 상태 폴링 중지
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

// 결과 표시
async function displayResults(taskId) {
    try {
        updateStatusLog('분석 결과를 가져오는 중...');
        const results = await api.getAnalysisResults(taskId);

        const rowData = results.map(item => ({
            set_number: item.set_number,
            type: item.type,
            policy: item.policy,
        }));

        const analysisType = document.getElementById('analysis-type-select').value;
        const columnDefs = getColumnDefs(analysisType);

        createGrid(columnDefs, rowData);

        const resultBox = document.getElementById('analysis-result-box');
        if (resultBox) resultBox.style.display = 'block';

        updateStatusLog('결과 표시 완료.');

    } catch (error) {
        console.error('결과를 가져오는 데 실패했습니다:', error);
        updateStatusLog(`결과 로딩 실패: ${error.message}`);
    }
}

// 상태 폴링 시작
function startPolling(deviceId) {
    stopPolling();

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
                    displayResults(task.id);
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

// 분석 시작
async function startAnalysis() {
    const deviceId = deviceSelect.getValue();
    if (!deviceId) {
        alert('분석할 장비를 선택하세요.');
        return;
    }

    resetStatusUI();

    const startButton = document.getElementById('btn-start-analysis');
    if (startButton) {
        startButton.disabled = true;
        startButton.classList.add('is-loading');
    }

    try {
        updateStatusLog('분석 시작을 요청합니다...');
        await api.startAnalysis(deviceId);
        startPolling(deviceId);
    } catch (error) {
        console.error('분석 시작 실패:', error);
        updateStatusLog(`분석 시작 실패: ${error.message}`);
        stopPolling();
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

// 초기화
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
}
