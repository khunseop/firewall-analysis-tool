/**
 * 빈 상태 메시지 박스 표시/숨김 유틸리티
 */

/**
 * 메시지 박스 표시
 * @param {HTMLElement|string} container - 컨테이너 요소 또는 ID
 * @param {string} message - 표시할 메시지
 * @param {string} icon - 아이콘 이름 (사용하지 않음, 호환성을 위해 유지)
 * @param {string} type - 메시지 타입 (사용하지 않음, 호환성을 위해 유지)
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
  
  messageBox.innerHTML = `
    <div class="content">
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


