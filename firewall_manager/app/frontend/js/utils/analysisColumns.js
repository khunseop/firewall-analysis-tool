import { formatDateTime, formatNumber } from './date.js';

/**
 * 분석 타입별 그리드 컬럼 정의를 생성하는 함수
 */

// 공통 정책 컬럼 정의
export function getPolicyColumns() {
    return [
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
            // cellRenderer는 getColumnDefs에서 objectCellRenderer 파라미터로 설정됨
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
            // cellRenderer는 getColumnDefs에서 objectCellRenderer 파라미터로 설정됨
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
            // cellRenderer는 getColumnDefs에서 objectCellRenderer 파라미터로 설정됨
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
            // cellRenderer는 getColumnDefs에서 objectCellRenderer 파라미터로 설정됨
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
            // cellRenderer는 getColumnDefs에서 objectCellRenderer 파라미터로 설정됨
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
}

/**
 * 분석 타입에 따른 컬럼 정의 반환
 * @param {string} analysisType - 분석 타입 (redundancy, unused, impact, unreferenced_objects)
 * @param {Function} objectCellRenderer - 객체 셀 렌더러 함수 (선택사항)
 * @returns {Array} 컬럼 정의 배열
 */
export function getColumnDefs(analysisType, objectCellRenderer = null) {
    const policyColumns = getPolicyColumns();
    
    // objectCellRenderer가 제공되면 객체 필드에 적용
    if (objectCellRenderer) {
        const objectFields = ['source', 'user', 'destination', 'service', 'application'];
        policyColumns.forEach(col => {
            if (objectFields.includes(col.field)) {
                col.cellRenderer = objectCellRenderer;
            }
        });
    }

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
    } else if (analysisType === 'unused') {
        return [
            { 
                field: 'reason', 
                headerName: '미사용 사유', 
                filter: 'agTextColumnFilter',
                sortable: false,
                minWidth: 150,
                pinned: 'left',
                filterParams: {
                    buttons: ['apply', 'reset'],
                    debounceMs: 200
                }
            },
            { 
                field: 'days_unused', 
                headerName: '미사용 일수', 
                filter: 'agNumberColumnFilter',
                sortable: false,
                minWidth: 120,
                valueGetter: params => params.data.days_unused,
                valueFormatter: params => params.value ? `${params.value}일` : '-',
                filterParams: {
                    buttons: ['apply', 'reset'],
                    debounceMs: 200
                }
            },
            ...policyColumns
        ];
    } else if (analysisType === 'unreferenced_objects') {
        return [
            { 
                field: 'object_name', 
                headerName: '객체명', 
                filter: 'agTextColumnFilter',
                sortable: false,
                minWidth: 200,
                pinned: 'left',
                filterParams: {
                    buttons: ['apply', 'reset'],
                    debounceMs: 200
                }
            },
            { 
                field: 'object_type', 
                headerName: '객체 유형', 
                filter: 'agTextColumnFilter',
                sortable: false,
                minWidth: 150,
                valueFormatter: params => {
                    const typeMap = {
                        'network_object': '네트워크 객체',
                        'network_group': '네트워크 그룹',
                        'service': '서비스 객체',
                        'service_group': '서비스 그룹'
                    };
                    return typeMap[params.value] || params.value;
                },
                filterParams: {
                    buttons: ['apply', 'reset'],
                    debounceMs: 200
                }
            }
        ];
    } else if (analysisType === 'impact') {
        return [
            { 
                field: 'policy_id', 
                headerName: '정책 ID', 
                filter: 'agNumberColumnFilter',
                sortable: false,
                minWidth: 100,
                pinned: 'left',
                valueGetter: params => params.data.policy?.id,
                filterParams: {
                    buttons: ['apply', 'reset'],
                    debounceMs: 200
                }
            },
            { 
                field: 'current_position', 
                headerName: '위치', 
                filter: 'agNumberColumnFilter',
                sortable: false,
                minWidth: 100,
                pinned: 'left',
                valueGetter: params => params.data.current_position,
                valueFormatter: params => formatNumber(params.value),
                filterParams: {
                    buttons: ['apply', 'reset'],
                    debounceMs: 200
                }
            },
            { 
                field: 'impact_type', 
                headerName: '영향 유형', 
                filter: 'agTextColumnFilter',
                sortable: false,
                minWidth: 150,
                pinned: 'left',
                cellStyle: params => {
                    const impactType = params.value;
                    if (impactType === '차단 정책에 걸림') {
                        return {
                            color: '#d32f2f',
                            fontWeight: '500'
                        };
                    } else if (impactType === 'Shadow됨') {
                        return {
                            color: '#f57c00',
                            fontWeight: '500'
                        };
                    }
                    return null;
                },
                filterParams: {
                    buttons: ['apply', 'reset'],
                    debounceMs: 200
                }
            },
            { 
                field: 'reason', 
                headerName: '사유', 
                filter: 'agTextColumnFilter',
                sortable: false,
                minWidth: 300,
                wrapText: true,
                autoHeight: true,
                valueGetter: params => params.data.reason,
                filterParams: {
                    buttons: ['apply', 'reset'],
                    debounceMs: 200
                }
            },
            ...policyColumns
        ];
    } else if (analysisType === 'risky_ports') {
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
            ...policyColumns.slice(0, 4), // seq, vsys, rule_name, enable
            {
                field: 'original_services',
                headerName: '원본 서비스',
                wrapText: true,
                autoHeight: true,
                filter: 'agTextColumnFilter',
                sortable: false,
                minWidth: 200,
                valueGetter: params => {
                    const serviceObjects = params.data.original_service_objects || [];
                    if (serviceObjects.length > 0) {
                        return serviceObjects.map(obj => {
                            if (obj.type === 'group') {
                                return obj.name;
                            } else {
                                return obj.name || obj.token || '';
                            }
                        }).join(', ');
                    }
                    const services = params.data.original_services || [];
                    return Array.isArray(services) ? services.join(', ') : '';
                },
                filterParams: {
                    buttons: ['apply', 'reset'],
                    debounceMs: 200
                }
            },
            {
                field: 'removed_risky_ports',
                headerName: '제거된 위험 포트',
                wrapText: true,
                autoHeight: true,
                filter: 'agTextColumnFilter',
                sortable: false,
                minWidth: 200,
                cellStyle: { color: '#d32f2f', fontWeight: '500' },
                valueGetter: params => {
                    const removed = params.data.removed_risky_ports || [];
                    if (!Array.isArray(removed) || removed.length === 0) return '';
                    return removed.map(r => r.risky_port_def || `${r.protocol}/${r.port}`).join(', ');
                },
                cellRenderer: (params) => {
                    const removed = params.data.removed_risky_ports || [];
                    if (!Array.isArray(removed) || removed.length === 0) return '';
                    const displayText = removed.map(r => r.risky_port_def || `${r.protocol}/${r.port}`).join(', ');
                    return `<span style="color: #d32f2f; font-weight: 500; cursor: pointer;" title="클릭하여 상세 정보 보기">${displayText}</span>`;
                },
                onCellClicked: (params) => {
                    if (params.data && params.data.removed_risky_ports && params.data.removed_risky_ports.length > 0) {
                        showRiskyPortsDetailModal(params.data);
                    }
                },
                filterParams: {
                    buttons: ['apply', 'reset'],
                    debounceMs: 200
                }
            },
            {
                field: 'filtered_services',
                headerName: '제거 후 서비스',
                wrapText: true,
                autoHeight: true,
                filter: 'agTextColumnFilter',
                sortable: false,
                minWidth: 250,
                cellRenderer: params => {
                    const serviceObjects = params.data.filtered_service_objects || [];
                    if (serviceObjects.length === 0) {
                        const services = params.data.filtered_services || [];
                        return Array.isArray(services) ? services.join(', ') : '';
                    }
                    
                    return serviceObjects.map(obj => {
                        const displayName = obj.name || obj.token || '';
                        // 원본 객체명과 다르면 원본 표시
                        if (obj.original_name && obj.original_name !== obj.name) {
                            return `<span title="원본: ${obj.original_name}">${displayName}</span>`;
                        }
                        return displayName;
                    }).join(', ');
                },
                valueGetter: params => {
                    const serviceObjects = params.data.filtered_service_objects || [];
                    if (serviceObjects.length > 0) {
                        return serviceObjects.map(obj => {
                            // 원본 객체명과 다르면 원본 포함하여 표시
                            if (obj.original_name && obj.original_name !== obj.name) {
                                return `${obj.name} (원본: ${obj.original_name})`;
                            }
                            return obj.name || obj.token || '';
                        }).join(', ');
                    }
                    const services = params.data.filtered_services || [];
                    return Array.isArray(services) ? services.join(', ') : '';
                },
                filterParams: {
                    buttons: ['apply', 'reset'],
                    debounceMs: 200
                }
            },
            ...policyColumns.slice(4) // 나머지 정책 컬럼들
        ];
    }
    return policyColumns;
}

