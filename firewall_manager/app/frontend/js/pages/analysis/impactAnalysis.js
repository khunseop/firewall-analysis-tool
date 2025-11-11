import { api } from '../../api.js';

/**
 * 영향도 분석 관련 UI 및 로직 관리
 */

let allPolicies = [];
let targetPolicySelect = null;
let destinationPolicySelect = null;
let deviceSelect = null;

/**
 * 영향도 분석 컴포넌트 초기화
 * @param {Object} select - 장비 선택 TomSelect 인스턴스
 */
export function initImpactAnalysis(select) {
    deviceSelect = select;
}

/**
 * 정책 목록 로드 및 TomSelect 초기화
 */
export async function loadPoliciesForImpact() {
    const deviceId = deviceSelect ? deviceSelect.getValue() : null;
    if (!deviceId) {
        return;
    }

    try {
        const policies = await api.getPolicies(deviceId);
        // 활성화된 정책만 필터링하고 seq 순서로 정렬
        allPolicies = policies
            .filter(p => p.is_active === true && p.enable === true)
            .sort((a, b) => {
                const seqA = a.seq || 0;
                const seqB = b.seq || 0;
                return seqA - seqB;
            });

        // 정책명과 seq를 표시하는 옵션 생성
        const policyOptions = allPolicies.map(policy => ({
            value: policy.id,
            text: `[${policy.seq || 'N/A'}] ${policy.rule_name}`
        }));

        // 대상 정책 선택 초기화
        const targetSelectEl = document.getElementById('impact-target-policy-select');
        if (targetSelectEl && window.TomSelect) {
            if (targetSelectEl.tomselect) {
                try { targetSelectEl.tomselect.destroy(); } catch (e) {}
            }
            targetSelectEl.innerHTML = '<option value="">대상 정책 선택</option>';
            policyOptions.forEach(opt => {
                const option = document.createElement('option');
                option.value = opt.value;
                option.textContent = opt.text;
                targetSelectEl.appendChild(option);
            });
            targetPolicySelect = new window.TomSelect(targetSelectEl, {
                placeholder: '대상 정책 선택 (여러 개 선택 가능, 붙여넣기 지원)',
                maxOptions: null,
                multiple: true, // 다중 선택 활성화
                plugins: ['remove_button'], // 정책조회의 장비 선택과 동일한 UI
                onChange: () => {
                    updateDestinationPolicySelect();
                }
            });

            // 붙여넣기 이벤트 핸들러 추가
            // TomSelect의 onInitialize 이벤트를 사용하여 완전히 초기화된 후 실행
            targetPolicySelect.on('initialize', () => {
                setupPasteHandler(targetPolicySelect, targetSelectEl);
            });
            
            // 이미 초기화된 경우를 대비한 폴백
            if (targetPolicySelect.isReady) {
                setupPasteHandler(targetPolicySelect, targetSelectEl);
            } else {
                setTimeout(() => {
                    setupPasteHandler(targetPolicySelect, targetSelectEl);
                }, 200);
            }
        }

        // 목적지 정책 선택 초기화
        const destSelectEl = document.getElementById('impact-destination-policy-select');
        if (destSelectEl && window.TomSelect) {
            if (destSelectEl.tomselect) {
                try { destSelectEl.tomselect.destroy(); } catch (e) {}
            }
            destSelectEl.innerHTML = '<option value="">목적지 정책 선택</option>';
            policyOptions.forEach(opt => {
                const option = document.createElement('option');
                option.value = opt.value;
                option.textContent = opt.text;
                destSelectEl.appendChild(option);
            });
            destinationPolicySelect = new window.TomSelect(destSelectEl, {
                placeholder: '목적지 정책 선택',
                maxOptions: null
            });
        }
    } catch (err) {
        console.error('Failed to load policies:', err);
        alert('정책 목록을 불러오는 데 실패했습니다.');
    }
}

/**
 * 붙여넣기 이벤트 핸들러 설정
 * @param {Object} tomSelect - TomSelect 인스턴스
 * @param {HTMLElement} selectEl - select 엘리먼트
 */
