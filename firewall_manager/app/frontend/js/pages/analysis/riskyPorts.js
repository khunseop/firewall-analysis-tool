import { api } from '../../api.js';

/**
 * 위험포트 분석 관련 UI 및 로직 관리
 */

let allPolicies = [];
let targetPolicySelect = null;
let deviceSelect = null;

/**
 * 위험포트 분석 컴포넌트 초기화
 * @param {Object} select - 장비 선택 TomSelect 인스턴스
 */
export function initRiskyPortsAnalysis(select) {
    deviceSelect = select;
}

/**
 * 정책 목록 로드 및 TomSelect 초기화
 */
export async function loadPoliciesForRiskyPorts() {
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
        const targetSelectEl = document.getElementById('risky-ports-target-policy-select');
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
            });

            // 붙여넣기 이벤트 핸들러 추가
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
    } catch (err) {
        console.error('Failed to load policies for risky ports:', err);
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
    let input = tomSelect.control_input;
    
    if (!input) {
        const wrapper = selectEl.closest('.ts-wrapper') || document.querySelector(`#${selectEl.id}`)?.closest('.ts-wrapper');
        if (wrapper) {
            input = wrapper.querySelector('input.ts-input') || 
                    wrapper.querySelector('input[type="text"]') || 
                    wrapper.querySelector('input');
        }
    }
    
    if (!input && selectEl.parentElement) {
        input = selectEl.parentElement.querySelector('input.ts-input') || 
                selectEl.parentElement.querySelector('input[type="text"]') || 
                selectEl.parentElement.querySelector('input');
    }
    
    if (!input) {
        console.warn('setupPasteHandler: 입력 필드를 찾을 수 없습니다.');
        setTimeout(() => {
            setupPasteHandler(tomSelect, selectEl);
        }, 300);
        return;
    }

    // 이미 이벤트 리스너가 등록되어 있는지 확인
    if (input.dataset.pasteHandlerAttached === 'true') {
        return;
    }
    
    input.dataset.pasteHandlerAttached = 'true';

    // 붙여넣기 이벤트 리스너 추가
    input.addEventListener('paste', (e) => {
        e.stopPropagation();
        
        const pastedText = (e.clipboardData || window.clipboardData).getData('text');
        if (!pastedText || !pastedText.trim()) {
            return;
        }

        e.preventDefault();

        // 텍스트 파싱 (줄바꿈, 쉼표, 탭 등으로 구분)
        const lines = pastedText
            .split(/[\n\r,;\t]+/)
            .map(line => line.trim())
            .filter(line => line.length > 0);

        if (lines.length === 0) {
            return;
        }

        // 각 라인을 정책과 매칭
        const matchedPolicyIds = [];
        const unmatchedLines = [];

        lines.forEach(line => {
            // 1. [seq] rule_name 형식으로 매칭
            const seqMatch = line.match(/^\[(\d+)\]\s*(.+)$/);
            if (seqMatch) {
                const seq = parseInt(seqMatch[1]);
                const ruleName = seqMatch[2].trim();
                const policy = allPolicies.find(p => p.seq === seq && p.rule_name === ruleName);
                if (policy) {
                    matchedPolicyIds.push(policy.id);
                    return;
                }
            }

            // 2. 정책 ID로 직접 매칭 (숫자만 있는 경우)
            if (/^\d+$/.test(line)) {
                const numValue = parseInt(line);
                let policy = allPolicies.find(p => p.id === numValue);
                if (policy) {
                    matchedPolicyIds.push(policy.id);
                    return;
                }
                policy = allPolicies.find(p => p.seq === numValue);
                if (policy) {
                    matchedPolicyIds.push(policy.id);
                    return;
                }
            }

            // 3. 정책명으로 매칭
            const policy = allPolicies.find(p => p.rule_name === line);
            if (policy) {
                matchedPolicyIds.push(policy.id);
                return;
            }

            unmatchedLines.push(line);
        });

        // 매칭된 정책들을 TomSelect에 추가
        if (matchedPolicyIds.length > 0) {
            const currentValues = tomSelect.getValue() || [];
            const newValues = Array.isArray(currentValues) ? currentValues : [currentValues];
            const uniqueIds = [...new Set([...newValues.map(v => String(v)), ...matchedPolicyIds.map(id => String(id))])];
            tomSelect.setValue(uniqueIds);
            
            if (input) {
                input.value = '';
            }
            tomSelect.refreshOptions(false);

            // 결과 알림
            if (unmatchedLines.length > 0) {
                const unmatchedMsg = unmatchedLines.slice(0, 5).join(', ');
                const moreMsg = unmatchedLines.length > 5 ? ` 외 ${unmatchedLines.length - 5}개` : '';
                alert(`${matchedPolicyIds.length}개 정책이 추가되었습니다.\n\n매칭되지 않은 항목: ${unmatchedMsg}${moreMsg}`);
            }
        } else {
            alert(`매칭되는 정책을 찾을 수 없습니다.\n\n입력 형식:\n- 정책 ID: 1, 2, 3\n- 정책명: Policy1, Policy2\n- [seq] 형식: [1] Policy1\n\n현재 정책 수: ${allPolicies.length}개`);
        }
    }, true);
}

/**
 * 위험포트 분석 파라미터 추출
 * @returns {Object|null} 분석 파라미터 또는 null (유효하지 않은 경우)
 */
export function getRiskyPortsAnalysisParams() {
    const targetPolicyIds = targetPolicySelect ? targetPolicySelect.getValue() : null;
    
    // 여러 정책 ID를 배열로 변환
    let targetIdsArray = [];
    if (targetPolicyIds) {
        if (Array.isArray(targetPolicyIds)) {
            targetIdsArray = targetPolicyIds.map(id => parseInt(id));
        } else {
            targetIdsArray = [parseInt(targetPolicyIds)];
        }
    }

    // 정책을 선택하지 않으면 모든 정책 분석 (null 반환)
    return {
        targetPolicyIds: targetIdsArray.length > 0 ? targetIdsArray : null
    };
}

