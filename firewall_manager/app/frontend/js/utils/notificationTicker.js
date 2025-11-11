/**
 * 네비바 알림 티커 유틸리티
 * 아래에서 위로 올라가는 텍스트 스타일의 알림 표시
 */

let notificationQueue = [];
let isShowing = false;

/**
 * 알림 티커에 메시지 표시
 * @param {string} message - 표시할 메시지
 * @param {string} type - 알림 타입 ('info', 'success', 'warning', 'error')
 * @param {number} duration - 표시 시간 (ms, 기본 5초)
 */
export function showNotificationTicker(message, type = 'info', duration = 3000) {
  const ticker = document.getElementById('notification-ticker');
  if (!ticker) {
    console.warn('Notification ticker element not found');
    return;
  }

  // 큐에 추가
  notificationQueue.push({ message, type, duration });

  // 현재 표시 중이 아니면 즉시 표시
  if (!isShowing) {
    processNextNotification();
  }
}

/**
 * 다음 알림 처리
 */
function processNextNotification() {
  if (notificationQueue.length === 0) {
    isShowing = false;
    return;
  }

  isShowing = true;
  const { message, type, duration } = notificationQueue.shift();

  // 새 알림 요소 생성
  const notificationEl = document.createElement('div');
  notificationEl.className = `notification-ticker-item`;
  notificationEl.textContent = message;

  const ticker = document.getElementById('notification-ticker');
  ticker.appendChild(notificationEl);

  // 표시 애니메이션 (아래에서 위로)
  requestAnimationFrame(() => {
    notificationEl.classList.add('show');
  });

  // 지정된 시간 후 숨김
  setTimeout(() => {
    notificationEl.classList.remove('show');
    notificationEl.classList.add('hide');

    // 애니메이션 완료 후 제거
    setTimeout(() => {
      if (notificationEl.parentNode) {
        notificationEl.remove();
      }
      // 다음 알림 처리
      setTimeout(() => {
        processNextNotification();
      }, 200); // 애니메이션 간격
    }, 400); // hide 애니메이션 시간
  }, duration);
}

/**
 * 알림 티커 초기화
 */
export function initNotificationTicker() {
  // 티커 요소가 없으면 생성하지 않음
  const ticker = document.getElementById('notification-ticker');
  if (!ticker) {
    return;
  }

  // 큐 초기화
  notificationQueue = [];
  isShowing = false;
}