function setupPasteHandler(tomSelect, selectEl) {
    if (!tomSelect || !selectEl) {
        console.warn('setupPasteHandler: tomSelect 또는 selectEl이 없습니다.');
        return;
    }

    // allPolicies가 로드되었는지 확인
    if (!allPolicies || allPolicies.length === 0) {
        console.warn('setupPasteHandler: allPolicies가 로드되지 않았습니다.');
        return;
    }

    // TomSelect의 입력 필드 찾기
    // 방법 1: TomSelect 인스턴스의 control_input 속성 사용 (가장 안정적)
    let input = tomSelect.control_input;
    
    // 방법 2: DOM에서 직접 찾기
    if (!input) {
        const wrapper = selectEl.closest('.ts-wrapper') || document.querySelector(`#${selectEl.id}`)?.closest('.ts-wrapper');
        if (wrapper) {
            input = wrapper.querySelector('input.ts-input') || 
                    wrapper.querySelector('input[type="text"]') || 
                    wrapper.querySelector('input');
        }
    }
    
    // 방법 3: selectEl의 부모에서 찾기
    if (!input && selectEl.parentElement) {
        input = selectEl.parentElement.querySelector('input.ts-input') || 
                selectEl.parentElement.querySelector('input[type="text"]') || 
                selectEl.parentElement.querySelector('input');
    }
    
    if (!input) {
        console.warn('setupPasteHandler: 입력 필드를 찾을 수 없습니다. selectEl:', selectEl);
        // 재시도 (DOM이 아직 완전히 렌더링되지 않았을 수 있음)
        setTimeout(() => {
            setupPasteHandler(tomSelect, selectEl);
        }, 300);
        return;
    }

    // 이미 이벤트 리스너가 등록되어 있는지 확인 (data 속성 사용)
    if (input.dataset.pasteHandlerAttached === 'true') {
        return; // 이미 등록됨
    }
    
    // 이벤트 리스너 등록 표시
    input.dataset.pasteHandlerAttached = 'true';

    // 붙여넣기 이벤트 리스너 추가
    input.addEventListener('paste', (e) => {
        e.stopPropagation();
        
        // 클립보드 데이터 가져오기
        const pastedText = (e.clipboardData || window.clipboardData).getData('text');
        if (!pastedText || !pastedText.trim()) {
            console.log('붙여넣기: 빈 텍스트');
            return;
        }

        // 기본 붙여넣기 동작 방지
        e.preventDefault();

        console.log('붙여넣기 텍스트:', pastedText);
        console.log('사용 가능한 정책 수:', allPolicies.length);

        // 텍스트 파싱 (줄바꿈, 쉼표, 탭 등으로 구분)
        const lines = pastedText
            .split(/[\n\r,;\t]+/)
            .map(line => line.trim())
            .filter(line => line.length > 0);

        if (lines.length === 0) {
            console.log('붙여넣기: 파싱된 라인이 없음');
            return;
        }

        console.log('파싱된 라인:', lines);

        // 각 라인을 정책과 매칭
        const matchedPolicyIds = [];
        const unmatchedLines = [];

        lines.forEach(line => {
            // 1. [seq] rule_name 형식으로 매칭 (가장 구체적)
            const seqMatch = line.match(/^\[(\d+)\]\s*(.+)$/);
            if (seqMatch) {
                const seq = parseInt(seqMatch[1]);
                const ruleName = seqMatch[2].trim();
                const policy = allPolicies.find(p => p.seq === seq && p.rule_name === ruleName);
                if (policy) {
                    matchedPolicyIds.push(policy.id);
                    console.log(`매칭 성공 [seq] 형식: ${line} -> ${policy.id}`);
                    return;
                }
            }

            // 2. 정책 ID로 직접 매칭 (숫자만 있는 경우)
            if (/^\d+$/.test(line)) {
                const numValue = parseInt(line);
                // 먼저 정책 ID로 시도
                let policy = allPolicies.find(p => p.id === numValue);
                if (policy) {
                    matchedPolicyIds.push(policy.id);
                    console.log(`매칭 성공 (정책 ID): ${line} -> ${policy.id}`);
                    return;
                }
                // 정책 ID로 매칭 실패 시 seq로 시도
                policy = allPolicies.find(p => p.seq === numValue);
                if (policy) {
                    matchedPolicyIds.push(policy.id);
                    console.log(`매칭 성공 (seq): ${line} -> ${policy.id}`);
                    return;
                }
            }

            // 3. 정책명으로 매칭
            const policy = allPolicies.find(p => p.rule_name === line);
            if (policy) {
                matchedPolicyIds.push(policy.id);
                console.log(`매칭 성공 (정책명): ${line} -> ${policy.id}`);
                return;
            }

            // 매칭 실패
            console.log(`매칭 실패: ${line}`);
            unmatchedLines.push(line);
        });

        console.log('매칭된 정책 ID:', matchedPolicyIds);
        console.log('매칭 실패:', unmatchedLines);

        // 매칭된 정책들을 TomSelect에 추가
        if (matchedPolicyIds.length > 0) {
            const currentValues = tomSelect.getValue() || [];
            const newValues = Array.isArray(currentValues) ? currentValues : [currentValues];
            
            // 중복 제거하면서 추가
            const uniqueIds = [...new Set([...newValues.map(v => String(v)), ...matchedPolicyIds.map(id => String(id))])];
            console.log('설정할 값:', uniqueIds);
            tomSelect.setValue(uniqueIds);
            
            // 입력 필드 초기화
            if (input) {
                input.value = '';
            }
            tomSelect.refreshOptions(false);

            // 결과 알림
            if (unmatchedLines.length > 0) {
                const unmatchedMsg = unmatchedLines.slice(0, 5).join(', ');
                const moreMsg = unmatchedLines.length > 5 ? ` 외 ${unmatchedLines.length - 5}개` : '';
                alert(`${matchedPolicyIds.length}개 정책이 추가되었습니다.\n\n매칭되지 않은 항목: ${unmatchedMsg}${moreMsg}`);
            } else {
                console.log(`${matchedPolicyIds.length}개 정책이 추가되었습니다.`);
            }
        } else {
            alert(`매칭되는 정책을 찾을 수 없습니다.\n\n입력 형식:\n- 정책 ID: 1, 2, 3\n- 정책명: Policy1, Policy2\n- [seq] 형식: [1] Policy1\n\n현재 정책 수: ${allPolicies.length}개`);
        }
    }, true); // capture phase에서도 실행
}

