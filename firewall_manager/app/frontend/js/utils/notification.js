/**
 * 브라우저 알림 기능 유틸리티
 */

let notificationPermission = null;

/**
 * 알림 권한 요청
 * @returns {Promise<boolean>} 권한 허용 여부
 */
export async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    console.warn('이 브라우저는 알림을 지원하지 않습니다.');
    return false;
  }
  
  if (Notification.permission === 'granted') {
    notificationPermission = 'granted';
    return true;
  }
  
  if (Notification.permission === 'denied') {
    notificationPermission = 'denied';
    return false;
  }
  
  // default 상태일 때만 권한 요청
  const permission = await Notification.requestPermission();
  notificationPermission = permission;
  return permission === 'granted';
}

/**
 * 알림 표시
 * @param {string} title - 알림 제목
 * @param {object} options - 알림 옵션
 * @param {string} options.body - 알림 본문
 * @param {string} options.icon - 아이콘 URL
 * @param {number} options.tag - 알림 태그 (같은 태그는 하나만 표시)
 * @param {boolean} options.requireInteraction - 사용자 상호작용 필요 여부
 * @param {number} options.silent - 소리 없이 표시
 */
export async function showNotification(title, options = {}) {
  // 권한 확인
  if (notificationPermission === null) {
    const granted = await requestNotificationPermission();
    if (!granted) {
      console.warn('알림 권한이 거부되었습니다.');
      return null;
    }
  }
  
  if (notificationPermission !== 'granted') {
    console.warn('알림 권한이 없습니다.');
    return null;
  }
  
  const defaultOptions = {
    body: '',
    icon: '/static/favicon.ico',
    tag: 'default',
    requireInteraction: false,
    silent: false,
    ...options
  };
  
  try {
    const notification = new Notification(title, defaultOptions);
    
    // 클릭 시 포커스
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
    
    // 자동 닫기 (5초 후)
    if (!defaultOptions.requireInteraction) {
      setTimeout(() => {
        notification.close();
      }, 5000);
    }
    
    return notification;
  } catch (e) {
    console.error('알림 표시 실패:', e);
    return null;
  }
}

/**
 * 동기화 완료 알림
 * @param {string} deviceName - 장비 이름
 * @param {boolean} success - 성공 여부
 */
export async function notifySyncComplete(deviceName, success) {
  const title = success ? '동기화 완료' : '동기화 실패';
  const body = success 
    ? `${deviceName} 장비의 동기화가 완료되었습니다.`
    : `${deviceName} 장비의 동기화에 실패했습니다.`;
  
  return await showNotification(title, {
    body,
    tag: `sync-${deviceName}`,
    requireInteraction: !success, // 실패 시 상호작용 필요
  });
}

/**
 * 분석 완료 알림
 * @param {string} deviceName - 장비 이름
 * @param {string} analysisType - 분석 타입
 * @param {boolean} success - 성공 여부
 */
export async function notifyAnalysisComplete(deviceName, analysisType, success) {
  const typeNames = {
    redundancy: '중복 정책',
    unused: '미사용 정책',
    unreferenced_objects: '미참조 객체',
    impact: '영향도 분석',
    risky_ports: '위험 포트'
  };
  
  const typeName = typeNames[analysisType] || analysisType;
  const title = success ? '분석 완료' : '분석 실패';
  const body = success
    ? `${deviceName} 장비의 ${typeName} 분석이 완료되었습니다.`
    : `${deviceName} 장비의 ${typeName} 분석에 실패했습니다.`;
  
  return await showNotification(title, {
    body,
    tag: `analysis-${deviceName}-${analysisType}`,
    requireInteraction: !success,
  });
}

/**
 * 시스템 이벤트 알림
 * @param {string} title - 알림 제목
 * @param {string} message - 알림 메시지
 * @param {string} type - 알림 타입 ('info', 'success', 'warning', 'error')
 */
export async function notifySystemEvent(title, message, type = 'info') {
  const icons = {
    info: '/static/favicon.ico',
    success: '/static/favicon.ico',
    warning: '/static/favicon.ico',
    error: '/static/favicon.ico'
  };
  
  return await showNotification(title, {
    body: message,
    icon: icons[type] || icons.info,
    tag: `system-${type}-${Date.now()}`,
    requireInteraction: type === 'error',
  });
}

/**
 * 알림 권한 상태 확인
 * @returns {string} 'granted', 'denied', 'default'
 */
export function getNotificationPermission() {
  if (!('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}


