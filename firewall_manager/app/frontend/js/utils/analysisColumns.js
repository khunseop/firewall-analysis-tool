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
                headerName: '현재 위치', 
                filter: 'agNumberColumnFilter',
                sortable: false,
                minWidth: 100,
                valueGetter: params => params.data.current_position,
                valueFormatter: params => formatNumber(params.value),
                filterParams: {
                    buttons: ['apply', 'reset'],
                    debounceMs: 200
                }
            },
            { 
                field: 'new_position', 
                headerName: '새 위치', 
                filter: 'agNumberColumnFilter',
                sortable: false,
                minWidth: 100,
                valueGetter: params => params.data.new_position,
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
                minWidth: 120,
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
                minWidth: 200,
                valueGetter: params => params.data.reason,
                filterParams: {
                    buttons: ['apply', 'reset'],
                    debounceMs: 200
                }
            },
            ...policyColumns
        ];
    }
    return policyColumns;
}

