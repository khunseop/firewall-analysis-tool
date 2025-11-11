import { formatDateTime, formatNumber } from '../../date.js';

/**
 * 공통 정책 컬럼 정의
 */
export function getPolicyColumns() {
    return [
        { 
            field: 'seq', 
            headerName: '순서', 
            filter: false,
            sortable: false,
            minWidth: 60,
            maxWidth: 100,
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
            minWidth: 80,
            maxWidth: 150,
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
            minWidth: 120,
            flex: 1,
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
            minWidth: 70,
            maxWidth: 100,
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
            minWidth: 70,
            maxWidth: 100,
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
            filter: 'agTextColumnFilter',
            sortable: false,
            minWidth: 100,
            flex: 1,
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
            filter: 'agTextColumnFilter',
            sortable: false,
            minWidth: 100,
            flex: 1,
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
            filter: 'agTextColumnFilter',
            sortable: false,
            minWidth: 100,
            flex: 1,
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
            filter: 'agTextColumnFilter',
            sortable: false,
            minWidth: 100,
            flex: 1,
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
            filter: 'agTextColumnFilter',
            sortable: false,
            minWidth: 100,
            flex: 1,
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
            minWidth: 100,
            flex: 1,
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
            minWidth: 80,
            maxWidth: 150,
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
            minWidth: 120,
            flex: 1,
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
            minWidth: 150,
            maxWidth: 200,
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
 * 객체 셀 렌더러를 정책 컬럼에 적용
 */
export function applyObjectRenderer(policyColumns, objectCellRenderer) {
    if (objectCellRenderer) {
        const objectFields = ['source', 'user', 'destination', 'service', 'application'];
        policyColumns.forEach(col => {
            if (objectFields.includes(col.field)) {
                col.cellRenderer = objectCellRenderer;
            }
        });
    }
    return policyColumns;
}

