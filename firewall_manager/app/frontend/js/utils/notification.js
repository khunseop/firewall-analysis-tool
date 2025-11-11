/**
 * 알림 기능 유틸리티
 * 로그 저장 + 네비바 티커 표시
 */

import { api } from '../api.js';
import { showNotificationTicker } from './notificationTicker.js';

/**
 * 알림 로그 생성 및 티커 표시
 * @param {string} title - 알림 제목
 * @param {string} message - 알림 메시지
 * @param {string} type - 알림 타입 ('info', 'success', 'warning', 'error')
 * @param {string} category - 알림 카테고리 ('sync', 'analysis', 'system')
 * @param {number} deviceId - 관련 장비 ID (선택)
 * @param {string} deviceName - 장비 이름 (선택)
 */
async function createNotificationLog(title, message, type = 'info', category = null, deviceId = null, deviceName = null) {
  try {
    await api.createNotification({
      title,
      message,
      type,
      category,
      device_id: deviceId,
      device_name: deviceName
    });
  } catch (error) {
    console.error('알림 로그 저장 실패:', error);
  }
}

/**
 * 알림 표시 (로그 저장 + 티커 표시)
 * @param {string} title - 알림 제목
 * @param {string} message - 알림 메시지
 * @param {string} type - 알림 타입 ('info', 'success', 'warning', 'error')
 * @param {string} category - 알림 카테고리 ('sync', 'analysis', 'system')
 * @param {number} deviceId - 관련 장비 ID (선택)
 * @param {string} deviceName - 장비 이름 (선택)
 */
export async function showNotification(title, message, type = 'info', category = null, deviceId = null, deviceName = null) {
  // 로그 저장
  await createNotificationLog(title, message, type, category, deviceId, deviceName);
  
  // 티커에 표시 (제목과 메시지 결합)
  const displayMessage = deviceName ? `[${deviceName}] ${title}: ${message}` : `${title}: ${message}`;
  showNotificationTicker(displayMessage, type);
}

/**
 * 동기화 완료 알림
 * @param {string} deviceName - 장비 이름
 * @param {boolean} success - 성공 여부
 * @param {number} deviceId - 장비 ID (선택)
 */
export async function notifySyncComplete(deviceName, success, deviceId = null) {
  const title = success ? '동기화 완료' : '동기화 실패';
  const message = success 
    ? '동기화가 완료되었습니다.'
    : '동기화에 실패했습니다.';
  
  return await showNotification(
    title,
    message,
    success ? 'success' : 'error',
    'sync',
    deviceId,
    deviceName
  );
}

/**
 * 분석 완료 알림
 * @param {string} deviceName - 장비 이름
 * @param {string} analysisType - 분석 타입
 * @param {boolean} success - 성공 여부
 * @param {number} deviceId - 장비 ID (선택)
 */
export async function notifyAnalysisComplete(deviceName, analysisType, success, deviceId = null) {
  const typeNames = {
    redundancy: '중복 정책',
    unused: '미사용 정책',
    unreferenced_objects: '미참조 객체',
    impact: '영향도 분석',
    risky_ports: '위험 포트'
  };
  
  const typeName = typeNames[analysisType] || analysisType;
  const title = success ? '분석 완료' : '분석 실패';
  const message = success
    ? `${typeName} 분석이 완료되었습니다.`
    : `${typeName} 분석에 실패했습니다.`;
  
  return await showNotification(
    title,
    message,
    success ? 'success' : 'error',
    'analysis',
    deviceId,
    deviceName
  );
}

/**
 * 시스템 이벤트 알림
 * @param {string} title - 알림 제목
 * @param {string} message - 알림 메시지
 * @param {string} type - 알림 타입 ('info', 'success', 'warning', 'error')
 */
export async function notifySystemEvent(title, message, type = 'info') {
  return await showNotification(
    title,
    message,
    type,
    'system'
  );
}


