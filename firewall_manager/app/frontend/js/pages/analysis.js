import { api } from '../api.js';
import { showObjectDetailModal } from '../components/objectDetailModal.js';
import { adjustGridHeight, createGridEventHandlers, createCommonGridOptions } from '../utils/grid.js';
import { exportGridToExcelClient } from '../utils/excel.js';
import { showEmptyMessage, hideEmptyMessage } from '../utils/message.js';
import { formatDateTime, formatNumber } from '../utils/date.js';

// ==================== 전역 변수 ====================

let resultGridApi = null;
let deviceSelect = null;
let statusInterval = null;
let allDevices = []; // 장비 목록 저장
let validObjectNames = new Set(); // 유효한 객체 이름 저장

// Function to render object links in a cell (정책조회와 동일)
function objectCellRenderer(params) {
    if (!params.value) return '';
    const deviceId = params.data.policy?.device_id;
    if (!deviceId) return params.value;
    
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

function getColumnDefs(analysisType) {
    // 정책조회와 동일한 컬럼 정의
    const policyColumns = [
        { 
            field: 'seq', 
            headerName: '순서', 
            filter: false,
            sortable: false,
            minWidth: 80,
            valueGetter: params => params.data.policy?.seq,
            valueFormatter: (params) => formatNumber(params.value),
            filterParams: {
                buttons: ['apply', 'reset'],
                debounceMs: 200
            }
        },
        { 
            field: 'vsys', 
            headerName: '가상시스템', 
            filter: 'agTextColumnFilter',
            sortable: false,
            minWidth: 120,
            valueGetter: params => params.data.policy?.vsys,
            filterParams: {
                buttons: ['apply', 'reset'],
                debounceMs: 200
            }
        },
        { 
            field: 'rule_name', 
            headerName: '정책명', 
            filter: 'agTextColumnFilter',
            sortable: false,
            minWidth: 150,
            valueGetter: params => params.data.policy?.rule_name,
            filterParams: {
                buttons: ['apply', 'reset'],
                debounceMs: 200
            }
        },
        { 
            field: 'enable', 
            headerName: '활성화', 
            valueGetter: params => params.data.policy?.enable,
            valueFormatter: p => p.value === true ? '활성' : p.value === false ? '비활성' : '',
            filter: 'agTextColumnFilter',
            sortable: false,
            minWidth: 100,
            filterParams: {
                buttons: ['apply', 'reset'],
                debounceMs: 200
            }
        },
        { 
            field: 'action', 
            headerName: '액션', 
            filter: 'agTextColumnFilter',
            sortable: false,
            minWidth: 100,
            valueGetter: params => params.data.policy?.action,
            filterParams: {
                buttons: ['apply', 'reset'],
                debounceMs: 200
            }
        },
        {
            field: 'source', 
            headerName: '출발지', 
            wrapText: true, 
            autoHeight: true,
            cellRenderer: objectCellRenderer,
            filter: 'agTextColumnFilter',
            sortable: false,
            minWidth: 150,
            valueGetter: params => params.data.policy?.source,
            filterParams: {
                buttons: ['apply', 'reset'],
                debounceMs: 200
            }
        },
        {
            field: 'user', 
            headerName: '사용자', 
            wrapText: true, 
            autoHeight: true,
            cellRenderer: objectCellRenderer,
            filter: 'agTextColumnFilter',
            sortable: false,
            minWidth: 150,
            valueGetter: params => params.data.policy?.user,
            filterParams: {
                buttons: ['apply', 'reset'],
                debounceMs: 200
            }
        },
        {
            field: 'destination', 
            headerName: '목적지', 
            wrapText: true, 
            autoHeight: true,
            cellRenderer: objectCellRenderer,
            filter: 'agTextColumnFilter',
            sortable: false,
            minWidth: 150,
            valueGetter: params => params.data.policy?.destination,
            filterParams: {
                buttons: ['apply', 'reset'],
                debounceMs: 200
            }
        },
        {
            field: 'service', 
            headerName: '서비스', 
            wrapText: true, 
            autoHeight: true,
            cellRenderer: objectCellRenderer,
            filter: 'agTextColumnFilter',
            sortable: false,
            minWidth: 150,
            valueGetter: params => params.data.policy?.service,
            filterParams: {
                buttons: ['apply', 'reset'],
                debounceMs: 200
            }
        },
        {
            field: 'application', 
            headerName: '애플리케이션', 
            wrapText: true, 
            autoHeight: true,
            cellRenderer: objectCellRenderer,
            filter: 'agTextColumnFilter',
            sortable: false,
            minWidth: 150,
            valueGetter: params => params.data.policy?.application,
            filterParams: {
                buttons: ['apply', 'reset'],
                debounceMs: 200
            }
        },
        { 
            field: 'security_profile', 
            headerName: '보안프로파일', 
            filter: 'agTextColumnFilter',
            sortable: false,
            minWidth: 150,
            valueGetter: params => params.data.policy?.security_profile,
            filterParams: {
                buttons: ['apply', 'reset'],
                debounceMs: 200
            }
        },
        { 
            field: 'category', 
            headerName: '카테고리', 
            filter: 'agTextColumnFilter',
            sortable: false,
            minWidth: 120,
            valueGetter: params => params.data.policy?.category,
            filterParams: {
                buttons: ['apply', 'reset'],
                debounceMs: 200
            }
        },
        { 
            field: 'description', 
            headerName: '설명', 
            filter: 'agTextColumnFilter',
            sortable: false,
            minWidth: 200,
            valueGetter: params => params.data.policy?.description,
            filterParams: {
                buttons: ['apply', 'reset'],
                debounceMs: 200
            }
        },
        { 
            field: 'last_hit_date', 
            headerName: '마지막매칭일시', 
            filter: 'agDateColumnFilter',
            sortable: false,
            minWidth: 180,
            valueGetter: params => params.data.policy?.last_hit_date,
            valueFormatter: (params) => formatDateTime(params.value),
            filterParams: {
                buttons: ['apply', 'reset'],
                comparator: (filterLocalDateAtMidnight, cellValue) => {
                    if (!cellValue) return -1;
                    const cellDate = new Date(cellValue);
                    if (cellDate < filterLocalDateAtMidnight) {
                        return -1;
                    } else if (cellDate > filterLocalDateAtMidnight) {
                        return 1;
                    } else {
                        return 0;
                    }
                }
            }
        },
    ];

    if (analysisType === 'redundancy') {
        return [
            { 
                field: 'device_name', 
                headerName: '장비', 
                filter: 'agTextColumnFilter', 
                pinned: 'left',
                sortable: false,
                minWidth: 120,
                filterParams: {
                    buttons: ['apply', 'reset'],
                    debounceMs: 200
                }
            },
            { 
                field: 'set_number', 
                headerName: '중복번호', 
                minWidth: 100, 
                sortable: false, 
                filter: 'agTextColumnFilter', 
                pinned: 'left',
                valueFormatter: params => formatNumber(params.value), 
                filterParams: { buttons: ['apply', 'reset'], debounceMs: 200 } 
            },
            { 
                field: 'type', 
                headerName: '구분', 
                minWidth: 100, 
                sortable: false, 
                filter: 'agTextColumnFilter',
                pinned: 'left',
                valueFormatter: params => {
                    if (params.value === 'UPPER') return '상위 정책';
                    if (params.value === 'LOWER') return '하위 정책';
                    return params.value || '';
                },
                cellStyle: params => {
                    const typeValue = params.data?.type || params.value;
                    if (typeValue === 'UPPER') {
                        return {
                            color: '#1976d2',
                            fontWeight: '500',
                            textAlign: 'center'
                        };
                    } else if (typeValue === 'LOWER') {
                        return {
                            color: '#f57c00',
                            fontWeight: '500',
                            textAlign: 'center'
                        };
                    }
                    return { textAlign: 'center' };
                },
                filterParams: { buttons: ['apply', 'reset'], debounceMs: 200 } 
            },
            ...policyColumns
        ];
    }
    return policyColumns;
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
            getRowStyle: params => {
                // Upper policy와 Lower policy를 행 단위로 구분
                if (params.data?.type === 'UPPER') {
                    return {
                        borderLeft: '2px solid #1976d2'
                    };
                } else if (params.data?.type === 'LOWER') {
                    return {
                        borderLeft: '2px solid #f57c00'
                    };
                }
                return null;
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
        allDevices = devices; // 전역 변수에 저장
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
    const gridDiv = document.getElementById('analysis-result-grid');
    const messageContainer = document.getElementById('analysis-message-container');

    if (startButton) {
        startButton.disabled = false;
        startButton.classList.remove('is-loading');
    }
    if (resetFiltersBtn) resetFiltersBtn.style.display = 'none';
    if (exportBtn) exportBtn.style.display = 'none';
    
    // 그리드를 빈 상태로 초기화
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
    
    // 메시지 표시, 그리드 숨김
    showEmptyMessage(messageContainer, '분석 내용이 없습니다', 'fa-chart-line');
    if (gridDiv) gridDiv.style.display = 'none';
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
async function displayResults(resultData, analysisType, source = 'latest') {
    if (source === 'task') {
        resetStatusUI(); // 태스크 완료 시에만 전체 UI 초기화
    }

    const gridDiv = document.getElementById('analysis-result-grid');
    const messageContainer = document.getElementById('analysis-message-container');
    
    // 결과 데이터에 장비 이름 추가 및 validObjectNames 설정
    let processedData = [];
    if (resultData && resultData.length > 0) {
        // 첫 번째 정책의 device_id로 장비 정보 찾기
        const firstPolicy = resultData[0]?.policy;
        if (firstPolicy?.device_id) {
            const device = allDevices.find(d => d.id === firstPolicy.device_id);
            const deviceName = device ? device.name : `장비 ${firstPolicy.device_id}`;
            
            // validObjectNames 설정을 위해 정책 검색 API 호출
            try {
                const searchResponse = await api.searchPolicies({
                    device_ids: [firstPolicy.device_id],
                    limit: 1
                });
                if (searchResponse && searchResponse.valid_object_names) {
                    validObjectNames = new Set(searchResponse.valid_object_names);
                }
            } catch (error) {
                console.warn('valid_object_names를 가져오는 데 실패했습니다:', error);
            }
            
            // 각 결과에 장비 이름 추가
            processedData = resultData.map(item => ({
                ...item,
                device_name: deviceName
            }));
        } else {
            processedData = resultData;
        }
    }
    
    // 결과가 있든 없든 그리드를 생성하여 메시지 표시
    const columnDefs = getColumnDefs(analysisType);
    createGrid(columnDefs, processedData);
    
    if(processedData && processedData.length > 0) {
        // 버튼 표시
        const resetFiltersBtn = document.getElementById('btn-reset-filters');
        const exportBtn = document.getElementById('btn-export-excel');
        if (resetFiltersBtn) resetFiltersBtn.style.display = 'inline-block';
        if (exportBtn) exportBtn.style.display = 'inline-block';
        
        // 그리드 표시, 메시지 숨김
        hideEmptyMessage(messageContainer);
        if (gridDiv) gridDiv.style.display = 'block';
        
        // 그리드 높이 조절 및 셀 새로고침
        setTimeout(() => {
            if (resultGridApi) {
                resultGridApi.refreshCells({ force: true });
                if (typeof resultGridApi.autoSizeAllColumns === 'function') {
                    resultGridApi.autoSizeAllColumns({ skipHeader: false });
                }
            }
            if (gridDiv) {
                adjustGridHeight(gridDiv);
            }
        }, 600);
    } else {
        // 결과가 없을 때는 버튼 숨김
        const resetFiltersBtn = document.getElementById('btn-reset-filters');
        const exportBtn = document.getElementById('btn-export-excel');
        if (resetFiltersBtn) resetFiltersBtn.style.display = 'none';
        if (exportBtn) exportBtn.style.display = 'none';
        
        // 메시지 표시, 그리드 숨김
        showEmptyMessage(messageContainer, '분석 내용이 없습니다', 'fa-chart-line');
        if (gridDiv) gridDiv.style.display = 'none';
    }
}

async function displayTaskResults(taskId) {
    try {
        const results = await api.getAnalysisResults(taskId);
        await displayResults(results, 'redundancy', 'task');
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
            await displayResults(latestResult.result_data, latestResult.analysis_type);
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
    const columnDefs = getColumnDefs('redundancy');
    await exportGridToExcelClient(
        resultGridApi,
        columnDefs,
        'analysis_result',
        '데이터가 없습니다.',
        { type: 'analysis' }
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