/**
 * 위험 포트 상세 정보 모달 표시 (단순화 버전)
 */
window.showRiskyPortsDetailModal = function(data) {
    const removed = data.removed_risky_ports || [];
    const originalServiceObjects = data.original_service_objects || [];
    const filteredServiceObjects = data.filtered_service_objects || [];
    
    // 모달 HTML 생성
    let modalHtml = `
        <div class="modal is-active" id="risky-ports-detail-modal">
            <div class="modal-background"></div>
            <div class="modal-card" style="max-width: 900px;">
                <header class="modal-card-head">
                    <p class="modal-card-title">위험 포트 제거 상세 정보</p>
                    <button class="delete" aria-label="close" onclick="document.getElementById('risky-ports-detail-modal').remove()"></button>
                </header>
                <section class="modal-card-body">
                    <div class="content">
                        <h4 class="mb-4">정책: <strong>${data.policy?.rule_name || 'N/A'}</strong></h4>
    `;
    
    // 위험 포트가 제거된 경우
    if (removed.length > 0) {
        modalHtml += `
                        <div class="notification is-warning is-light mb-4">
                            <strong>제거된 위험 포트:</strong> ${removed.map(r => `${r.protocol}/${r.port}`).join(', ')}
                        </div>
        `;
    } else {
        modalHtml += `
                        <div class="notification is-success is-light mb-4">
                            <strong>위험 포트 없음:</strong> 원본 서비스를 그대로 사용할 수 있습니다.
                        </div>
        `;
    }
    
    // 원본 서비스와 제거 후 서비스 비교 테이블
    modalHtml += `
                        <table class="table is-fullwidth is-striped">
                            <thead>
                                <tr>
                                    <th style="width: 40%;">원본 서비스</th>
                                    <th style="width: 60%;">제거 후 서비스</th>
                                </tr>
                            </thead>
                            <tbody>
    `;
    
    // 원본 서비스 객체별로 매핑
    originalServiceObjects.forEach(originalObj => {
        const originalName = originalObj.name || originalObj.token || '';
        
        // 제거 후 서비스 객체 찾기 (original_name으로 매칭)
        const filteredObj = filteredServiceObjects.find(f => 
            f.original_name === originalName || (f.original_name === originalName && f.name === originalName)
        );
        
        let originalDisplay = '';
        if (originalObj.type === 'group') {
            originalDisplay = `<strong>${originalName}</strong> <span class="tag is-info is-light">그룹</span>`;
        } else {
            originalDisplay = `<strong>${originalName}</strong>`;
        }
        
        let filteredDisplay = '';
        if (filteredObj) {
            const filteredName = filteredObj.name || filteredObj.token || '';
            if (filteredObj.type === 'group') {
                filteredDisplay = `<strong>${filteredName}</strong> <span class="tag is-info is-light">그룹</span>`;
            } else {
                filteredDisplay = `<strong>${filteredName}</strong>`;
            }
            
            // 원본과 다르면 원본 표시
            if (filteredObj.original_name && filteredObj.original_name !== filteredObj.name) {
                filteredDisplay += `<br><small class="has-text-grey">(원본: ${filteredObj.original_name})</small>`;
            }
            
            // 필터된 토큰 표시
            if (filteredObj.filtered_tokens && filteredObj.filtered_tokens.length > 0) {
                filteredDisplay += `<br><small class="has-text-grey">${filteredObj.filtered_tokens.join(', ')}</small>`;
            }
        } else {
            // 매칭되는 제거 후 서비스가 없으면 원본 그대로 사용
            filteredDisplay = `<strong>${originalName}</strong> <span class="tag is-success is-light">원본 그대로</span>`;
        }
        
        modalHtml += `
            <tr>
                <td>${originalDisplay}</td>
                <td>${filteredDisplay}</td>
            </tr>
        `;
    });
    
    modalHtml += `
                            </tbody>
                        </table>
                    </div>
                </section>
                <footer class="modal-card-foot">
                    <button class="button is-primary" onclick="document.getElementById('risky-ports-detail-modal').remove()">닫기</button>
                </footer>
            </div>
        </div>
    `;
    
    // 모달 추가
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = modalHtml;
    document.body.appendChild(tempDiv.firstElementChild);
    
    // 배경 클릭 시 닫기
    const modal = document.getElementById('risky-ports-detail-modal');
    const background = modal.querySelector('.modal-background');
    if (background) {
        background.addEventListener('click', () => modal.remove());
    }
}

