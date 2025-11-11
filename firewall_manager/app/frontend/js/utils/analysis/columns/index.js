import { getImpactColumns } from './impact.js';
import { getRiskyPortsColumns } from './riskyPorts.js';
import { getPolicyColumns, applyObjectRenderer } from './common.js';
import { formatNumber } from '../../date.js';

/**
 * 분석 타입별 컬럼 정의 반환 (통합 인터페이스)
 * @param {string} analysisType - 분석 타입
 * @param {Function} objectCellRenderer - 객체 셀 렌더러 함수
 * @returns {Array} 컬럼 정의 배열
 */
export function getColumnDefs(analysisType, objectCellRenderer = null) {
    if (analysisType === 'impact') {
        return getImpactColumns(objectCellRenderer);
    }

    // 다른 분석 타입들은 기존 로직 사용 (점진적 마이그레이션)
    // TODO: 각 분석 타입별로 모듈 분리 필요
    const policyColumns = getPolicyColumns();
    applyObjectRenderer(policyColumns, objectCellRenderer);

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
    } else if (analysisType === 'risky_ports') {
        return getRiskyPortsColumns(objectCellRenderer);
    }
    
    // 기존 로직 (점진적 마이그레이션용 - 사용 안 함)
    if (false) {
        const serviceColumnIndex = policyColumns.findIndex(col => col.field === 'service');
        const modifiedServiceColumn = serviceColumnIndex >= 0 ? { ...policyColumns[serviceColumnIndex] } : null;
        const otherColumns = policyColumns.filter(col => col.field !== 'service');
        
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
            ...policyColumns.slice(0, 4),
            modifiedServiceColumn || { 
                field: 'service', 
                headerName: '서비스', 
                wrapText: true, 
                autoHeight: true,
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
                field: 'removed_risky_ports',
                headerName: '찾은 위험 포트',
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
                    const span = document.createElement('span');
                    span.style.color = '#d32f2f';
                    span.style.fontWeight = '500';
                    span.style.cursor = 'pointer';
                    span.title = '클릭하여 상세 정보 보기';
                    span.textContent = displayText;
                    span.addEventListener('click', (e) => {
                        e.stopPropagation();
                        if (params.data && params.data.removed_risky_ports && params.data.removed_risky_ports.length > 0) {
                            if (typeof window.showRiskyPortsDetailModal === 'function') {
                                window.showRiskyPortsDetailModal(params.data);
                            }
                        }
                    });
                    return span;
                },
                onCellClicked: (params) => {
                    if (params.data && params.data.removed_risky_ports && params.data.removed_risky_ports.length > 0) {
                        if (typeof window.showRiskyPortsDetailModal === 'function') {
                            window.showRiskyPortsDetailModal(params.data);
                        }
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
                        if (!Array.isArray(services) || services.length === 0) return '';
                        const container = document.createElement('div');
                        container.style.height = '100%';
                        container.style.maxHeight = '150px';
                        container.style.overflowY = 'auto';
                        container.style.lineHeight = '1.5';
                        services.forEach(service => {
                            const line = document.createElement('div');
                            line.textContent = service;
                            container.appendChild(line);
                        });
                        return container;
                    }
                    
                    const container = document.createElement('div');
                    container.style.height = '100%';
                    container.style.maxHeight = '150px';
                    container.style.overflowY = 'auto';
                    container.style.lineHeight = '1.5';
                    
                    serviceObjects.forEach(obj => {
                        const displayName = obj.name || obj.token || '';
                        const line = document.createElement('div');
                        if (displayName.endsWith('_Safe') || (obj.original_name && obj.original_name !== obj.name)) {
                            const span = document.createElement('span');
                            span.style.color = '#1976d2';
                            span.style.fontWeight = '500';
                            span.textContent = displayName;
                            line.appendChild(span);
                        } else {
                            line.textContent = displayName;
                        }
                        
                        if (obj.type === 'group' && obj.filtered_members && obj.filtered_members.length > 0) {
                            const membersDiv = document.createElement('div');
                            membersDiv.style.marginLeft = '20px';
                            membersDiv.style.marginTop = '4px';
                            membersDiv.style.fontSize = '0.9em';
                            membersDiv.style.color = '#666';
                            membersDiv.textContent = `멤버: ${obj.filtered_members.join(', ')}`;
                            line.appendChild(membersDiv);
                        }
                        
                        container.appendChild(line);
                    });
                    
                    return container;
                },
                valueGetter: params => {
                    const serviceObjects = params.data.filtered_service_objects || [];
                    if (serviceObjects.length > 0) {
                        return serviceObjects.map(obj => {
                            const name = obj.name || obj.token || '';
                            if (obj.type === 'group' && obj.filtered_members && obj.filtered_members.length > 0) {
                                return `${name} [${obj.filtered_members.join(', ')}]`;
                            }
                            return name;
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
            ...otherColumns.slice(4)
        ];
    }
    
    return policyColumns;
}

// 위험 포트 모달 함수는 전역으로 유지 (기존 코드와 호환)
export { getPolicyColumns };

