import { api } from '../api.js';
import { showObjectDetailModal } from '../components/objectDetailModal.js';
import { adjustGridHeight, createGridEventHandlers, createObjectCellRenderer, createCommonGridOptions } from '../utils/grid.js';
import { exportGridToExcelClient } from '../utils/excel.js';
import { showEmptyMessage, hideEmptyMessage } from '../utils/message.js';
import { getColumnDefs } from '../utils/analysis/columns/index.js';
import { processAnalysisResults, loadValidObjectNames } from '../utils/analysis/helpers/index.js';
import { initImpactAnalysis, loadPoliciesForImpact, getImpactAnalysisParams } from './analysis/impactAnalysis.js';
import { initRiskyPortsAnalysis, loadPoliciesForRiskyPorts, getRiskyPortsAnalysisParams } from './analysis/riskyPorts.js';
import { generateServiceCreationScript } from '../utils/scriptGenerator.js';
import { notifyAnalysisComplete } from '../utils/notification.js';
import { setButtonLoading } from '../utils/loading.js';
import { saveSearchParams, loadSearchParams } from '../utils/storage.js';

// ==================== 전역 변수 ====================

let resultGridApi = null;
let deviceSelect = null;
let analysisTypeSelect = null; // 분석 종류 TomSelect 인스턴스
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
    // analysis/columns/index.js에서 컬럼 정의 가져오기 (objectCellRenderer 포함)
    return getColumnDefs(analysisType, objectCellRenderer);
}

function createGrid(columnDefs, rowData) {
    if (resultGridApi) {
        try { resultGridApi.destroy(); } catch (e) {}
        resultGridApi = null;
    }

    const gridEl = document.getElementById('analysis-result-grid');
    if (gridEl) {
        const commonOptions = createCommonGridOptions();
        const handlers = createGridEventHandlers(gridEl, null);
        
        const gridOptions = {
            ...commonOptions,
            columnDefs: columnDefs,
            rowData: rowData || [],
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
                // 영향도 분석: target_policy_id + policy_id + _impact_index 조합 (여러 대상 정책 지원)
                if (params.data._impact_index !== undefined || params.data.impact_type !== undefined || params.data.current_position !== undefined) {
                    const targetPolicyId = params.data.target_policy_id || 'unknown';
                    const policyId = params.data.policy?.id || params.data.policy_id || 'unknown';
                    const impactIndex = params.data._impact_index || `impact_${params.rowIndex}`;
                    // target_policy_id와 policy_id, _impact_index를 사용하여 완전히 고유한 ID 생성
                    return `impact_${targetPolicyId}_${policyId}_${impactIndex}`;
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
            suppressHorizontalScroll: false,
            overlayNoRowsTemplate: '<div style="padding: 20px; text-align: center; color: #666;">분석 결과가 없습니다.</div>',
            onGridReady: (params) => {
                resultGridApi = params.api;
                const gridDiv = document.getElementById('analysis-result-grid');
                if (gridDiv) {
                    const updatedHandlers = createGridEventHandlers(gridDiv, params.api);
                    Object.assign(gridOptions, updatedHandlers);
                }
            },
            ...handlers
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
                    // 장비 선택 상태 저장
                    const deviceId = deviceSelect.getValue();
                    saveSearchParams('analysis', { deviceId });
                    
                    await loadLatestResult();
                    // 영향도 분석이 선택되어 있으면 정책 목록 로드
                    if (analysisTypeSelect && analysisTypeSelect.getValue() === 'impact') {
                        await loadPoliciesForImpact(); // impactAnalysis.js에서 import
                    }
                    // 위험포트 분석이 선택되어 있으면 정책 목록 로드
                    if (analysisTypeSelect && analysisTypeSelect.getValue() === 'risky_ports') {
                        await loadPoliciesForRiskyPorts();
                    }
                }
            });
            
            // 저장된 장비 선택 복원
            const savedState = loadSearchParams('analysis');
            if (savedState && savedState.deviceId) {
                deviceSelect.setValue(savedState.deviceId);
            }
            
            // 영향도 분석 컴포넌트에 deviceSelect 전달
            initImpactAnalysis(deviceSelect);
            // 위험포트 분석 컴포넌트에 deviceSelect 전달
            initRiskyPortsAnalysis(deviceSelect);
        }
    } catch (err) {
        console.error('Failed to load devices:', err);
    }
}

