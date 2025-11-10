/**
 * localStorage를 활용한 작업 중인 내용 유지 유틸리티
 */

const STORAGE_PREFIX = 'fat_';

/**
 * 페이지별 설정 저장
 * @param {string} pageKey - 페이지 식별자 (예: 'policies', 'objects', 'analysis')
 * @param {object} data - 저장할 데이터
 */
export function savePageState(pageKey, data) {
  try {
    const key = `${STORAGE_PREFIX}${pageKey}`;
    localStorage.setItem(key, JSON.stringify({
      ...data,
      timestamp: Date.now()
    }));
  } catch (e) {
    console.warn('Failed to save page state:', e);
  }
}

/**
 * 페이지별 설정 복원
 * @param {string} pageKey - 페이지 식별자
 * @returns {object|null} 저장된 데이터 또는 null
 */
export function loadPageState(pageKey) {
  try {
    const key = `${STORAGE_PREFIX}${pageKey}`;
    const stored = localStorage.getItem(key);
    if (!stored) return null;
    
    const data = JSON.parse(stored);
    // 7일 이상 된 데이터는 무시
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7일
    if (data.timestamp && Date.now() - data.timestamp > maxAge) {
      localStorage.removeItem(key);
      return null;
    }
    
    return data;
  } catch (e) {
    console.warn('Failed to load page state:', e);
    return null;
  }
}

/**
 * 페이지별 설정 삭제
 * @param {string} pageKey - 페이지 식별자
 */
export function clearPageState(pageKey) {
  try {
    const key = `${STORAGE_PREFIX}${pageKey}`;
    localStorage.removeItem(key);
  } catch (e) {
    console.warn('Failed to clear page state:', e);
  }
}

/**
 * 그리드 필터 모델 저장
 * @param {string} pageKey - 페이지 식별자
 * @param {object} filterModel - AG Grid 필터 모델
 */
export function saveGridFilters(pageKey, filterModel) {
  savePageState(`${pageKey}_filters`, { filterModel });
}

/**
 * 그리드 필터 모델 복원
 * @param {string} pageKey - 페이지 식별자
 * @returns {object|null} 필터 모델 또는 null
 */
export function loadGridFilters(pageKey) {
  const state = loadPageState(`${pageKey}_filters`);
  return state?.filterModel || null;
}

/**
 * 그리드 정렬 모델 저장
 * @param {string} pageKey - 페이지 식별자
 * @param {Array} sortModel - AG Grid 정렬 모델
 */
export function saveGridSort(pageKey, sortModel) {
  savePageState(`${pageKey}_sort`, { sortModel });
}

/**
 * 그리드 정렬 모델 복원
 * @param {string} pageKey - 페이지 식별자
 * @returns {Array|null} 정렬 모델 또는 null
 */
export function loadGridSort(pageKey) {
  const state = loadPageState(`${pageKey}_sort`);
  return state?.sortModel || null;
}

/**
 * 검색 조건 저장
 * @param {string} pageKey - 페이지 식별자
 * @param {object} searchParams - 검색 파라미터
 */
export function saveSearchParams(pageKey, searchParams) {
  savePageState(`${pageKey}_search`, searchParams);
}

/**
 * 검색 조건 복원
 * @param {string} pageKey - 페이지 식별자
 * @returns {object|null} 검색 파라미터 또는 null
 */
export function loadSearchParams(pageKey) {
  return loadPageState(`${pageKey}_search`);
}

