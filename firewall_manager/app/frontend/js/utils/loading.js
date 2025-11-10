/**
 * 로딩 인디케이터 유틸리티
 */

/**
 * 전체 페이지 로딩 오버레이 표시
 * @param {string} message - 로딩 메시지 (선택)
 */
export function showPageLoading(message = '로딩 중...') {
  let overlay = document.getElementById('page-loading-overlay');
  
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'page-loading-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      flex-direction: column;
      gap: 1rem;
    `;
    
    const spinner = document.createElement('div');
    spinner.className = 'loading-spinner';
    spinner.style.cssText = `
      width: 48px;
      height: 48px;
      border: 4px solid rgba(255, 255, 255, 0.3);
      border-top-color: #fff;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    `;
    
    const text = document.createElement('div');
    text.className = 'loading-text';
    text.style.cssText = `
      color: #fff;
      font-size: 1rem;
      font-weight: 500;
    `;
    text.textContent = message;
    
    overlay.appendChild(spinner);
    overlay.appendChild(text);
    document.body.appendChild(overlay);
  } else {
    const textEl = overlay.querySelector('.loading-text');
    if (textEl) {
      textEl.textContent = message;
    }
    overlay.style.display = 'flex';
  }
}

/**
 * 전체 페이지 로딩 오버레이 숨김
 */
export function hidePageLoading() {
  const overlay = document.getElementById('page-loading-overlay');
  if (overlay) {
    overlay.style.display = 'none';
  }
}

/**
 * 버튼 로딩 상태 표시
 * @param {HTMLElement|string} button - 버튼 요소 또는 ID
 * @param {boolean} isLoading - 로딩 상태
 */
export function setButtonLoading(button, isLoading) {
  const buttonEl = typeof button === 'string' 
    ? document.getElementById(button) 
    : button;
  
  if (!buttonEl) return;
  
  if (isLoading) {
    buttonEl.disabled = true;
    buttonEl.classList.add('is-loading');
  } else {
    buttonEl.disabled = false;
    buttonEl.classList.remove('is-loading');
  }
}

/**
 * 진행률 표시 바 생성
 * @param {HTMLElement|string} container - 컨테이너 요소 또는 ID
 * @param {number} percent - 진행률 (0-100)
 * @param {string} message - 진행 메시지 (선택)
 */
export function showProgressBar(container, percent, message = '') {
  const containerEl = typeof container === 'string' 
    ? document.getElementById(container) 
    : container;
  
  if (!containerEl) return;
  
  let progressBar = containerEl.querySelector('.progress-bar-container');
  
  if (!progressBar) {
    progressBar = document.createElement('div');
    progressBar.className = 'progress-bar-container';
    progressBar.style.cssText = `
      width: 100%;
      margin: 1rem 0;
    `;
    
    const progressBg = document.createElement('div');
    progressBg.className = 'progress-background';
    progressBg.style.cssText = `
      width: 100%;
      height: 8px;
      background: #e5e7eb;
      border-radius: 4px;
      overflow: hidden;
    `;
    
    const progressFill = document.createElement('div');
    progressFill.className = 'progress-fill';
    progressFill.style.cssText = `
      height: 100%;
      background: #3b82f6;
      transition: width 0.3s ease;
      width: 0%;
    `;
    
    const progressText = document.createElement('div');
    progressText.className = 'progress-text';
    progressText.style.cssText = `
      margin-top: 0.5rem;
      font-size: 0.875rem;
      color: #6b7280;
      text-align: center;
    `;
    
    progressBg.appendChild(progressFill);
    progressBar.appendChild(progressBg);
    progressBar.appendChild(progressText);
    containerEl.appendChild(progressBar);
  }
  
  const progressFill = progressBar.querySelector('.progress-fill');
  const progressText = progressBar.querySelector('.progress-text');
  
  if (progressFill) {
    progressFill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
  }
  
  if (progressText) {
    progressText.textContent = message || `${Math.round(percent)}%`;
  }
}

/**
 * 진행률 바 숨김
 * @param {HTMLElement|string} container - 컨테이너 요소 또는 ID
 */
export function hideProgressBar(container) {
  const containerEl = typeof container === 'string' 
    ? document.getElementById(container) 
    : container;
  
  if (!containerEl) return;
  
  const progressBar = containerEl.querySelector('.progress-bar-container');
  if (progressBar) {
    progressBar.remove();
  }
}

/**
 * 스켈레톤 UI 표시
 * @param {HTMLElement|string} container - 컨테이너 요소 또는 ID
 * @param {number} rows - 행 수
 */
export function showSkeleton(container, rows = 5) {
  const containerEl = typeof container === 'string' 
    ? document.getElementById(container) 
    : container;
  
  if (!containerEl) return;
  
  const skeleton = document.createElement('div');
  skeleton.className = 'skeleton-container';
  skeleton.style.cssText = `
    padding: 1rem;
  `;
  
  for (let i = 0; i < rows; i++) {
    const row = document.createElement('div');
    row.style.cssText = `
      height: 40px;
      background: linear-gradient(90deg, #f3f4f6 25%, #e5e7eb 50%, #f3f4f6 75%);
      background-size: 200% 100%;
      animation: skeleton-loading 1.5s ease-in-out infinite;
      border-radius: 4px;
      margin-bottom: 0.5rem;
    `;
    skeleton.appendChild(row);
  }
  
  containerEl.appendChild(skeleton);
}

/**
 * 스켈레톤 UI 숨김
 * @param {HTMLElement|string} container - 컨테이너 요소 또는 ID
 */
export function hideSkeleton(container) {
  const containerEl = typeof container === 'string' 
    ? document.getElementById(container) 
    : container;
  
  if (!containerEl) return;
  
  const skeleton = containerEl.querySelector('.skeleton-container');
  if (skeleton) {
    skeleton.remove();
  }
}

