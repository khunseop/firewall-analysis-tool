/**
 * 날짜를 YYYY-MM-DD HH:mm:ss 형식으로 포맷팅 (한국 시간 기준)
 * @param {string|Date} dateString - 날짜 문자열 또는 Date 객체
 * @returns {string} 포맷된 날짜 문자열 (예: "2025-11-09 11:47:50")
 */
export function formatDateTime(dateString) {
  if (!dateString) return '없음';
  
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '없음';
  
  // 한국 시간(KST)으로 변환하여 포맷팅
  const formatter = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  const parts = formatter.formatToParts(date);
  const year = parts.find(p => p.type === 'year').value;
  const month = parts.find(p => p.type === 'month').value;
  const day = parts.find(p => p.type === 'day').value;
  const hour = parts.find(p => p.type === 'hour').value;
  const minute = parts.find(p => p.type === 'minute').value;
  const second = parts.find(p => p.type === 'second').value;
  
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
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

/**
 * YYYY-MM-DD 형식의 날짜 문자열 생성 (파일명 등에 사용)
 * @returns {string} 날짜 문자열 (예: "2025-01-15")
 */
export function generateDateString() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

