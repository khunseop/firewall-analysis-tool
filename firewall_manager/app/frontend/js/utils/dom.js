/**
 * DOM 요소의 텍스트를 안전하게 업데이트
 * @param {string} id - 요소 ID
 * @param {string} text - 텍스트 내용
 */
export function updateElementText(id, text) {
  const element = document.getElementById(id);
  if (element) element.textContent = text;
}

/**
 * 여러 DOM 요소를 한 번에 업데이트
 * @param {Object} updates - { id: text } 형태의 객체
 */
export function updateElements(updates) {
  Object.entries(updates).forEach(([id, text]) => {
    updateElementText(id, text);
  });
}

/**
 * 요소를 안전하게 가져오기
 * @param {string} selector - CSS 선택자 또는 ID
 * @returns {HTMLElement|null} 요소 또는 null
 */
export function $(selector) {
  if (selector.startsWith('#')) {
    return document.getElementById(selector.slice(1));
  }
  return document.querySelector(selector);
}

/**
 * 여러 요소를 가져오기
 * @param {string} selector - CSS 선택자
 * @returns {NodeList} 요소 목록
 */
export function $$(selector) {
  return document.querySelectorAll(selector);
}