function resetStatusUI() {
    stopPolling();
    const startButton = document.getElementById('btn-start-analysis');
    const impactStartButton = document.getElementById('btn-start-impact-analysis');
    const riskyPortsStartButton = document.getElementById('btn-start-risky-ports-analysis');
    const resetFiltersBtn = document.getElementById('btn-reset-filters');
    const generateScriptBtn = document.getElementById('btn-generate-script');
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
    if (riskyPortsStartButton) {
        riskyPortsStartButton.disabled = false;
        riskyPortsStartButton.classList.remove('is-loading');
    }
    if (resetFiltersBtn) resetFiltersBtn.style.display = 'none';
    if (generateScriptBtn) generateScriptBtn.style.display = 'none';
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
    const riskyPortsStartButton = document.getElementById('btn-start-risky-ports-analysis');
    setButtonLoading(startButton, false);
    setButtonLoading(impactStartButton, false);
    setButtonLoading(riskyPortsStartButton, false);
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
            validObjectNames = await loadValidObjectNames(deviceId, api);
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
        const generateScriptBtn = document.getElementById('btn-generate-script');
        const exportBtn = document.getElementById('btn-export-excel');
        if (resetFiltersBtn) resetFiltersBtn.style.display = 'inline-block';
        // 위험 포트 분석인 경우에만 생성 스크립트 버튼 표시
        if (generateScriptBtn) {
            generateScriptBtn.style.display = analysisType === 'risky_ports' ? 'inline-block' : 'none';
        }
        if (exportBtn) exportBtn.style.display = 'inline-block';
        
        // 그리드 표시, 메시지 숨김
        hideEmptyMessage(messageContainer);
        if (gridDiv) gridDiv.style.display = 'block';
        
        // 그리드 높이 조절 및 셀 새로고침
        setTimeout(() => {
            if (resultGridApi && typeof resultGridApi.isDestroyed === 'function' && !resultGridApi.isDestroyed()) {
                try {
                    resultGridApi.refreshCells({ force: true });
                    if (typeof resultGridApi.autoSizeAllColumns === 'function') {
                        resultGridApi.autoSizeAllColumns({ skipHeader: false });
                    }
                } catch (e) {
                    console.warn('Grid API 호출 실패 (이미 destroy됨):', e);
                }
            }
            if (gridDiv) {
                adjustGridHeight(gridDiv);
            }
        }, 600);
    } else {
        // 결과가 없을 때는 버튼 숨김
        const resetFiltersBtn = document.getElementById('btn-reset-filters');
        const generateScriptBtn = document.getElementById('btn-generate-script');
        const exportBtn = document.getElementById('btn-export-excel');
        if (resetFiltersBtn) resetFiltersBtn.style.display = 'none';
        if (generateScriptBtn) generateScriptBtn.style.display = 'none';
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
    const riskyPortsStartButton = document.getElementById('btn-start-risky-ports-analysis');
    
    // 분석 타입에 따라 적절한 버튼에 로딩 상태 적용
    if (analysisType === 'impact') {
        setButtonLoading(impactStartButton, true);
    } else if (analysisType === 'risky_ports') {
        setButtonLoading(riskyPortsStartButton, true);
    } else {
        setButtonLoading(startButton, true);
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
                    const device = allDevices.find(d => d.id === deviceId);
                    const deviceName = device ? device.name : `장비 ${deviceId}`;
                    notifyAnalysisComplete(deviceName, analysisType, true, deviceId).catch(err => {
                        console.warn('알림 표시 실패:', err);
                    });
                    setTimeout(() => displayTaskResults(deviceId, analysisType), 100);
                    break;
                case 'failure':
                    stopPolling();
                    const deviceFail = allDevices.find(d => d.id === deviceId);
                    const deviceNameFail = deviceFail ? deviceFail.name : `장비 ${deviceId}`;
                    notifyAnalysisComplete(deviceNameFail, analysisType, false, deviceId).catch(err => {
                        console.warn('알림 표시 실패:', err);
                    });
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
    
    const analysisType = analysisTypeSelect ? analysisTypeSelect.getValue() : 'redundancy';
    
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
        // targetPolicyIds를 사용하도록 수정
        params = {
            targetPolicyIds: impactParams.targetPolicyIds,
            newPosition: impactParams.newPosition
        };
    } else if (analysisType === 'risky_ports') {
        // 위험포트 분석 파라미터 추출
        const riskyPortsParams = getRiskyPortsAnalysisParams();
        params = {
            targetPolicyIds: riskyPortsParams.targetPolicyIds
        };
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
    
    const analysisType = analysisTypeSelect ? analysisTypeSelect.getValue() : 'redundancy';

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
    const analysisType = analysisTypeSelect ? analysisTypeSelect.getValue() : 'redundancy';
    const columnDefs = getColumnDefsWithRenderer(analysisType);
    await exportGridToExcelClient(
        resultGridApi,
        columnDefs,
        'analysis_result',
        '데이터가 없습니다.',
        { type: 'analysis' }
    );
}

async function generateScript() {
    const deviceId = deviceSelect.getValue();
    if (!deviceId) {
        alert('장비를 선택하세요.');
        return;
    }
    
    const analysisType = analysisTypeSelect ? analysisTypeSelect.getValue() : 'risky_ports';
    
    if (analysisType !== 'risky_ports') {
        alert('생성 스크립트는 위험 포트 분석에서만 사용할 수 있습니다.');
        return;
    }
    
    try {
        // 현재 그리드의 데이터 가져오기
        const rowData = [];
        if (resultGridApi) {
            resultGridApi.forEachNode((node) => {
                if (node.data) {
                    rowData.push(node.data);
                }
            });
        }
        
        if (rowData.length === 0) {
            alert('생성할 데이터가 없습니다.');
            return;
        }
        
        // 장비 정보에서 벤더 타입 가져오기
        const device = allDevices.find(d => d.id === deviceId);
        const vendor = device?.vendor || 'palo_alto';
        
        // 스크립트 생성
        const scriptText = generateServiceCreationScript(rowData, vendor);
        
        // 파일명 생성
        const deviceName = device ? device.name.replace(/\s+/g, '_') : `device_${deviceId}`;
        const filename = `service_creation_script_${deviceName}_${new Date().toISOString().split('T')[0]}`;
        
        // 엑셀로 다운로드
        await exportScriptToExcel(scriptText, filename);
    } catch (error) {
        console.error('스크립트 생성 실패:', error);
        alert(`스크립트 생성 실패: ${error.message}`);
    }
}

/**
 * 스크립트를 엑셀 파일로 내보내기
 * @param {string} scriptText - 스크립트 텍스트
 * @param {string} filename - 파일명 (확장자 제외)
 */
async function exportScriptToExcel(scriptText, filename) {
    if (!window.ExcelJS) {
        alert('엑셀 라이브러리를 불러올 수 없습니다. 페이지를 새로고침해주세요.');
        return;
    }

    // 워크북 생성
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Script');
    
    // 헤더 추가
    const headerRow = worksheet.addRow(['주석', '명령어', '생성되는 서비스 객체명']);
    headerRow.eachCell((cell) => {
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE8E8E8' }
        };
        cell.font = { 
            bold: true, 
            size: 11,
            color: { argb: 'FF333333' }
        };
        cell.alignment = { 
            horizontal: 'center', 
            vertical: 'middle',
            wrapText: true
        };
        cell.border = {
            top: { style: 'thin', color: { argb: 'FFCCCCCC' } },
            left: { style: 'thin', color: { argb: 'FFCCCCCC' } },
            bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
            right: { style: 'thin', color: { argb: 'FFCCCCCC' } }
        };
    });
    
    // 스크립트를 줄 단위로 분리
    const scriptLines = scriptText.split('\n');
    
    // 생성되는 서비스 객체명 추출을 위한 정규식
    const serviceNamePattern = /set service\s+([^\s]+)/;
    const serviceGroupNamePattern = /set service-group\s+([^\s]+)/;
    
    // 각 줄을 파싱하여 행 추가
    scriptLines.forEach((line) => {
        const trimmedLine = line.trim();
        
        // 빈 줄은 건너뛰기
        if (!trimmedLine) {
            worksheet.addRow(['', '', '']);
            return;
        }
        
        let comment = '';
        let command = '';
        let createdObjectName = '';
        
        if (trimmedLine.startsWith('#')) {
            // 주석 줄
            comment = trimmedLine;
        } else {
            // 명령어 줄
            command = trimmedLine;
            
            // 생성되는 서비스 객체명 추출
            const serviceMatch = trimmedLine.match(serviceNamePattern);
            const groupMatch = trimmedLine.match(serviceGroupNamePattern);
            
            if (serviceMatch) {
                createdObjectName = serviceMatch[1];
            } else if (groupMatch) {
                createdObjectName = groupMatch[1];
            }
        }
        
        const row = worksheet.addRow([comment, command, createdObjectName]);
        
        // 주석 컬럼 스타일
        if (comment) {
            row.getCell(1).font = { color: { argb: 'FF666666' }, italic: true };
        }
        
        // 명령어 컬럼 스타일
        if (command) {
            row.getCell(2).font = { color: { argb: 'FF000000' }, name: 'Courier New' };
        }
        
        // 생성되는 서비스 객체명 컬럼 스타일
        if (createdObjectName) {
            row.getCell(3).font = { color: { argb: 'FF1976D2' }, bold: true };
        }
        
        // 모든 셀에 테두리 및 정렬 적용
        row.eachCell((cell) => {
            cell.border = {
                top: { style: 'thin', color: { argb: 'FFE0E0E0' } },
                left: { style: 'thin', color: { argb: 'FFE0E0E0' } },
                bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } },
                right: { style: 'thin', color: { argb: 'FFE0E0E0' } }
            };
            cell.alignment = { 
                vertical: 'top',
                wrapText: true
            };
        });
    });
    
    // 컬럼 너비 설정
    worksheet.getColumn(1).width = 40;  // 주석
    worksheet.getColumn(2).width = 80; // 명령어
    worksheet.getColumn(3).width = 30; // 생성되는 서비스 객체명
    
    // 헤더 행 높이 설정
    headerRow.height = 28;
    
    // 파일 다운로드
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
}

