import { getPolicyColumns, applyObjectRenderer } from './common.js';

/**
 * 위험 포트 분석 컬럼 정의
 */
export function getRiskyPortsColumns(objectCellRenderer = null) {
    const policyColumns = getPolicyColumns();
    applyObjectRenderer(policyColumns, objectCellRenderer);
    
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

/**
 * 위험 포트 상세 정보 모달 표시
 */
window.showRiskyPortsDetailModal = function(data) {
    const removed = data.removed_risky_ports || [];
    const originalServiceObjects = data.original_service_objects || [];
    const filteredServiceObjects = data.filtered_service_objects || [];
    
    let modalHtml = `
        <div class="modal is-active" id="risky-ports-detail-modal">
            <div class="modal-background"></div>
            <div class="modal-card" style="max-width: 900px;">
                <header class="modal-card-head">
                    <p class="modal-card-title">위험 포트 분석 상세 정보</p>
                    <button class="delete" aria-label="close" onclick="document.getElementById('risky-ports-detail-modal').remove()"></button>
                </header>
                <section class="modal-card-body">
                    <div class="content">
                        <h4 class="mb-4">정책: <strong>${data.policy?.rule_name || 'N/A'}</strong></h4>
    `;
    
    if (removed.length > 0) {
        modalHtml += `
                        <div class="notification is-warning is-light mb-4">
                            <strong>찾은 위험 포트:</strong> ${removed.map(r => `${r.protocol}/${r.port}`).join(', ')}
                        </div>
        `;
    } else {
        modalHtml += `
                        <div class="notification is-success is-light mb-4">
                            <strong>위험 포트 없음:</strong> 기존 서비스를 그대로 사용할 수 있습니다.
                        </div>
        `;
    }
    
    const servicesWithRemovedPorts = new Set();
    removed.forEach(rp => {
        if (rp.service_name) {
            servicesWithRemovedPorts.add(rp.service_name);
        }
    });
    
    modalHtml += `
                        <table class="table is-fullwidth is-striped">
                            <thead>
                                <tr>
                                    <th style="width: 40%;">변경 전</th>
                                    <th style="width: 60%;">변경 후</th>
                                </tr>
                            </thead>
                            <tbody>
    `;
    
    originalServiceObjects.forEach(originalObj => {
        const originalName = originalObj.name || originalObj.token || '';
        const hasRemovedPorts = servicesWithRemovedPorts.has(originalName);
        
        let originalDisplay = '';
        if (originalObj.type === 'group') {
            originalDisplay = `<strong>${originalName}</strong> <span class="tag is-info is-light">그룹</span>`;
        } else {
            originalDisplay = `<strong>${originalName}</strong>`;
        }
        
        let filteredDisplay = '';
        
        if (hasRemovedPorts) {
            const safeName = `${originalName}_Safe`;
            const filteredObj = filteredServiceObjects.find(f => 
                f.name === safeName || (f.original_name === originalName && f.name.endsWith('_Safe'))
            );
            
            if (filteredObj) {
                const filteredName = filteredObj.name || filteredObj.token || '';
                if (filteredObj.type === 'group') {
                    filteredDisplay = `<strong style="color: #1976d2;">${filteredName}</strong> <span class="tag is-info is-light">그룹</span>`;
                } else {
                    filteredDisplay = `<strong style="color: #1976d2;">${filteredName}</strong>`;
                }
                
                if (filteredObj.filtered_tokens && filteredObj.filtered_tokens.length > 0) {
                    filteredDisplay += `<br><small class="has-text-grey">${filteredObj.filtered_tokens.join(', ')}</small>`;
                }
            } else {
                filteredDisplay = `<strong style="color: #d32f2f;">삭제됨</strong>`;
            }
        } else {
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
    
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = modalHtml;
    document.body.appendChild(tempDiv.firstElementChild);
    
    const modal = document.getElementById('risky-ports-detail-modal');
    const background = modal.querySelector('.modal-background');
    if (background) {
        background.addEventListener('click', () => modal.remove());
    }
};

