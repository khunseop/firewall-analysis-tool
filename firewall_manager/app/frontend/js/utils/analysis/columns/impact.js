import { formatNumber } from '../../date.js';
import { getPolicyColumns, applyObjectRenderer } from './common.js';

/**
 * 영향도 분석 컬럼 정의
 */
export function getImpactColumns(objectCellRenderer = null) {
    const policyColumns = getPolicyColumns();
    applyObjectRenderer(policyColumns, objectCellRenderer);

    return [
        { 
            field: 'target_policy_name', 
            headerName: '대상 정책', 
            filter: 'agTextColumnFilter',
            sortable: false,
            minWidth: 150,
            pinned: 'left',
            valueGetter: params => params.data.target_policy_name,
            cellStyle: {
                fontWeight: '500',
                color: '#1976d2'
            },
            filterParams: {
                buttons: ['apply', 'reset'],
                debounceMs: 200
            }
        },
        { 
            field: 'policy_id', 
            headerName: '영향받는 정책 ID', 
            filter: 'agNumberColumnFilter',
            sortable: false,
            minWidth: 80,
            maxWidth: 120,
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
            minWidth: 60,
            maxWidth: 100,
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
            minWidth: 120,
            maxWidth: 180,
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
}

