import { api } from '../api.js';
import { showObjectDetailModal } from '../components/objectDetailModal.js';
import { adjustGridHeight, createGridEventHandlers, createObjectCellRenderer } from '../utils/grid.js';
import { exportGridToExcelClient } from '../utils/excel.js';
import { showEmptyMessage, hideEmptyMessage } from '../utils/message.js';
import { getColumnDefs } from '../utils/analysisColumns.js';
import { processAnalysisResults, loadValidObjectNames } from '../utils/analysisHelpers.js';
import { initImpactAnalysis, loadPoliciesForImpact, getImpactAnalysisParams } from '../components/impactAnalysis.js';

// ==================== 전역 변수 ====================

let resultGridApi = null;
let deviceSelect = null;
let statusInterval = null;
let allDevices = []; // 장비 목록 저장
let validObjectNames = new Set(); // 유효한 객체 이름 저장
let objectCellRenderer = null; // 동적으로 생성되는 셀 렌더러

// 객체 클릭 핸들러
async function handleObjectClick(deviceId, objectName) {
    try {
        const objectDetails = await api.getObjectDetails(deviceId, objectName);
        showObjectDetailModal(objectDetails);
    } catch (error) {
        alert(`객체 '${objectName}'의 상세 정보를 가져오는 데 실패했습니다: ${error.message}`);
    }
}

function getColumnDefsWithRenderer(analysisType) {
    // analysisColumns.js에서 컬럼 정의 가져오기 (objectCellRenderer 포함)
    return getColumnDefs(analysisType, objectCellRenderer);
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
                // 분석 타입에 따라 고유 ID 생성
                if (params.data.set_number !== undefined && params.data.type) {
                    // 중복 정책 분석: set_number + type + policy_id 조합
                    return `${params.data.set_number}_${params.data.type}_${params.data.policy?.id || params.rowIndex}`;
                }
                if (params.data.object_name) {
                    // 미참조 객체 분석: object_name + object_type 조합
                    return `${params.data.object_name}_${params.data.object_type}`;
                }
                // 영향도 분석: policy_id + _impact_index 조합 (같은 정책이 affected와 conflict에 모두 나타날 수 있음)
                if (params.data._impact_index !== undefined || params.data.impact_type !== undefined || params.data.current_position !== undefined) {
                    const policyId = params.data.policy?.id || params.data.policy_id || 'unknown';
                    const impactIndex = params.data._impact_index || `impact_${params.rowIndex}`;
                    // _impact_index를 사용하여 완전히 고유한 ID 생성
                    return `impact_${policyId}_${impactIndex}`;
                }
                // 기타 분석 (미사용 정책 등): policy_id 또는 rowIndex 사용
                return String(params.data.policy?.id || params.data.policy_id || params.rowIndex);
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
                onChange: async () => {
                    await loadLatestResult();
                    // 영향도 분석이 선택되어 있으면 정책 목록 로드
                    const analysisTypeSelect = document.getElementById('analysis-type-select');
                    if (analysisTypeSelect && analysisTypeSelect.value === 'impact') {
                        await loadPoliciesForImpact(); // impactAnalysis.js에서 import
                    }
                }
            });
            // 영향도 분석 컴포넌트에 deviceSelect 전달
            initImpactAnalysis(deviceSelect);
        }
    } catch (err) {
        console.error('Failed to load devices:', err);
    }
}

// loadPoliciesForImpact는 impactAnalysis.js에서 import하여 사용

