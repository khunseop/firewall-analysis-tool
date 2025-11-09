/**
 * 날짜를 YYYY-MM-DD HH:mm:ss 형식으로 포맷팅
 * @param {string|Date} dateString - 날짜 문자열 또는 Date 객체
 * @returns {string} 포맷된 날짜 문자열 (예: "2025-11-09 11:47:50")
 */
export function formatDateTime(dateString) {
  if (!dateString) return '없음';
  
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '없음';
  
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * 숫자에 세자리마다 콤마 추가
 * @param {number|string} num - 포맷할 숫자
 * @returns {string} 포맷된 숫자 문자열 (예: "1,234,567")
 */
export function formatNumber(num) {
  if (num === null || num === undefined || num === '') return '0';
  const numValue = typeof num === 'string' ? parseFloat(num) : num;
  if (isNaN(numValue)) return String(num);
  return numValue.toLocaleString('ko-KR');
}

/**
 * 타임스탬프 문자열 생성 (파일명 등에 사용)
 * @returns {string} 타임스탬프 문자열
 */
export function generateTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
}

