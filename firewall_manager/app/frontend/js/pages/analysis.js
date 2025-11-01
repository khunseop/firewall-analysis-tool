import { api } from '../api.js';

let resultGrid = null;
let deviceSelect = null;
let statusInterval = null;

// 분석 결과 그리드 컬럼 정의
const resultColumns = [
    { field: 'set_number', headerName: 'No', width: 80, sort: 'asc' },
    { field: 'type', headerName: '구분', width: 100 },
    { field: 'policy.seq', headerName: 'Seq', width: 80 },
    { field: 'policy.rule_name', headerName: '규칙 이름', minWidth: 200, filter: 'agTextColumnFilter' },
    { field: 'policy.source', headerName: '출발지', minWidth: 250, filter: 'agTextColumnFilter' },
    { field: 'policy.destination', headerName: '목적지', minWidth: 250, filter: 'agTextColumnFilter' },
    { field: 'policy.service', headerName: '서비스', minWidth: 200, filter: 'agTextColumnFilter' },
    { field: 'policy.action', headerName: 'Action', width: 100 },
    { field: 'policy.description', headerName: '설명', minWidth: 300, filter: 'agTextColumnFilter' }
];

// 그리드 초기화
function initGrid() {
    if (resultGrid) {
        try { resultGrid.destroy(); } catch (e) { console.warn('Failed to destroy resultGrid:', e); }
        resultGrid = null;
    }
    const gridEl = document.getElementById('analysis-result-grid');
    if (gridEl) {
        resultGrid = agGrid.createGrid(gridEl, {
            columnDefs: resultColumns,
            defaultColDef: {
                sortable: true,
                resizable: true,
                filter: true,
            },
            enableCellTextSelection: true,
            rowSelection: 'multiple',
        });
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

// 상태 업데이트 UI
function updateStatus(message, type = 'info', isLoading = false) {
    const statusContainer = document.getElementById('analysis-status-container');
    const statusText = document.getElementById('analysis-status-text');
    const startButton = document.getElementById('btn-start-analysis');

    if (!statusContainer || !statusText || !startButton) return;

    statusText.textContent = message;
    statusContainer.className = `mt-4 notification is-light is-${type}`;
    statusContainer.style.display = 'block';

    startButton.disabled = isLoading;
    startButton.classList.toggle('is-loading', isLoading);
}

// 상태 폴링 중지
function stopPolling() {
    if (statusInterval) {
        clearInterval(statusInterval);
        statusInterval = null;
    }
}

// 결과 그리드에 데이터 표시
async function displayResults(taskId) {
    try {
        const results = await api.getAnalysisResults(taskId);
        // 정책 객체를 포함하도록 데이터 재구성
        const rowData = results.map(item => ({
            set_number: item.set_number,
            type: item.type,
            policy: item.policy,
        }));
        resultGrid.setGridOption('rowData', rowData);
        setTimeout(() => resultGrid.autoSizeAllColumns(), 100);
    } catch (error) {
        console.error('결과를 가져오는 데 실패했습니다:', error);
        updateStatus(`결과 로딩 실패: ${error.message}`, 'danger');
    }
}

// 상태 폴링 시작
function startPolling(deviceId) {
    stopPolling(); // 기존 폴링이 있다면 중지

    statusInterval = setInterval(async () => {
        try {
            const task = await api.getAnalysisStatus(deviceId);
            switch (task.task_status) {
                case 'in_progress':
                    updateStatus(`[${new Date().toLocaleTimeString()}] 분석이 진행 중입니다... (상태: ${task.task_status})`, 'info', true);
                    break;
                case 'success':
                    stopPolling();
                    updateStatus(`분석이 성공적으로 완료되었습니다. (Task ID: ${task.id})`, 'success');
                    displayResults(task.id);
                    break;
                case 'failure':
                    stopPolling();
                    updateStatus(`분석 중 오류가 발생했습니다. (Task ID: ${task.id})`, 'danger');
                    break;
                case 'pending':
                    updateStatus(`[${new Date().toLocaleTimeString()}] 분석 대기 중... (상태: ${task.task_status})`, 'info', true);
                    break;
            }
        } catch (error) {
            stopPolling();
            console.error('상태 조회 실패:', error);
            updateStatus('상태를 가져오는 데 실패했습니다.', 'danger');
        }
    }, 3000); // 3초마다 상태 확인
}


// 분석 시작
async function startAnalysis() {
    const deviceId = deviceSelect.getValue();
    if (!deviceId) {
        alert('분석할 장비를 선택하세요.');
        return;
    }

    if (resultGrid) {
        resultGrid.setGridOption('rowData', []);
    }

    try {
        updateStatus('분석을 시작합니다...', 'info', true);
        await api.startAnalysis(deviceId);
        startPolling(deviceId);
    } catch (error) {
        console.error('분석 시작 실패:', error);
        updateStatus(`분석 시작 실패: ${error.message}`, 'danger');
        stopPolling();
    }
}

// 초기화
export async function initAnalysis() {
    initGrid();
    await loadDevices();

    const startButton = document.getElementById('btn-start-analysis');
    if (startButton) {
        startButton.addEventListener('click', startAnalysis);
    }
}
