import { processImpactResults } from './impact.js';

/**
 * 분석 결과 데이터를 그리드에 표시하기 위한 형태로 변환
 * @param {Object|Array} resultData - 분석 결과 데이터
 * @param {string} analysisType - 분석 타입
 * @param {Array} allDevices - 장비 목록
 * @returns {Array} 처리된 데이터 배열
 */
export async function processAnalysisResults(resultData, analysisType, allDevices) {
    let processedData = [];
    
    //정책이동 영향분석 결과는 객체 형태
    if (analysisType === 'impact' && resultData && !Array.isArray(resultData)) {
        return processImpactResults(resultData, allDevices);
    } else if (resultData && Array.isArray(resultData) && resultData.length > 0) {
        if (analysisType === 'unreferenced_objects') {
            // 미참조 객체 분석 결과는 그대로 사용
            processedData = resultData;
        } else if (analysisType === 'risky_ports') {
            // 위험 포트 분석 결과 처리
            const firstItem = resultData[0];
            const deviceId = firstItem?.policy?.device_id || firstItem?.device_id;
            
            if (deviceId) {
                const device = allDevices.find(d => d.id === deviceId);
                const deviceName = device ? device.name : `장비 ${deviceId}`;
                
                processedData = resultData.map(item => ({
                    ...item,
                    device_name: deviceName,
                    original_services: Array.isArray(item.original_services) 
                        ? item.original_services 
                        : (item.original_services ? [item.original_services] : []),
                    original_service_objects: Array.isArray(item.original_service_objects) 
                        ? item.original_service_objects 
                        : (item.original_service_objects ? [item.original_service_objects] : []),
                    filtered_service_objects: Array.isArray(item.filtered_service_objects) 
                        ? item.filtered_service_objects 
                        : (item.filtered_service_objects ? [item.filtered_service_objects] : []),
                    filtered_services: Array.isArray(item.filtered_services) 
                        ? item.filtered_services 
                        : (item.filtered_services ? [item.filtered_services] : [])
                }));
            } else {
                processedData = resultData;
            }
        } else if (analysisType === 'over_permissive') {
            // 과허용정책 분석 결과 처리
            const firstItem = resultData[0];
            const deviceId = firstItem?.policy?.device_id || firstItem?.device_id;
            
            if (deviceId) {
                const device = allDevices.find(d => d.id === deviceId);
                const deviceName = device ? device.name : `장비 ${deviceId}`;
                
                processedData = resultData.map(item => ({
                    ...item,
                    device_name: deviceName,
                    source_range_size: item.source_range_size || 0,
                    destination_range_size: item.destination_range_size || 0,
                    service_range_size: item.service_range_size || 0
                }));
            } else {
                processedData = resultData;
            }
        } else {
            // 중복 정책, 미사용 정책 분석 결과 처리
            const firstItem = resultData[0];
            const deviceId = firstItem?.policy?.device_id || firstItem?.device_id;
            
            if (deviceId) {
                const device = allDevices.find(d => d.id === deviceId);
                const deviceName = device ? device.name : `장비 ${deviceId}`;
                
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
 * @param {Object} apiClient - API 클라이언트
 * @returns {Set} 유효한 객체 이름 Set
 */
export async function loadValidObjectNames(deviceId, apiClient) {
    try {
        const searchResponse = await apiClient.searchPolicies({
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

