/**
 * 날짜를 한국어 형식으로 포맷팅
 * @param {string|Date} dateString - 날짜 문자열 또는 Date 객체
 * @param {Object} options - 포맷 옵션
 * @returns {string} 포맷된 날짜 문자열
 */
export function formatDateTime(dateString, options = {}) {
  if (!dateString) return '없음';
  
  const defaultOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...options
  };
  
  return new Date(dateString).toLocaleString('ko-KR', defaultOptions);
}

/**
 * 타임스탬프 문자열 생성 (파일명 등에 사용)
 * @returns {string} 타임스탬프 문자열
 */
export function generateTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
}

