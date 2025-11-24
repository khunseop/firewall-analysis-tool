import { api } from '../api.js';

/**
 *정책이동 영향분석 관련 UI 및 로직 관리
 */

let allPolicies = [];
let targetPolicySelect = null;
let destinationPolicySelect = null;
let deviceSelect = null;

/**
 *정책이동 영향분석 컴포넌트 초기화
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
                onChange: () => {
                    updateDestinationPolicySelect();
                }
            });

            // 붙여넣기 이벤트 핸들러 추가
            setupPasteHandler(targetPolicySelect, targetSelectEl);
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
    if (!tomSelect || !selectEl) return;

    // TomSelect의 입력 필드 찾기
    const wrapper = selectEl.closest('.ts-wrapper');
    if (!wrapper) return;

    const input = wrapper.querySelector('input.ts-input');
    if (!input) return;

    // 붙여넣기 이벤트 리스너 추가
    input.addEventListener('paste', (e) => {
        e.stopPropagation();
        
        // 클립보드 데이터 가져오기
        const pastedText = (e.clipboardData || window.clipboardData).getData('text');
        if (!pastedText || !pastedText.trim()) return;

        // 기본 붙여넣기 동작 방지
        e.preventDefault();

        // 텍스트 파싱 (줄바꿈, 쉼표, 탭 등으로 구분)
        const lines = pastedText
            .split(/[\n\r,;\t]+/)
            .map(line => line.trim())
            .filter(line => line.length > 0);

        if (lines.length === 0) return;

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
                    return;
                }
                // 정책 ID로 매칭 실패 시 seq로 시도
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

            // 매칭 실패
            unmatchedLines.push(line);
        });

        // 매칭된 정책들을 TomSelect에 추가
        if (matchedPolicyIds.length > 0) {
            const currentValues = tomSelect.getValue() || [];
            const newValues = Array.isArray(currentValues) ? currentValues : [currentValues];
            
            // 중복 제거하면서 추가
            const uniqueIds = [...new Set([...newValues.map(v => String(v)), ...matchedPolicyIds.map(id => String(id))])];
            tomSelect.setValue(uniqueIds);
            
            // 입력 필드 초기화
            input.value = '';
            tomSelect.refreshOptions(false);

            // 결과 알림
            if (unmatchedLines.length > 0) {
                const unmatchedMsg = unmatchedLines.slice(0, 5).join(', ');
                const moreMsg = unmatchedLines.length > 5 ? ` 외 ${unmatchedLines.length - 5}개` : '';
                alert(`${matchedPolicyIds.length}개 정책이 추가되었습니다.\n\n매칭되지 않은 항목: ${unmatchedMsg}${moreMsg}`);
            } else {
                // 간단한 피드백 (선택사항)
                console.log(`${matchedPolicyIds.length}개 정책이 추가되었습니다.`);
            }
        } else {
            alert(`매칭되는 정책을 찾을 수 없습니다.\n\n입력 형식:\n- 정책 ID: 1, 2, 3\n- 정책명: Policy1, Policy2\n- [seq] 형식: [1] Policy1`);
        }
    });
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
 *정책이동 영향분석 파라미터 추출
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

