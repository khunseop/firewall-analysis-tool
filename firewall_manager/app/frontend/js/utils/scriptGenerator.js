/**
 * 위험 포트 분석 결과에서 서비스 객체/그룹 생성 스크립트 생성
 */

/**
 * 위험 포트 분석 결과에서 생성 스크립트 생성
 * @param {Array} resultData - 분석 결과 데이터 배열
 * @param {string} vendor - 벤더 타입 (palo_alto, secui_ngf, secui_mf2)
 * @returns {string} 생성 스크립트 텍스트
 */
export function generateServiceCreationScript(resultData, vendor = 'palo_alto') {
    if (!resultData || !Array.isArray(resultData) || resultData.length === 0) {
        return '# 생성할 서비스 객체/그룹이 없습니다.';
    }

    const scriptLines = [];
    scriptLines.push('# 위험 포트 제거 후 서비스 객체/그룹 생성 스크립트');
    scriptLines.push(`# 생성일시: ${new Date().toLocaleString('ko-KR')}`);
    scriptLines.push(`# 벤더: ${vendor}`);
    scriptLines.push('');
    
    // 모든 정책에서 filtered_service_objects 수집
    const serviceObjects = new Map(); // name -> object
    const serviceGroups = new Map(); // name -> group
    // 여러 포트 범위를 가진 서비스 객체를 그룹으로 변환하기 위한 맵
    const serviceObjectsToGroups = new Map(); // originalName -> [memberServiceNames]
    
    resultData.forEach(item => {
        const filteredObjects = item.filtered_service_objects || [];
        
        filteredObjects.forEach(obj => {
            if (obj.type === 'service') {
                // 서비스 객체는 중복 제거 (같은 이름이면 하나만)
                if (!serviceObjects.has(obj.name)) {
                    serviceObjects.set(obj.name, obj);
                }
            } else if (obj.type === 'group') {
                // 서비스 그룹도 중복 제거
                if (!serviceGroups.has(obj.name)) {
                    serviceGroups.set(obj.name, obj);
                }
            }
        });
    });
    
    // 서비스 객체 생성 스크립트
    if (serviceObjects.size > 0) {
        scriptLines.push('# ============================================');
        scriptLines.push('# 서비스 객체 생성');
        scriptLines.push('# ============================================');
        scriptLines.push('');
        
        serviceObjects.forEach((obj, name) => {
            const tokens = obj.filtered_tokens || [];
            if (tokens.length === 0) {
                return;
            }
            
            // 기존 방화벽에 존재하는 서비스 객체는 생성하지 않음 (원본 그대로 재사용)
            if (obj.original_name && obj.original_name === name) {
                return;
            }
            
            // 벤더별 스크립트 생성
            if (vendor === 'palo_alto') {
                // Palo Alto CLI 형식: set service <name> protocol <protocol> port <port>
                // 각 프로토콜/포트 조합마다 별도의 서비스 객체 생성
                const serviceObjectsByProtocol = {}; // {protocol: [ports]}
                
                tokens.forEach(token => {
                    if (token.includes('/')) {
                        const [proto, port] = token.split('/');
                        if (!serviceObjectsByProtocol[proto]) {
                            serviceObjectsByProtocol[proto] = [];
                        }
                        serviceObjectsByProtocol[proto].push(port);
                    }
                });
                
                // 각 프로토콜별로 서비스 객체 생성
                Object.entries(serviceObjectsByProtocol).forEach(([protocol, ports]) => {
                    // 포트를 범위로 병합 (연속된 포트는 범위로 표시)
                    const sortedPorts = ports.map(p => {
                        if (p.includes('-')) {
                            const [start, end] = p.split('-').map(Number);
                            return { start, end };
                        }
                        const num = Number(p);
                        return { start: num, end: num };
                    }).sort((a, b) => a.start - b.start);
                    
                    // 연속된 포트 범위 병합
                    const mergedRanges = [];
                    let currentRange = sortedPorts[0];
                    for (let i = 1; i < sortedPorts.length; i++) {
                        if (sortedPorts[i].start <= currentRange.end + 1) {
                            currentRange.end = Math.max(currentRange.end, sortedPorts[i].end);
                        } else {
                            mergedRanges.push(currentRange);
                            currentRange = sortedPorts[i];
                        }
                    }
                    mergedRanges.push(currentRange);
                    
                    // 포트 범위가 1개면 서비스 객체로 생성, 2개 이상이면 각각 개별 서비스 객체 생성 후 그룹으로 변환
                    if (mergedRanges.length === 1) {
                        // 포트 범위가 1개면 그대로 서비스 객체 생성
                        const portString = mergedRanges[0].start === mergedRanges[0].end 
                            ? mergedRanges[0].start.toString() 
                            : `${mergedRanges[0].start}-${mergedRanges[0].end}`;
                        scriptLines.push(`set service ${name} protocol ${protocol} port ${portString}`);
                    } else {
                        // 포트 범위가 2개 이상이면 각각 개별 서비스 객체 생성
                        const memberServiceNames = [];
                        mergedRanges.forEach((range, index) => {
                            const portString = range.start === range.end 
                                ? range.start.toString() 
                                : `${range.start}-${range.end}`;
                            // 프로토콜을 포함한 멤버 이름 생성 (프로토콜별 이름 충돌 방지)
                            const memberServiceName = `${name}_${protocol.toUpperCase()}_${index + 1}`;
                            memberServiceNames.push(memberServiceName);
                            scriptLines.push(`set service ${memberServiceName} protocol ${protocol} port ${portString}`);
                        });
                        
                        // 서비스 그룹으로 변환할 정보 저장
                        if (!serviceObjectsToGroups.has(name)) {
                            serviceObjectsToGroups.set(name, []);
                        }
                        serviceObjectsToGroups.get(name).push(...memberServiceNames);
                    }
                });
                
                scriptLines.push('');
            } else if (vendor === 'secui_ngf' || vendor === 'secui_mf2') {
                scriptLines.push(`service ${name}`);
                
                // 토큰들을 프로토콜별로 그룹화
                const tokensByProtocol = {};
                tokens.forEach(token => {
                    if (token.includes('/')) {
                        const [proto, port] = token.split('/');
                        if (!tokensByProtocol[proto]) {
                            tokensByProtocol[proto] = [];
                        }
                        tokensByProtocol[proto].push(port);
                    }
                });
                
                Object.entries(tokensByProtocol).forEach(([protocol, ports]) => {
                    ports.forEach(port => {
                        scriptLines.push(`  ${protocol} ${port}`);
                    });
                });
                
                scriptLines.push('exit');
                scriptLines.push('');
            }
        });
    }
    
    // 여러 포트 범위를 가진 서비스 객체를 서비스 그룹으로 변환
    if (serviceObjectsToGroups.size > 0) {
        scriptLines.push('# ============================================');
        scriptLines.push('# 서비스 그룹 생성 (여러 포트 범위를 가진 서비스 객체 변환)');
        scriptLines.push('# ============================================');
        scriptLines.push('');
        scriptLines.push('# 주의: 서비스 그룹을 생성하기 전에 위의 서비스 객체들이 먼저 생성되어 있어야 합니다.');
        scriptLines.push('');
        
        serviceObjectsToGroups.forEach((members, originalName) => {
            if (vendor === 'palo_alto') {
                // Palo Alto CLI 형식: set service-group <name> members [ <member1> <member2> ... ]
                scriptLines.push(`set service-group ${originalName} members [ ${members.join(' ')} ]`);
                scriptLines.push('');
            } else if (vendor === 'secui_ngf' || vendor === 'secui_mf2') {
                scriptLines.push(`service-group ${originalName}`);
                members.forEach(member => {
                    scriptLines.push(`  member ${member}`);
                });
                scriptLines.push('exit');
                scriptLines.push('');
            }
        });
    }
    
    // 서비스 그룹 생성 스크립트
    if (serviceGroups.size > 0) {
        scriptLines.push('# ============================================');
        scriptLines.push('# 서비스 그룹 생성');
        scriptLines.push('# ============================================');
        scriptLines.push('');
        scriptLines.push('# 주의: 서비스 그룹을 생성하기 전에 위의 서비스 객체들이 먼저 생성되어 있어야 합니다.');
        scriptLines.push('');
        
        // 실제로 스크립트에 생성될 서비스 객체 이름 집합 생성
        const createdServiceNames = new Set();
        serviceObjects.forEach((obj, name) => {
            // 원본 서비스 객체는 스크립트에 생성하지 않지만, 그룹 멤버로는 사용 가능
            if (obj.original_name && obj.original_name === name) {
                // 원본 객체는 스크립트에 생성하지 않음 (이미 방화벽에 존재)
                // 하지만 그룹 멤버로는 사용 가능하므로 createdServiceNames에 추가하지 않음
            } else {
                // 새로 생성되는 서비스 객체
                createdServiceNames.add(name);
                
                // 여러 포트 범위로 분리된 경우, 분리된 멤버 이름도 추가
                if (serviceObjectsToGroups.has(name)) {
                    const members = serviceObjectsToGroups.get(name);
                    members.forEach(member => createdServiceNames.add(member));
                }
            }
        });
        
        // 모든 filtered_service_objects에서 서비스 객체 이름 수집 (원본 포함)
        // 그룹의 filtered_members에 포함된 멤버가 실제로 존재하는지 확인하기 위해
        const allServiceObjectNames = new Set();
        resultData.forEach(item => {
            const filteredObjects = item.filtered_service_objects || [];
            filteredObjects.forEach(obj => {
                if (obj.type === 'service') {
                    allServiceObjectNames.add(obj.name);
                }
            });
        });
        
        serviceGroups.forEach((group, name) => {
            // serviceObjectsToGroups에 포함된 그룹은 이미 위에서 처리했으므로 제외
            if (serviceObjectsToGroups.has(name)) {
                return;
            }
            
            // 백엔드에서 제공하는 filtered_members 사용
            const filteredMembers = group.filtered_members || [];
            
            if (filteredMembers.length === 0) {
                return;
            }
            
            // filtered_members에 포함된 멤버를 실제 스크립트에 생성된 멤버 이름으로 변환
            // 1. 새로 생성되는 서비스 객체 (스크립트에 생성됨) - createdServiceNames에 포함
            // 2. 여러 포트 범위로 분리된 서비스 객체의 원래 이름 -> 분리된 멤버 이름들로 변환
            // 3. 원본 서비스 객체 (스크립트에 생성하지 않지만, 그룹 멤버로는 사용 가능)
            const validMembers = [];
            
            filteredMembers.forEach(member => {
                // 여러 포트 범위로 분리된 서비스 객체의 원래 이름인지 확인
                // 예: Svc_1024_2048_Safe -> Svc_1024_2048_Safe_TCP_1, Svc_1024_2048_Safe_TCP_2 등으로 분리됨
                if (serviceObjectsToGroups.has(member)) {
                    // 분리된 멤버 이름들을 추가
                    const separatedMembers = serviceObjectsToGroups.get(member);
                    validMembers.push(...separatedMembers);
                }
                // 새로 생성되는 서비스 객체인지 확인 (스크립트에 생성됨)
                else if (createdServiceNames.has(member)) {
                    validMembers.push(member);
                }
                // 원본 서비스 객체인지 확인 (filtered_service_objects에 있지만 스크립트에 생성하지 않음)
                else if (allServiceObjectNames.has(member)) {
                    // 원본 서비스 객체인지 확인 (original_name === name)
                    for (const item of resultData) {
                        const filteredObjects = item.filtered_service_objects || [];
                        const found = filteredObjects.find(obj => 
                            obj.type === 'service' && 
                            obj.name === member && 
                            obj.original_name === member
                        );
                        if (found) {
                            validMembers.push(member); // 원본 서비스 객체는 그룹 멤버로 사용 가능
                            break;
                        }
                    }
                }
            });
            
            if (validMembers.length === 0) {
                return;
            }
            
            if (vendor === 'palo_alto') {
                // Palo Alto CLI 형식: set service-group <name> members [ <member1> <member2> ... ]
                scriptLines.push(`set service-group ${name} members [ ${validMembers.join(' ')} ]`);
                scriptLines.push('');
            } else if (vendor === 'secui_ngf' || vendor === 'secui_mf2') {
                scriptLines.push(`service-group ${name}`);
                validMembers.forEach(member => {
                    scriptLines.push(`  member ${member}`);
                });
                scriptLines.push('exit');
                scriptLines.push('');
            }
        });
    }
    
    if (serviceObjects.size === 0 && serviceGroups.size === 0 && serviceObjectsToGroups.size === 0) {
        scriptLines.push('# 생성할 서비스 객체/그룹이 없습니다.');
    }
    
    return scriptLines.join('\n');
}

/**
 * 스크립트를 텍스트 파일로 다운로드
 * @param {string} scriptText - 스크립트 텍스트
 * @param {string} filename - 파일명 (확장자 제외)
 */
export function downloadScript(scriptText, filename = 'service_creation_script') {
    const blob = new Blob([scriptText], { type: 'text/plain;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
}

