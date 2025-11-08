/**
 * 빈 상태 메시지 박스 표시/숨김 유틸리티
 */

/**
 * 아이콘 SVG 경로 매핑
 */
const iconMap = {
  'fa-info-circle': 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z',
  'fa-mouse-pointer': 'M13.98 21.197c-.38.01-.76-.13-1.05-.42l-4.24-4.24-5.66 5.66c-.39.39-1.02.39-1.41 0s-.39-1.02 0-1.41l5.66-5.66-4.24-4.24c-.29-.29-.43-.67-.42-1.05.01-.38.15-.76.42-1.05L12.7 2.3c.39-.39 1.02-.39 1.41 0l9.9 9.9c.27.27.41.65.42 1.03.01.38-.13.76-.42 1.05l-7.07 7.07c-.29.29-.67.43-1.05.42z',
  'fa-plus-circle': 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z',
  'fa-chart-line': 'M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 16.99l1.5 1.5z'
};

/**
 * 메시지 박스 표시
 * @param {HTMLElement|string} container - 컨테이너 요소 또는 ID
 * @param {string} message - 표시할 메시지
 * @param {string} icon - 아이콘 이름 (기본값: 'fa-info-circle')
 * @param {string} type - 메시지 타입 (기본값: 'info')
 */
export function showEmptyMessage(container, message, icon = 'fa-info-circle', type = 'info') {
  const containerEl = typeof container === 'string' 
    ? document.getElementById(container) 
    : container;
  
  if (!containerEl) return;
  
  // 기존 메시지 제거
  const existing = containerEl.querySelector('.empty-message-box');
  if (existing) existing.remove();
  
  // 메시지 박스 생성
  const messageBox = document.createElement('div');
  messageBox.className = 'empty-message-box box has-text-centered';
  messageBox.style.padding = '3rem';
  messageBox.style.margin = '1rem 0';
  
  const iconColor = type === 'info' ? '#3b82f6' : '#6b7280';
  const iconPath = iconMap[icon] || iconMap['fa-info-circle'];
  
  messageBox.innerHTML = `
    <div class="content">
      <p class="is-size-5 mb-3">
        <span class="icon is-large" style="color: ${iconColor};">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="${iconPath}" fill="currentColor"/>
          </svg>
        </span>
      </p>
      <p class="is-size-6 has-text-grey">${message}</p>
    </div>
  `;
  
  containerEl.appendChild(messageBox);
}

/**
 * 메시지 박스 숨김
 * @param {HTMLElement|string} container - 컨테이너 요소 또는 ID
 */
export function hideEmptyMessage(container) {
  const containerEl = typeof container === 'string' 
    ? document.getElementById(container) 
    : container;
  
  if (!containerEl) return;
  
  const existing = containerEl.querySelector('.empty-message-box');
  if (existing) existing.remove();
}

/**
 * 그리드와 메시지 박스를 토글
 * @param {HTMLElement|string} gridContainer - 그리드 컨테이너
 * @param {HTMLElement|string} messageContainer - 메시지 컨테이너
 * @param {boolean} showGrid - 그리드 표시 여부
 * @param {string} message - 메시지 (showGrid가 false일 때 표시)
 */
export function toggleGridAndMessage(gridContainer, messageContainer, showGrid, message = '') {
  const gridEl = typeof gridContainer === 'string' 
    ? document.getElementById(gridContainer) 
    : gridContainer;
  
  const messageEl = typeof messageContainer === 'string' 
    ? document.getElementById(messageContainer) 
    : messageContainer;
  
  if (gridEl) {
    gridEl.style.display = showGrid ? 'block' : 'none';
  }
  
  if (messageEl) {
    if (showGrid) {
      hideEmptyMessage(messageEl);
    } else if (message) {
      showEmptyMessage(messageEl, message);
    }
  }
}

/**
 * SVG 아이콘 HTML 생성
 * @param {string} iconName - 아이콘 이름 (iconMap의 키)
 * @param {number} size - 아이콘 크기 (기본값: 16)
 * @param {string} color - 아이콘 색상 (기본값: 'currentColor')
 * @returns {string} SVG 아이콘 HTML
 */
export function createIconSVG(iconName, size = 16, color = 'currentColor') {
  const iconPath = iconMap[iconName] || iconMap['fa-info-circle'];
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="${iconPath}" fill="${color}"/>
    </svg>
  `;
}

/**
 * 인라인 아이콘 HTML 생성 (Bulma icon 클래스와 함께 사용)
 * @param {string} iconName - 아이콘 이름 (iconMap의 키)
 * @param {string} size - Bulma 크기 클래스 ('is-small', 'is-medium', 'is-large', 기본값: 'is-small')
 * @returns {string} 인라인 아이콘 HTML (공백 제거된 한 줄)
 */
export function createInlineIcon(iconName, size = 'is-small') {
  const iconPath = iconMap[iconName] || iconMap['fa-info-circle'];
  return `<span class="icon ${size}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="${iconPath}" fill="currentColor"/></svg></span>`;
}