function resetStatusUI() {
    stopPolling();
    const startButton = document.getElementById('btn-start-analysis');
    const impactStartButton = document.getElementById('btn-start-impact-analysis');
    const resetFiltersBtn = document.getElementById('btn-reset-filters');
    const exportBtn = document.getElementById('btn-export-excel');
    const gridDiv = document.getElementById('analysis-result-grid');
    const messageContainer = document.getElementById('analysis-message-container');

    if (startButton) {
        startButton.disabled = false;
        startButton.classList.remove('is-loading');
    }
    if (impactStartButton) {
        impactStartButton.disabled = false;
        impactStartButton.classList.remove('is-loading');
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
        const analysisTypeSelect = document.getElementById('analysis-type-select');
        const analysisType = analysisTypeSelect ? analysisTypeSelect.value : 'redundancy';
        const columnDefs = getColumnDefsWithRenderer(analysisType);
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
    const impactStartButton = document.getElementById('btn-start-impact-analysis');
    if (startButton) {
        startButton.disabled = false;
        startButton.classList.remove('is-loading');
    }
    if (impactStartButton) {
        impactStartButton.disabled = false;
        impactStartButton.classList.remove('is-loading');
    }
}

// 저장된 결과 또는 태스크 완료 후 결과를 그리드에 표시
async function displayResults(resultData, analysisType, source = 'latest') {
    if (source === 'task') {
        resetStatusUI(); // 태스크 완료 시에만 전체 UI 초기화
    }

    const gridDiv = document.getElementById('analysis-result-grid');
    const messageContainer = document.getElementById('analysis-message-container');
    
    // 모듈화된 함수로 결과 데이터 처리
    let processedData = await processAnalysisResults(resultData, analysisType, allDevices);
    
    // validObjectNames 설정 (정책 관련 분석인 경우)
    if (analysisType !== 'unreferenced_objects' && processedData.length > 0) {
        const firstItem = processedData[0];
        const deviceId = firstItem?.policy?.device_id || firstItem?.device_id;
        if (deviceId) {
            validObjectNames = await loadValidObjectNames(deviceId);
            // objectCellRenderer 재생성
            objectCellRenderer = createObjectCellRenderer(validObjectNames, handleObjectClick);
        }
    }
    
    // 결과가 있든 없든 그리드를 생성하여 메시지 표시
    const columnDefs = getColumnDefsWithRenderer(analysisType);
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

async function displayTaskResults(deviceId, analysisType) {
    try {
        // 모든 분석 타입은 getLatestAnalysisResult를 사용
        const latestResult = await api.getLatestAnalysisResult(deviceId, analysisType);
        if (latestResult && latestResult.result_data) {
            // 영향도 분석은 객체 형태, 나머지는 배열 형태
            if (analysisType === 'impact') {
                if (latestResult.result_data.blocking_policies || latestResult.result_data.shadowed_policies) {
                    await displayResults(latestResult.result_data, latestResult.analysis_type, 'task');
                } else {
                    resetStatusUI();
                }
            } else if (Array.isArray(latestResult.result_data) && latestResult.result_data.length > 0) {
                await displayResults(latestResult.result_data, latestResult.analysis_type, 'task');
            } else {
                resetStatusUI();
            }
        } else {
            resetStatusUI();
        }
    } catch (error) {
        console.error('결과를 가져오는 데 실패했습니다:', error);
        if (error.status !== 404) {
            alert(`결과 로딩 실패: ${error.message}`);
        }
        resetStatusUI();
    }
}

function startPolling(deviceId, analysisType) {
    stopPolling();
    const startButton = document.getElementById('btn-start-analysis');
    const impactStartButton = document.getElementById('btn-start-impact-analysis');
    
    // 분석 타입에 따라 적절한 버튼에 로딩 상태 적용
    if (analysisType === 'impact') {
        if (impactStartButton) {
            impactStartButton.disabled = true;
            impactStartButton.classList.add('is-loading');
        }
    } else {
        if (startButton) {
            startButton.disabled = true;
            startButton.classList.add('is-loading');
        }
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
                    setTimeout(() => displayTaskResults(deviceId, analysisType), 100);
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
    
    const analysisTypeSelect = document.getElementById('analysis-type-select');
    const analysisType = analysisTypeSelect ? analysisTypeSelect.value : 'redundancy';
    
    let params = {};
    if (analysisType === 'unused') {
        const daysInput = document.getElementById('analysis-params-input');
        params.days = daysInput ? parseInt(daysInput.value) || 90 : 90;
    } else if (analysisType === 'impact') {
        // 모듈화된 함수로 영향도 분석 파라미터 추출
        const impactParams = getImpactAnalysisParams();
        if (!impactParams) {
            return; // 에러 메시지는 getImpactAnalysisParams에서 표시됨
        }
        params = impactParams;
    }
    
    // UI 상태 초기화 (버튼 로딩 상태는 제외)
    const gridDiv = document.getElementById('analysis-result-grid');
    const messageContainer = document.getElementById('analysis-message-container');
    const resetFiltersBtn = document.getElementById('btn-reset-filters');
    const exportBtn = document.getElementById('btn-export-excel');
    
    if (resetFiltersBtn) resetFiltersBtn.style.display = 'none';
    if (exportBtn) exportBtn.style.display = 'none';
    
    // 그리드를 빈 상태로 초기화
    if (resultGridApi) {
        try {
            resultGridApi.setGridOption('rowData', []);
        } catch (e) {
            console.warn('Failed to reset grid data:', e);
        }
    }
    
    // 메시지 표시, 그리드 숨김
    showEmptyMessage(messageContainer, '분석 중...', 'fa-chart-line');
    if (gridDiv) gridDiv.style.display = 'none';
    
    try {
        await api.startAnalysis(deviceId, analysisType, params);
        startPolling(deviceId, analysisType);
    } catch (error) {
        console.error('분석 시작 실패:', error);
        alert(`분석 시작 실패: ${error.message}`);
        stopPolling();
    }
}

async function loadLatestResult() {
    const deviceId = deviceSelect.getValue();
    if (!deviceId) {
        resetStatusUI();
        return;
    }
    
    const analysisTypeSelect = document.getElementById('analysis-type-select');
    const analysisType = analysisTypeSelect ? analysisTypeSelect.value : 'redundancy';

    // 새 장비를 선택했으므로 이전 상태와 결과를 초기화
    resetStatusUI();

    try {
        const latestResult = await api.getLatestAnalysisResult(deviceId, analysisType);
        if (latestResult && latestResult.result_data) {
            // 영향도 분석은 객체 형태, 나머지는 배열 형태
            if (analysisType === 'impact') {
                if (latestResult.result_data.blocking_policies || latestResult.result_data.shadowed_policies) {
                    await displayResults(latestResult.result_data, latestResult.analysis_type);
                } else {
                    resetStatusUI();
                }
            } else if (Array.isArray(latestResult.result_data) && latestResult.result_data.length > 0) {
                await displayResults(latestResult.result_data, latestResult.analysis_type);
            } else {
                resetStatusUI();
            }
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
    const analysisTypeSelect = document.getElementById('analysis-type-select');
    const analysisType = analysisTypeSelect ? analysisTypeSelect.value : 'redundancy';
    const columnDefs = getColumnDefsWithRenderer(analysisType);
    await exportGridToExcelClient(
        resultGridApi,
        columnDefs,
        'analysis_result',
        '데이터가 없습니다.',
        { type: 'analysis' }
    );
}

function setupAnalysisTypeSelect() {
    const analysisTypeSelect = document.getElementById('analysis-type-select');
    const paramsColumn = document.getElementById('analysis-params-column');
    const paramsLabel = document.getElementById('analysis-params-label');
    const paramsInput = document.getElementById('analysis-params-input');
    const impactUI = document.getElementById('impact-analysis-ui');
    const startButton = document.getElementById('btn-start-analysis');
    
    if (!analysisTypeSelect || !paramsColumn) return;
    
    analysisTypeSelect.addEventListener('change', async () => {
        const analysisType = analysisTypeSelect.value;
        
        if (analysisType === 'unused') {
            paramsColumn.style.display = 'block';
            impactUI.style.display = 'none';
            if (startButton) startButton.style.display = 'inline-block';
            paramsLabel.textContent = '기준일수';
            paramsInput.type = 'number';
            paramsInput.placeholder = '90';
            paramsInput.value = '90';
            paramsInput.min = '1';
        } else if (analysisType === 'impact') {
            paramsColumn.style.display = 'none';
            impactUI.style.display = 'block';
            if (startButton) startButton.style.display = 'none'; // 첫 번째 박스의 분석하기 버튼 숨김
            // 장비가 선택되어 있으면 정책 목록 로드
            const deviceId = deviceSelect ? deviceSelect.getValue() : null;
            if (deviceId) {
                await loadPoliciesForImpact();
            }
        } else {
            paramsColumn.style.display = 'none';
            impactUI.style.display = 'none';
            if (startButton) startButton.style.display = 'inline-block';
        }
        
        // 분석 타입 변경 시 최신 결과 다시 로드
        loadLatestResult();
    });
}

export async function initAnalysis() {
    await loadDevices();

    // 초기 objectCellRenderer 생성 (빈 Set으로 시작)
    objectCellRenderer = createObjectCellRenderer(validObjectNames, handleObjectClick);

    // 분석 타입 선택 UI 설정
    setupAnalysisTypeSelect();

    // 초기 그리드 생성 (빈 상태)
    const analysisTypeSelect = document.getElementById('analysis-type-select');
    const analysisType = analysisTypeSelect ? analysisTypeSelect.value : 'redundancy';
    const columnDefs = getColumnDefsWithRenderer(analysisType);
    createGrid(columnDefs, []);

    const startButton = document.getElementById('btn-start-analysis');
    if (startButton) {
        startButton.addEventListener('click', startAnalysis);
    }

    // 영향도 분석 전용 분석 버튼
    const impactStartButton = document.getElementById('btn-start-impact-analysis');
    if (impactStartButton) {
        impactStartButton.addEventListener('click', startAnalysis);
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
