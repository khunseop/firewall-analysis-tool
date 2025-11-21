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
    console.log(`[ScriptGenerator] 전체 serviceGroups: ${Array.from(serviceGroups.keys()).join(', ')}`);
    console.log(`[ScriptGenerator] 전체 serviceObjectsToGroups: ${Array.from(serviceObjectsToGroups.keys()).join(', ')}`);
    
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
                console.log(`[ScriptGenerator] 그룹 ${name}은 serviceObjectsToGroups에 포함되어 제외됨`);
                return;
            }
            
            // 백엔드에서 제공하는 filtered_members 사용
            // filtered_members에는 위험 포트가 없는 멤버만 포함되어 있으며,
            // 이들은 방화벽에 이미 존재하는 객체이므로 그대로 사용 가능
            const filteredMembers = group.filtered_members || [];
            
            console.log(`[ScriptGenerator] 그룹 ${name} 처리 중: filtered_members=${JSON.stringify(filteredMembers)}`);
            
            if (filteredMembers.length === 0) {
                console.log(`[ScriptGenerator] 그룹 ${name}의 filtered_members가 비어있어서 스킵됨`);
                return;
            }
            
            // filtered_members에 있는 멤버 이름 처리
            // 백엔드에서 이미 Safe 이름을 포함하여 전달함 (예: "Svc_8080_Safe" 또는 "Svc_9090")
            const validMembers = [];
            
            filteredMembers.forEach(member => {
                // member가 이미 _Safe로 끝나는 경우 (백엔드에서 이미 Safe 이름으로 전달됨)
                if (member.endsWith('_Safe')) {
                    // 이미 Safe 이름이므로 그대로 사용
                    // createdServiceNames에 있으면 새로 생성될 객체, 없으면 이미 존재하는 객체
                    if (createdServiceNames.has(member)) {
                        validMembers.push(member);
                        console.log(`[ScriptGenerator] 멤버 ${member} (새로 생성될 Safe 버전)`);
                    } else if (serviceObjectsToGroups.has(member)) {
                        // 여러 포트 범위로 분리된 Safe 버전 사용
                        const separatedMembers = serviceObjectsToGroups.get(member);
                        validMembers.push(...separatedMembers);
                        console.log(`[ScriptGenerator] 멤버 ${member} -> ${separatedMembers.join(', ')} (분리된 Safe 버전 사용)`);
                    } else {
                        // 이미 존재하는 Safe 객체 (이론적으로는 발생하지 않아야 함)
                        validMembers.push(member);
                        console.log(`[ScriptGenerator] 멤버 ${member} (이미 존재하는 Safe 버전)`);
                    }
                } else {
                    // 원본 멤버 이름인 경우
                    // Safe 버전이 새로 생성되었는지 확인
                    const safeMemberName = `${member}_Safe`;
                    if (createdServiceNames.has(safeMemberName)) {
                        // 새로 생성된 Safe 버전 사용
                        validMembers.push(safeMemberName);
                        console.log(`[ScriptGenerator] 멤버 ${member} -> ${safeMemberName} (새로 생성된 Safe 버전 사용)`);
                    } else if (serviceObjectsToGroups.has(safeMemberName)) {
                        // 여러 포트 범위로 분리된 Safe 버전 사용
                        const separatedMembers = serviceObjectsToGroups.get(safeMemberName);
                        validMembers.push(...separatedMembers);
                        console.log(`[ScriptGenerator] 멤버 ${member} -> ${separatedMembers.join(', ')} (분리된 Safe 버전 사용)`);
                    } else {
                        // 원본 멤버 그대로 사용 (방화벽에 이미 존재하는 객체)
                        validMembers.push(member);
                        console.log(`[ScriptGenerator] 멤버 ${member} (원본 그대로 사용)`);
                    }
                }
            });
            
            console.log(`[ScriptGenerator] 그룹 ${name}의 validMembers: ${JSON.stringify(validMembers)}`);
            
            if (validMembers.length === 0) {
                console.log(`[ScriptGenerator] 그룹 ${name}의 validMembers가 비어있어서 스킵됨`);
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
 * @param {string} filename - 파일명 (확장자 제외, 날짜_구분_장비명 형식 권장)
 */
export function downloadScript(scriptText, filename = null) {
    // 파일명이 제공되지 않으면 기본값 사용 (날짜_구분 형식)
    let finalFilename = filename;
    if (!finalFilename) {
        const dateStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        finalFilename = `${dateStr}_위험포트스크립트`;
    }
    
    const blob = new Blob([scriptText], { type: 'text/plain;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${finalFilename}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
}

