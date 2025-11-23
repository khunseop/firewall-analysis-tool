/**
 * 영향도 분석 결과 처리 헬퍼 함수
 * 대상 정책 정보를 먼저 표시하고, 그 아래에 영향받는 정책들을 표시하는 형식으로 구성
 */
export function processImpactResults(resultData, allDevices) {
    const blockingPolicies = resultData.blocking_policies || [];
    const shadowedPolicies = resultData.shadowed_policies || [];
    const policyResults = resultData.policy_results || [];
    
    const processedData = [];
    
    // 대상 정책별로 그룹화
    const targetPolicyMap = new Map();
    
    // policy_results에서 대상 정책 정보 추출
    policyResults.forEach(policyResult => {
        const targetPolicyId = policyResult.target_policy_id;
        if (!targetPolicyMap.has(targetPolicyId)) {
            const targetPolicy = policyResult.target_policy;
            targetPolicyMap.set(targetPolicyId, {
                target_policy_id: targetPolicyId,
                target_policy: targetPolicy,
                target_policy_name: targetPolicy?.rule_name || policyResult.target_policy_name,
                target_original_seq: policyResult.original_seq,
                target_new_seq: policyResult.new_seq,
                move_direction: policyResult.move_direction,
                blocking_policies: [],
                shadowed_policies: []
            });
        }
    });
    
    // 차단 정책들을 대상 정책별로 그룹화
    blockingPolicies.forEach((item, index) => {
        const targetPolicyId = item.target_policy_id || resultData.target_policy_ids?.[0];
        if (targetPolicyId && targetPolicyMap.has(targetPolicyId)) {
            targetPolicyMap.get(targetPolicyId).blocking_policies.push({
                ...item,
                device_name: allDevices.find(d => d.id === item.policy?.device_id)?.name || `장비 ${item.policy?.device_id}`,
                _impact_index: `blocking_${targetPolicyId}_${index}`,
                target_policy_id: targetPolicyId,
                target_policy_name: item.target_policy_name || targetPolicyMap.get(targetPolicyId).target_policy_name,
                target_original_seq: item.target_original_seq ?? targetPolicyMap.get(targetPolicyId).target_original_seq,
                target_new_seq: item.target_new_seq ?? targetPolicyMap.get(targetPolicyId).target_new_seq,
                move_direction: item.move_direction ?? targetPolicyMap.get(targetPolicyId).move_direction
            });
        }
    });
    
    // Shadow되는 정책들을 대상 정책별로 그룹화
    shadowedPolicies.forEach((item, index) => {
        const targetPolicyId = item.target_policy_id || resultData.target_policy_ids?.[0];
        if (targetPolicyId && targetPolicyMap.has(targetPolicyId)) {
            targetPolicyMap.get(targetPolicyId).shadowed_policies.push({
                ...item,
                device_name: allDevices.find(d => d.id === item.policy?.device_id)?.name || `장비 ${item.policy?.device_id}`,
                _impact_index: `shadowed_${targetPolicyId}_${index}`,
                target_policy_id: targetPolicyId,
                target_policy_name: item.target_policy_name || targetPolicyMap.get(targetPolicyId).target_policy_name,
                target_original_seq: item.target_original_seq ?? targetPolicyMap.get(targetPolicyId).target_original_seq,
                target_new_seq: item.target_new_seq ?? targetPolicyMap.get(targetPolicyId).target_new_seq,
                move_direction: item.move_direction ?? targetPolicyMap.get(targetPolicyId).move_direction
            });
        }
    });
    
    // 대상 정책별로 결과 구성 (대상 정책 정보 먼저, 그 다음 영향받는 정책들)
    targetPolicyMap.forEach((targetInfo) => {
        // 1. 대상 정책 정보 행 추가
        processedData.push({
            is_target_policy: true,
            target_policy_id: targetInfo.target_policy_id,
            target_policy: targetInfo.target_policy,
            target_policy_name: targetInfo.target_policy_name,
            target_original_seq: targetInfo.target_original_seq,
            target_new_seq: targetInfo.target_new_seq,
            move_direction: targetInfo.move_direction,
            device_name: allDevices.find(d => d.id === targetInfo.target_policy?.device_id)?.name || `장비 ${targetInfo.target_policy?.device_id}`,
            _impact_index: `target_${targetInfo.target_policy_id}`
        });
        
        // 2. 차단 정책들 추가
        targetInfo.blocking_policies.forEach(item => {
            processedData.push({
                ...item,
                is_target_policy: false
            });
        });
        
        // 3. Shadow되는 정책들 추가
        targetInfo.shadowed_policies.forEach(item => {
            processedData.push({
                ...item,
                is_target_policy: false
            });
        });
    });
    
    return processedData;
}





