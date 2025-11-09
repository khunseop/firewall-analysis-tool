import { api } from '../api.js';

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
                placeholder: '대상 정책 선택',
                maxOptions: null,
                onChange: () => {
                    updateDestinationPolicySelect();
                }
            });
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
 * 목적지 정책 선택 목록 업데이트 (대상 정책 제외)
 */
function updateDestinationPolicySelect() {
    const targetPolicyId = targetPolicySelect ? targetPolicySelect.getValue() : null;
    if (!targetPolicyId || !destinationPolicySelect) return;

    const destSelectEl = document.getElementById('impact-destination-policy-select');
    if (!destSelectEl) return;

    // 대상 정책을 제외한 정책 목록으로 업데이트
    const filteredOptions = allPolicies
        .filter(p => p.id !== parseInt(targetPolicyId))
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
    const targetPolicyId = targetPolicySelect ? targetPolicySelect.getValue() : null;
    const destinationPolicyId = destinationPolicySelect ? destinationPolicySelect.getValue() : null;
    const moveDirectionEl = document.getElementById('impact-move-direction');
    const moveDirection = moveDirectionEl ? moveDirectionEl.value : 'below';

    if (!targetPolicyId) {
        alert('대상 정책을 선택하세요.');
        return null;
    }
    if (!destinationPolicyId) {
        alert('목적지 정책을 선택하세요.');
        return null;
    }

    // 정책 ID로 정책 찾기
    const targetPolicy = allPolicies.find(p => p.id === parseInt(targetPolicyId));
    const destinationPolicy = allPolicies.find(p => p.id === parseInt(destinationPolicyId));

    if (!targetPolicy || !destinationPolicy) {
        alert('선택한 정책을 찾을 수 없습니다.');
        return null;
    }

    // 정책 목록에서의 인덱스 찾기 (seq 순서로 정렬된 목록 기준)
    const targetIndex = allPolicies.findIndex(p => p.id === parseInt(targetPolicyId));
    const destIndex = allPolicies.findIndex(p => p.id === parseInt(destinationPolicyId));
    
    if (targetIndex === -1 || destIndex === -1) {
        alert('정책 위치를 계산할 수 없습니다.');
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
        targetPolicyId: parseInt(targetPolicyId),
        newPosition: newPosition
    };
}

