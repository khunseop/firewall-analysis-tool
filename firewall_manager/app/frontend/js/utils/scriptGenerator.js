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
                    
                    // 포트 문자열 생성
                    const portStrings = mergedRanges.map(r => 
                        r.start === r.end ? r.start.toString() : `${r.start}-${r.end}`
                    );
                    
                    // 원본 이름이 있으면 주석 추가
                    if (obj.original_name && obj.original_name !== name) {
                        scriptLines.push(`# 원본: ${obj.original_name}`);
                    }
                    
                    // Palo Alto CLI 형식: set service <name> protocol <protocol> port <port>
                    scriptLines.push(`set service ${name} protocol ${protocol} port ${portStrings.join(' ')}`);
                });
                
                scriptLines.push('');
            } else if (vendor === 'secui_ngf' || vendor === 'secui_mf2') {
                scriptLines.push(`# 서비스 객체: ${name} (원본: ${obj.original_name || name})`);
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
    
    // 서비스 그룹 생성 스크립트
    if (serviceGroups.size > 0) {
        scriptLines.push('# ============================================');
        scriptLines.push('# 서비스 그룹 생성');
        scriptLines.push('# ============================================');
        scriptLines.push('');
        scriptLines.push('# 주의: 서비스 그룹을 생성하기 전에 위의 서비스 객체들이 먼저 생성되어 있어야 합니다.');
        scriptLines.push('');
        
        serviceGroups.forEach((group, name) => {
            const tokens = group.filtered_tokens || [];
            if (tokens.length === 0) {
                return;
            }
            
            // 필터된 토큰들에 해당하는 서비스 객체 이름 찾기
            // 1. 먼저 이미 생성된 서비스 객체 중에서 찾기
            const memberServiceNames = new Set();
            tokens.forEach(token => {
                serviceObjects.forEach((obj, objName) => {
                    const objTokens = obj.filtered_tokens || [];
                    if (objTokens.includes(token)) {
                        memberServiceNames.add(objName);
                    }
                });
            });
            
            // 2. 매칭되는 서비스 객체가 없으면 토큰을 서비스 객체 이름으로 변환
            // (이 경우 별도로 서비스 객체를 생성해야 함)
            tokens.forEach(token => {
                let found = false;
                serviceObjects.forEach((obj, objName) => {
                    const objTokens = obj.filtered_tokens || [];
                    if (objTokens.includes(token)) {
                        found = true;
                    }
                });
                if (!found) {
                    // 토큰을 서비스 객체 이름으로 변환 (예: tcp/80 -> tcp_80_Safe)
                    const serviceName = token.replace(/\//g, '_').replace(/-/g, '_') + '_Safe';
                    memberServiceNames.add(serviceName);
                }
            });
            
            const members = Array.from(memberServiceNames);
            
            if (vendor === 'palo_alto') {
                // Palo Alto CLI 형식: set service-group <name> members [ <member1> <member2> ... ]
                if (group.original_name && group.original_name !== name) {
                    scriptLines.push(`# 서비스 그룹: ${name} (원본: ${group.original_name})`);
                }
                scriptLines.push(`set service-group ${name} members [ ${members.join(' ')} ]`);
                scriptLines.push('');
            } else if (vendor === 'secui_ngf' || vendor === 'secui_mf2') {
                scriptLines.push(`# 서비스 그룹: ${name} (원본: ${group.original_name || name})`);
                scriptLines.push(`service-group ${name}`);
                members.forEach(member => {
                    scriptLines.push(`  member ${member}`);
                });
                scriptLines.push('exit');
                scriptLines.push('');
            }
        });
    }
    
    if (serviceObjects.size === 0 && serviceGroups.size === 0) {
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