/**
 * 목적지 정책 선택 목록 업데이트 (대상 정책 제외)
 */
function updateDestinationPolicySelect() {
    const targetPolicyIds = targetPolicySelect ? targetPolicySelect.getValue() : null;
    if (!targetPolicyIds || !destinationPolicySelect) return;

    const destSelectEl = document.getElementById('impact-destination-policy-select');
    if (!destSelectEl) return;

    // 여러 정책 ID를 배열로 변환 (TomSelect는 배열 또는 문자열 반환)
    const targetIdsArray = Array.isArray(targetPolicyIds) 
        ? targetPolicyIds.map(id => parseInt(id))
        : [parseInt(targetPolicyIds)];

    // 대상 정책들을 제외한 정책 목록으로 업데이트
    const filteredOptions = allPolicies
        .filter(p => !targetIdsArray.includes(p.id))
        .map(p => ({
            value: p.id,
            text: `[${p.seq || 'N/A'}] ${p.rule_name}`
        }));

    // TomSelect 업데이트
    const currentValue = destinationPolicySelect.getValue();
    destinationPolicySelect.clearOptions();
    filteredOptions.forEach(opt => {
        destinationPolicySelect.addOption({ value: opt.value, text: opt.text });
    });
    
    // 이전 값이 있으면 복원 (유효한 경우)
    if (currentValue && filteredOptions.some(opt => opt.value === currentValue)) {
        destinationPolicySelect.setValue(currentValue);
    } else {
        destinationPolicySelect.clear();
    }
}

/**
 * 영향도 분석 파라미터 추출
 * @returns {Object|null} 분석 파라미터 또는 null (유효하지 않은 경우)
 */
export function getImpactAnalysisParams() {
    const targetPolicyIds = targetPolicySelect ? targetPolicySelect.getValue() : null;
    const destinationPolicyId = destinationPolicySelect ? destinationPolicySelect.getValue() : null;
    const moveDirectionEl = document.getElementById('impact-move-direction');
    const moveDirection = moveDirectionEl ? moveDirectionEl.value : 'below';

    // 여러 정책 ID를 배열로 변환
    let targetIdsArray = [];
    if (targetPolicyIds) {
        if (Array.isArray(targetPolicyIds)) {
            targetIdsArray = targetPolicyIds.map(id => parseInt(id));
        } else {
            targetIdsArray = [parseInt(targetPolicyIds)];
        }
    }

    if (targetIdsArray.length === 0) {
        alert('대상 정책을 선택하세요.');
        return null;
    }
    if (!destinationPolicyId) {
        alert('목적지 정책을 선택하세요.');
        return null;
    }

    // 정책 ID로 정책 찾기
    const targetPolicies = targetIdsArray
        .map(id => allPolicies.find(p => p.id === id))
        .filter(p => p !== undefined);
    const destinationPolicy = allPolicies.find(p => p.id === parseInt(destinationPolicyId));

    if (targetPolicies.length !== targetIdsArray.length) {
        alert('선택한 대상 정책 중 일부를 찾을 수 없습니다.');
        return null;
    }
    if (!destinationPolicy) {
        alert('선택한 목적지 정책을 찾을 수 없습니다.');
        return null;
    }

    // 정책 목록에서의 인덱스 찾기 (seq 순서로 정렬된 목록 기준)
    const destIndex = allPolicies.findIndex(p => p.id === parseInt(destinationPolicyId));
    
    if (destIndex === -1) {
        alert('목적지 정책 위치를 계산할 수 없습니다.');
        return null;
    }

    // 새 위치 계산 (인덱스 기반)
    // 백엔드는 정책 목록을 seq 순서로 정렬하여 인덱스를 사용함
    let newPosition;
    if (moveDirection === 'above') {
        // 위로 이동: 목적지 정책의 인덱스 위치
        newPosition = destIndex;
    } else {
        // 아래로 이동: 목적지 정책의 인덱스 + 1 위치
        newPosition = destIndex + 1;
    }

    return {
        targetPolicyIds: targetIdsArray,
        newPosition: newPosition
    };
}