function setupAnalysisTypeSelect() {
    const analysisTypeSelectEl = document.getElementById('analysis-type-select');
    const paramsColumn = document.getElementById('analysis-params-column');
    const paramsLabel = document.getElementById('analysis-params-label');
    const paramsInput = document.getElementById('analysis-params-input');
    const impactUI = document.getElementById('impact-analysis-ui');
    const riskyPortsUI = document.getElementById('risky-ports-analysis-ui');
    const defaultUI = document.getElementById('default-analysis-ui');
    const startButton = document.getElementById('btn-start-analysis');
    
    if (!analysisTypeSelectEl || !paramsColumn) return;
    
    // TomSelect로 초기화
    if (window.TomSelect && analysisTypeSelectEl) {
        if (analysisTypeSelectEl.tomselect) {
            try { analysisTypeSelectEl.tomselect.destroy(); } catch (e) {}
        }
        analysisTypeSelect = new window.TomSelect(analysisTypeSelectEl, {
            placeholder: '분석 종류 선택',
            maxOptions: null,
            onChange: async (value) => {
                const analysisType = value;
                
                if (analysisType === 'unused') {
                    paramsColumn.style.display = 'block';
                    impactUI.style.display = 'none';
                    riskyPortsUI.style.display = 'none';
                    if (startButton) startButton.style.display = 'inline-flex';
                    if (defaultUI) defaultUI.style.display = 'block';
                    paramsLabel.textContent = '기준일수';
                    paramsInput.type = 'number';
                    paramsInput.placeholder = '90';
                    paramsInput.value = '90';
                    paramsInput.min = '1';
                } else if (analysisType === 'impact') {
                    paramsColumn.style.display = 'none';
                    impactUI.style.display = 'block';
                    riskyPortsUI.style.display = 'none';
                    if (startButton) startButton.style.display = 'none'; // 첫 번째 박스의 분석하기 버튼 숨김
                    if (defaultUI) defaultUI.style.display = 'block'; // 기본 UI는 유지 (장비 선택용)
                    // 장비가 선택되어 있으면 정책 목록 로드
                    const deviceId = deviceSelect ? deviceSelect.getValue() : null;
                    if (deviceId) {
                        await loadPoliciesForImpact();
                    }
                } else if (analysisType === 'risky_ports') {
                    paramsColumn.style.display = 'none';
                    impactUI.style.display = 'none';
                    riskyPortsUI.style.display = 'block';
                    if (startButton) startButton.style.display = 'none'; // 첫 번째 박스의 분석하기 버튼 숨김
                    if (defaultUI) defaultUI.style.display = 'block'; // 기본 UI는 유지 (장비 선택용)
                    // 장비가 선택되어 있으면 정책 목록 로드
                    const deviceId = deviceSelect ? deviceSelect.getValue() : null;
                    if (deviceId) {
                        await loadPoliciesForRiskyPorts();
                    }
                } else {
                    paramsColumn.style.display = 'none';
                    impactUI.style.display = 'none';
                    riskyPortsUI.style.display = 'none';
                    if (startButton) startButton.style.display = 'inline-flex';
                    if (defaultUI) defaultUI.style.display = 'block';
                }
                
                // 분석 타입 변경 시 최신 결과 다시 로드
                loadLatestResult();
            }
        });
    }
}

export async function initAnalysis() {
    await loadDevices();

    // 초기 objectCellRenderer 생성 (빈 Set으로 시작)
    objectCellRenderer = createObjectCellRenderer(validObjectNames, handleObjectClick);

    // 분석 타입 선택 UI 설정
    setupAnalysisTypeSelect();

    // 초기 그리드 생성 (빈 상태)
    const analysisType = analysisTypeSelect ? analysisTypeSelect.getValue() : 'redundancy';
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

    // 위험포트 분석 전용 분석 버튼
    const riskyPortsStartButton = document.getElementById('btn-start-risky-ports-analysis');
    if (riskyPortsStartButton) {
        riskyPortsStartButton.addEventListener('click', startAnalysis);
    }

    const exportButton = document.getElementById('btn-export-excel');
    if (exportButton) {
        exportButton.addEventListener('click', exportToExcel);
    }

    // 생성 스크립트 버튼
    const generateScriptButton = document.getElementById('btn-generate-script');
    if (generateScriptButton) {
        generateScriptButton.addEventListener('click', generateScript);
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
