import { formatNumber } from '../../date.js';
import { getPolicyColumns, applyObjectRenderer } from './common.js';

/**
 *정책이동 영향분석 컬럼 정의
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
            maxWidth: 250,
            pinned: 'left',
            valueGetter: params => {
                const data = params.data;
                if (data.is_target_policy) {
                    // 대상 정책 행: 대상 정책 정보 표시 (최종 seq만 표시)
                    const originalSeq = data.target_original_seq || data.target_policy?.seq || '?';
                    const newSeq = data.target_new_seq || '?';
                    return `▶ ${data.target_policy_name || ''} (${originalSeq} → ${newSeq})`;
                } else {
                    // 영향받는 정책 행: 빈 값
                    return '';
                }
            },
            cellStyle: params => {
                const data = params.data;
                if (data.is_target_policy) {
                    return {
                        fontWeight: 'bold',
                        color: '#1976d2',
                        backgroundColor: '#e3f2fd'
                    };
                }
                return {
                    fontWeight: '500',
                    color: '#1976d2'
                };
            },
            filterParams: {
                buttons: ['apply', 'reset'],
                debounceMs: 200
            }
        },
        { 
            field: 'impact_type', 
            headerName: '유형', 
            filter: 'agTextColumnFilter',
            sortable: false,
            width: 100,
            pinned: 'left',
            valueGetter: params => {
                const data = params.data;
                if (data.is_target_policy) {
                    return '대상 정책';
                }
                return params.data.impact_type || '';
            },
            cellStyle: params => {
                const data = params.data;
                if (data.is_target_policy) {
                    return {
                        backgroundColor: '#e3f2fd',
                        fontWeight: 'bold'
                    };
                }
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
            maxWidth: 250,
            pinned: 'left',
            valueGetter: params => {
                const data = params.data;
                if (data.is_target_policy) {
                    return '';
                }
                const policy = params.data.policy;
                const seq = params.data.current_position;
                return policy ? `${policy.rule_name || ''}` : '';
            },
            cellStyle: params => {
                const data = params.data;
                if (data.is_target_policy) {
                    return {
                        backgroundColor: '#e3f2fd'
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
            field: 'current_position', 
            headerName: 'Seq', 
            filter: 'agNumberColumnFilter',
            sortable: true,
            width: 70,
            pinned: 'left',
            valueGetter: params => {
                const data = params.data;
                if (data.is_target_policy) {
                    return null;
                }
                return params.data.current_position;
            },
            valueFormatter: params => {
                if (params.data?.is_target_policy) {
                    return '';
                }
                return params.value != null ? formatNumber(params.value) : '-';
            },
            cellStyle: params => {
                const data = params.data;
                if (data.is_target_policy) {
                    return {
                        backgroundColor: '#e3f2fd'
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
            minWidth: 250,
            wrapText: true,
            autoHeight: true,
            valueGetter: params => {
                const data = params.data;
                if (data.is_target_policy) {
                    return '';
                }
                return params.data.reason;
            },
            cellStyle: params => {
                const data = params.data;
                if (data.is_target_policy) {
                    return {
                        backgroundColor: '#e3f2fd'
                    };
                }
                return null;
            },
            filterParams: {
                buttons: ['apply', 'reset'],
                debounceMs: 200
            }
        },
        ...policyColumns.map(col => {
            // 정책 관련 컬럼들도 대상 정책 행일 때는 스타일 적용
            const originalCellStyle = col.cellStyle;
            return {
                ...col,
                cellStyle: params => {
                    const data = params.data;
                    if (data.is_target_policy) {
                        return {
                            backgroundColor: '#e3f2fd'
                        };
                    }
                    if (originalCellStyle) {
                        if (typeof originalCellStyle === 'function') {
                            return originalCellStyle(params);
                        }
                        return originalCellStyle;
                    }
                    return null;
                },
                valueGetter: params => {
                    const data = params.data;
                    if (data.is_target_policy) {
                        // 대상 정책 행일 때는 대상 정책 정보 표시
                        if (col.field === 'rule_name') {
                            return data.target_policy_name || '';
                        }
                        if (col.field === 'seq') {
                            return data.target_original_seq || data.target_policy?.seq || null;
                        }
                        // 다른 필드는 대상 정책 객체에서 가져오기
                        if (data.target_policy && col.field) {
                            return data.target_policy[col.field] || null;
                        }
                        return null;
                    }
                    // 영향받는 정책 행일 때는 기존 로직 사용
                    if (col.valueGetter) {
                        return col.valueGetter(params);
                    }
                    return params.data[col.field] || null;
                }
            };
        })
    ];
}

