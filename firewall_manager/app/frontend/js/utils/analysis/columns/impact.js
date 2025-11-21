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
            valueGetter: params => {
                const data = params.data;
                const originalSeq = data.target_original_seq || data.target_policy?.seq || '?';
                const newSeq = data.target_new_seq || '?';
                const direction = data.move_direction || '';
                return `${data.target_policy_name || ''} (seq ${originalSeq} → ${newSeq}${direction ? `, ${direction}` : ''})`;
            },
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
            field: 'move_direction', 
            headerName: '이동 방향', 
            filter: 'agTextColumnFilter',
            sortable: false,
            minWidth: 80,
            maxWidth: 100,
            pinned: 'left',
            valueGetter: params => params.data.move_direction || '',
            cellStyle: params => {
                const direction = params.value;
                if (direction === '아래로') {
                    return {
                        color: '#1976d2',
                        fontWeight: '500'
                    };
                } else if (direction === '위로') {
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
            field: 'affected_policy_name', 
            headerName: '영향받는 정책', 
            filter: 'agTextColumnFilter',
            sortable: false,
            minWidth: 150,
            pinned: 'left',
            valueGetter: params => {
                const policy = params.data.policy;
                const seq = params.data.current_position;
                return policy ? `[seq ${seq || '?'}] ${policy.rule_name || ''}` : '';
            },
            filterParams: {
                buttons: ['apply', 'reset'],
                debounceMs: 200
            }
        },
        { 
            field: 'current_position', 
            headerName: '영향받는 정책 위치 (seq)', 
            filter: 'agNumberColumnFilter',
            sortable: true,
            minWidth: 120,
            maxWidth: 150,
            pinned: 'left',
            valueGetter: params => params.data.current_position,
            valueFormatter: params => params.value != null ? formatNumber(params.value) : '-',
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

