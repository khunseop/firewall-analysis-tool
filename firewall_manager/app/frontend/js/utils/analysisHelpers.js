import { api } from '../api.js';

/**
 * 분석 결과 처리 관련 헬퍼 함수들
 */

/**
 * 분석 결과 데이터를 그리드에 표시하기 위한 형태로 변환
 * @param {Object|Array} resultData - 분석 결과 데이터
 * @param {string} analysisType - 분석 타입
 * @param {Array} allDevices - 장비 목록
 * @returns {Array} 처리된 데이터 배열
 */
export async function processAnalysisResults(resultData, analysisType, allDevices) {
    let processedData = [];
    
    // 영향도 분석 결과는 객체 형태
    if (analysisType === 'impact' && resultData && !Array.isArray(resultData)) {
        const affectedPolicies = resultData.affected_policies || [];
        const conflictPolicies = resultData.conflict_policies || [];
        
        // 영향받는 정책들 처리 (고유 ID를 위해 인덱스 추가)
        processedData = affectedPolicies.map((item, index) => ({
            ...item,
            device_name: allDevices.find(d => d.id === item.policy?.device_id)?.name || `장비 ${item.policy?.device_id}`,
            _impact_index: `affected_${index}` // 고유 ID 생성을 위한 인덱스
        }));
        
        // 충돌 정책들도 추가 (고유 ID를 위해 인덱스 추가)
        conflictPolicies.forEach((item, index) => {
            processedData.push({
                ...item,
                device_name: allDevices.find(d => d.id === item.policy?.device_id)?.name || `장비 ${item.policy?.device_id}`,
                impact_type: '충돌',
                current_position: null,
                new_position: null,
                _impact_index: `conflict_${index}` // 고유 ID 생성을 위한 인덱스
            });
        });
    } else if (resultData && Array.isArray(resultData) && resultData.length > 0) {
        if (analysisType === 'unreferenced_objects') {
            // 미참조 객체 분석 결과는 그대로 사용
            processedData = resultData;
        } else {
            // 중복 정책, 미사용 정책 분석 결과 처리
            const firstItem = resultData[0];
            const deviceId = firstItem?.policy?.device_id || firstItem?.device_id;
            
            if (deviceId) {
                const device = allDevices.find(d => d.id === deviceId);
                const deviceName = device ? device.name : `장비 ${deviceId}`;
                
                // 각 결과에 장비 이름 추가
                processedData = resultData.map(item => ({
                    ...item,
                    device_name: deviceName
                }));
            } else {
                processedData = resultData;
            }
        }
    }
    
    return processedData;
}

/**
 * validObjectNames 설정을 위한 API 호출
 * @param {number} deviceId - 장비 ID
 * @returns {Set} 유효한 객체 이름 Set
 */
export async function loadValidObjectNames(deviceId) {
    try {
        const searchResponse = await api.searchPolicies({
            device_ids: [deviceId],
            limit: 1
        });
        if (searchResponse && searchResponse.valid_object_names) {
            return new Set(searchResponse.valid_object_names);
        }
    } catch (error) {
        console.warn('valid_object_names를 가져오는 데 실패했습니다:', error);
    }
    return new Set();
}

