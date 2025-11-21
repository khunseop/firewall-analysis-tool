/**
 * 영향도 분석 결과 처리 헬퍼 함수
 */
export function processImpactResults(resultData, allDevices) {
    const blockingPolicies = resultData.blocking_policies || [];
    const shadowedPolicies = resultData.shadowed_policies || [];
    
    const processedData = [];
    
    // 차단 정책에 걸리는 경우 처리
    blockingPolicies.forEach((item, index) => {
        processedData.push({
            ...item,
            device_name: allDevices.find(d => d.id === item.policy?.device_id)?.name || `장비 ${item.policy?.device_id}`,
            _impact_index: `blocking_${item.target_policy_id || 'unknown'}_${index}`,
            // 백엔드에서 전달된 정보 유지 (없으면 기본값 사용)
            target_policy_id: item.target_policy_id || resultData.target_policy_ids?.[0] || null,
            target_policy_name: item.target_policy_name || resultData.target_policies?.[0]?.rule_name || null,
            target_original_seq: item.target_original_seq ?? (resultData.policy_results?.[0]?.original_seq),
            target_new_seq: item.target_new_seq ?? (resultData.policy_results?.[0]?.new_seq),
            move_direction: item.move_direction ?? (resultData.policy_results?.[0]?.move_direction)
        });
    });
    
    // Shadow되는 정책들도 추가
    shadowedPolicies.forEach((item, index) => {
        processedData.push({
            ...item,
            device_name: allDevices.find(d => d.id === item.policy?.device_id)?.name || `장비 ${item.policy?.device_id}`,
            _impact_index: `shadowed_${item.target_policy_id || 'unknown'}_${index}`,
            // 백엔드에서 전달된 정보 유지 (없으면 기본값 사용)
            target_policy_id: item.target_policy_id || resultData.target_policy_ids?.[0] || null,
            target_policy_name: item.target_policy_name || resultData.target_policies?.[0]?.rule_name || null,
            target_original_seq: item.target_original_seq ?? (resultData.policy_results?.[0]?.original_seq),
            target_new_seq: item.target_new_seq ?? (resultData.policy_results?.[0]?.new_seq),
            move_direction: item.move_direction ?? (resultData.policy_results?.[0]?.move_direction)
        });
    });
    
    return processedData;
}





