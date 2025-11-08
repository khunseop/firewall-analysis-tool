import { generateTimestamp } from './date.js';

/**
 * 그리드에서 필터링된 데이터를 가져오기
 * @param {Object} gridApi - AG Grid API 객체
 * @returns {Array} 행 데이터 배열
 */
export function getFilteredGridData(gridApi) {
  if (!gridApi) return [];
  
  const rowData = [];
  gridApi.forEachNodeAfterFilter((node) => {
    rowData.push(node.data);
  });
  return rowData;
}

/**
 * 엑셀 내보내기 공통 함수
 * @param {Object} gridApi - AG Grid API 객체
 * @param {Function} exportApi - API 내보내기 함수
 * @param {string} filenamePrefix - 파일명 접두사
 * @param {string} emptyMessage - 데이터 없을 때 메시지
 */
export async function exportGridToExcel(gridApi, exportApi, filenamePrefix, emptyMessage = '데이터가 없습니다.') {
  if (!gridApi) {
    alert(emptyMessage);
    return;
  }
  
  try {
    const rowData = getFilteredGridData(gridApi);
    
    if (rowData.length === 0) {
      alert('내보낼 데이터가 없습니다.');
      return;
    }
    
    const timestamp = generateTimestamp();
    await exportApi(rowData, `${filenamePrefix}_${timestamp}`);
  } catch (error) {
    alert(`내보내기 실패: ${error.message}`);
  }
}

