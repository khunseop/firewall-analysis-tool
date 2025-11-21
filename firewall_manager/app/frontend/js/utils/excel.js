import { generateTimestamp, generateDateString } from './date.js';
import { formatDateTime } from './date.js';

/**
 * 중복분석 결과 데이터를 평탄화 (policy 객체를 펼침)
 * @param {Array} rowData - 그리드 행 데이터
 * @returns {Array} 평탄화된 데이터 배열 (필드 순서: device_name, set_number, type, seq, vsys, rule_name, enable, action, source, user, destination, service, application, security_profile, category, description, last_hit_date)
 */
function flattenAnalysisData(rowData) {
    return rowData.map(row => {
        return {
            device_name: row.device_name || '',
            set_number: row.set_number || '',
            type: row.type === 'UPPER' ? '상위 정책' : row.type === 'LOWER' ? '하위 정책' : row.type || '',
            seq: row.policy?.seq || '',
            vsys: row.policy?.vsys || '',
            rule_name: row.policy?.rule_name || '',
            enable: row.policy?.enable === true ? '활성' : row.policy?.enable === false ? '비활성' : '',
            action: row.policy?.action || '',
            source: row.policy?.source || '',
            user: row.policy?.user || '',
            destination: row.policy?.destination || '',
            service: row.policy?.service || '',
            application: row.policy?.application || '',
            security_profile: row.policy?.security_profile || '',
            category: row.policy?.category || '',
            description: row.policy?.description || '',
            last_hit_date: row.policy?.last_hit_date ? formatDateTime(row.policy.last_hit_date) : ''
        };
    });
}

/**
 * 정책 데이터를 평탄화 (불필요한 필드 제거)
 * @param {Array} rowData - 그리드 행 데이터
 * @returns {Array} 평탄화된 데이터 배열
 */
function flattenPolicyData(rowData) {
    return rowData.map(row => {
        const flat = {
            device_name: row.device_name || '',
            seq: row.seq || '',
            vsys: row.vsys || '',
            rule_name: row.rule_name || '',
            enable: row.enable === true ? '활성' : row.enable === false ? '비활성' : '',
            action: row.action || '',
            source: row.source || '',
            user: row.user || '',
            destination: row.destination || '',
            service: row.service || '',
            application: row.application || '',
            security_profile: row.security_profile || '',
            category: row.category || '',
            description: row.description || '',
            last_hit_date: row.last_hit_date ? formatDateTime(row.last_hit_date) : ''
        };
        return flat;
    });
}

/**
 * 객체 데이터를 평탄화 (불필요한 필드 제거)
 * @param {Array} rowData - 그리드 행 데이터
 * @returns {Array} 평탄화된 데이터 배열
 */
function flattenObjectData(rowData) {
    return rowData.map(row => {
        const flat = {
            device_name: row.device_name || '',
            name: row.name || '',
            type: row.type || '',
            ip_address: row.ip_address || '',
            protocol: row.protocol || '',
            port: row.port || '',
            members: row.members || '',
            description: row.description || ''
        };
        return flat;
    });
}

/**
 * 컬럼 정의에서 헤더 이름과 필드명 추출
 * @param {Array} columnDefs - AG Grid 컬럼 정의 배열
 * @returns {Object} { headers: 헤더 배열, fields: 필드명 배열 }
 */
function getHeadersAndFieldsFromColumnDefs(columnDefs) {
    const columns = columnDefs.filter(col => col.field && col.headerName);
    return {
        headers: columns.map(col => col.headerName),
        fields: columns.map(col => col.field)
    };
}

/**
 * 평탄화된 데이터에서 필드 순서에 맞게 값 배열 생성
 * @param {Array} columnDefs - AG Grid 컬럼 정의 배열
 * @param {Object} flatRow - 평탄화된 행 데이터
 * @returns {Array} 값 배열
 */
function getValuesFromFlatRow(columnDefs, flatRow) {
    return columnDefs
        .filter(col => col.field && col.headerName)
        .map(col => {
            const field = col.field;
            const valueGetter = col.valueGetter;
            
            if (valueGetter) {
                // valueGetter가 있으면 원본 데이터에서 가져와야 하지만,
                // 평탄화된 데이터에서는 직접 필드 접근
                return flatRow[field] || '';
            }
            return flatRow[field] || '';
        });
}

/**
 * 다른 이름으로 저장 다이얼로그 표시 (공통 함수)
 * @param {string} defaultFilename - 기본 파일명 (확장자 포함)
 * @returns {Promise<string|null>} 사용자가 입력한 파일명 또는 null (취소 시)
 */
export function promptFilename(defaultFilename) {
    return new Promise((resolve) => {
        const filename = prompt('파일명을 입력하세요 (경로 지정 후 저장):', defaultFilename);
        if (filename === null) {
            resolve(null); // 취소
        } else if (filename.trim() === '') {
            alert('파일명을 입력해주세요.');
            resolve(null);
        } else {
            resolve(filename.trim());
        }
    });
}

/**
 * 엑셀 셀 값 정리 함수 (XML 특수 문자 및 제어 문자 처리)
 * @param {*} value - 셀에 넣을 값
 * @returns {string} 정리된 문자열 값
 */
function sanitizeCellValue(value) {
    // null이나 undefined는 빈 문자열로 변환
    if (value === null || value === undefined) {
        return '';
    }
    
    // 숫자나 불린 값은 문자열로 변환
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    
    // 문자열이 아닌 경우 문자열로 변환
    let str = String(value);
    
    // 제어 문자 제거 (0x00-0x1F, 0x7F-0x9F, 단 줄바꿈과 탭은 유지)
    str = str.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F-\x9F]/g, '');
    
    return str;
}

/**
 * 엑셀 파일 생성 및 다운로드 (클라이언트 사이드)
 * @param {Array} data - 평탄화된 데이터 배열
 * @param {Array} headers - 헤더 배열
 * @param {string} filename - 파일명 (확장자 제외)
 * @param {Object} options - 옵션 (type: 'analysis' | 'policy' | 'object')
 */
async function createExcelFile(data, headers, filename, options = {}) {
    if (!window.ExcelJS) {
        alert('엑셀 라이브러리를 불러올 수 없습니다. 페이지를 새로고침해주세요.');
        return;
    }

    // 워크북 생성
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Sheet1');
    
    // 헤더 행 추가 (헤더도 정리)
    const sanitizedHeaders = headers.map(h => sanitizeCellValue(h));
    const headerRow = worksheet.addRow(sanitizedHeaders);
    
    // 헤더 스타일 적용 (회색 배경, 굵은 글씨, 중앙 정렬, 테두리)
    headerRow.eachCell((cell, colNumber) => {
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE8E8E8' }
        };
        cell.font = { 
            bold: true, 
            size: 11,
            color: { argb: 'FF333333' }
        };
        cell.alignment = { 
            horizontal: 'center', 
            vertical: 'middle',
            wrapText: true
        };
        cell.border = {
            top: { style: 'thin', color: { argb: 'FFCCCCCC' } },
            left: { style: 'thin', color: { argb: 'FFCCCCCC' } },
            bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
            right: { style: 'thin', color: { argb: 'FFCCCCCC' } }
        };
    });
    
    // 데이터 행 추가 (모든 값을 정리)
    data.forEach(row => {
        // row가 배열이면 각 값을 정리, 객체면 값 배열로 변환 후 정리
        const values = Array.isArray(row) 
            ? row.map(val => sanitizeCellValue(val))
            : headers.map((_, idx) => {
                const field = Object.keys(row)[idx];
                return sanitizeCellValue(row[field]);
            });
        worksheet.addRow(values);
    });
    
    // 분석 결과인 경우 type 컬럼에 색상 적용
    if (options.type === 'analysis') {
        const typeColIndex = headers.indexOf('구분') + 1; // ExcelJS는 1부터 시작
        if (typeColIndex > 0) {
            // 헤더 다음 행부터 (2행부터)
            for (let rowIndex = 2; rowIndex <= data.length + 1; rowIndex++) {
                const cell = worksheet.getCell(rowIndex, typeColIndex);
                const cellValue = cell.value;
                
                if (cellValue === '상위 정책') {
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFE3F2FD' }
                    };
                    cell.font = { color: { argb: 'FF1976D2' }, bold: true };
                    cell.alignment = { horizontal: 'center' };
                } else if (cellValue === '하위 정책') {
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFFFF3E0' }
                    };
                    cell.font = { color: { argb: 'FFF57C00' }, bold: true };
                    cell.alignment = { horizontal: 'center' };
                }
            }
        }
    }
    
    // 데이터 행에 테두리 적용
    for (let rowIndex = 2; rowIndex <= data.length + 1; rowIndex++) {
        const row = worksheet.getRow(rowIndex);
        row.eachCell((cell) => {
            cell.border = {
                top: { style: 'thin', color: { argb: 'FFE0E0E0' } },
                left: { style: 'thin', color: { argb: 'FFE0E0E0' } },
                bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } },
                right: { style: 'thin', color: { argb: 'FFE0E0E0' } }
            };
            cell.alignment = { 
                vertical: 'top',
                wrapText: true
            };
        });
    }
    
    // 컬럼 너비 자동 조절 (더 세련되게)
    worksheet.columns.forEach((column, idx) => {
        let maxLength = headers[idx] ? headers[idx].length : 10;
        let hasLongContent = false;
        
        column.eachCell({ includeEmpty: false }, (cell) => {
            const cellValue = sanitizeCellValue(cell.value);
            const cellLength = cellValue.length;
            
            // 셀 값이 길면 더 넓게 설정
            if (cellLength > maxLength) {
                maxLength = cellLength;
            }
            
            // 매우 긴 내용이 있으면 플래그 설정
            if (cellLength > 50) {
                hasLongContent = true;
            }
        });
        
        // 너비 계산: 헤더 길이와 데이터 최대 길이 중 큰 값 사용
        // 최소 12, 최대 35 (매우 긴 내용이 있으면 40까지 허용)
        const baseWidth = Math.max(maxLength + 2, 12);
        const maxWidth = hasLongContent ? 40 : 35;
        column.width = Math.min(baseWidth, maxWidth);
    });
    
    // 헤더 행 높이 설정
    headerRow.height = 28;
    
    // 모든 행의 높이를 자동으로 조절
    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber > 1) { // 헤더 제외
            row.height = undefined; // 자동 높이
        }
    });
    
    // 파일 다운로드
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // 확장자가 이미 포함되어 있으면 그대로 사용, 없으면 추가
    const finalFilename = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
    a.download = finalFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
}

/**
 * 장비명을 가져오는 공통 함수
 * @param {number} deviceId - 장비 ID
 * @param {Array} allDevices - 장비 목록 배열 (선택사항)
 * @returns {Promise<string>} 장비명
 */
export async function getDeviceName(deviceId, allDevices = []) {
    if (!deviceId) {
        throw new Error('장비 ID가 없습니다.');
    }
    
    // deviceId를 숫자로 변환 (타입 불일치 방지)
    const deviceIdNum = Number(deviceId);
    
    // 먼저 allDevices에서 찾기 (타입을 고려한 비교)
    const device = allDevices.find(d => Number(d.id) === deviceIdNum);
    if (device && device.name) {
        return device.name;
    }
    
    // allDevices에서 찾지 못하면 API를 통해 직접 조회
    try {
        const { api } = await import('../api.js');
        const devices = await api.listDevices();
        const foundDevice = devices.find(d => Number(d.id) === deviceIdNum);
        if (foundDevice && foundDevice.name) {
            return foundDevice.name;
        }
        
        // 장비명이 필수 필드이므로 이 경우는 발생하지 않아야 함
        // 하지만 방어 코드로 에러를 발생시킴
        throw new Error(`장비 ID ${deviceId}에 해당하는 장비를 찾을 수 없습니다.`);
    } catch (error) {
        // 이미 에러인 경우 그대로 전달
        if (error.message && error.message.includes('장비 ID')) {
            throw error;
        }
        // API 호출 실패 시
        console.error('장비명을 가져오는 중 오류 발생:', error);
        throw new Error(`장비명을 가져올 수 없습니다: ${error.message}`);
    }
}

/**
 * 그리드 데이터를 엑셀로 내보내기 (공통 함수)
 * @param {Object} gridApi - AG Grid API 객체
 * @param {Array} columnDefs - 컬럼 정의 배열
 * @param {string} defaultFilename - 기본 파일명 (구분)
 * @param {string} emptyMessage - 데이터 없을 때 메시지
 * @param {Object} options - 옵션 (type: 'analysis' | 'policy' | 'object', flattenFn: 평탄화 함수, deviceName: 장비명 또는 deviceId: 장비 ID)
 */
export async function exportGridToExcelClient(gridApi, columnDefs, defaultFilename, emptyMessage = '데이터가 없습니다.', options = {}) {
    if (!gridApi) {
        alert(emptyMessage);
        return;
    }
    
    try {
        // 필터링된 데이터 가져오기
        const rowData = [];
        gridApi.forEachNodeAfterFilter((node) => {
            rowData.push(node.data);
        });
        
        if (rowData.length === 0) {
            alert('내보낼 데이터가 없습니다.');
            return;
        }
        
        // 파일명 생성: 날짜_구분_장비명 형식
        let deviceName = options.deviceName;
        
        // deviceName이 없고 deviceId가 있으면 장비명 가져오기
        if (!deviceName && options.deviceId) {
            try {
                deviceName = await getDeviceName(options.deviceId, options.allDevices || []);
            } catch (error) {
                console.error('장비명을 가져오는 중 오류 발생:', error);
                alert('장비명을 가져올 수 없습니다. 페이지를 새로고침해주세요.');
                return;
            }
        }
        
        // deviceName이 여전히 없으면 에러 (장비 ID도 없고 장비명도 없는 경우)
        if (!deviceName) {
            alert('장비명을 가져올 수 없습니다. 페이지를 새로고침해주세요.');
            return;
        }
        
        const dateStr = generateDateString();
        // 파일명에서 사용할 수 없는 문자 제거 (공백, 특수문자 등)
        const sanitizedDeviceName = deviceName.replace(/[\s\/\\:*?"<>|]/g, '_');
        const suggestedFilename = `${dateStr}_${defaultFilename}_${sanitizedDeviceName}.xlsx`;
        const filename = await promptFilename(suggestedFilename);
        
        if (!filename) {
            return; // 사용자가 취소
        }
        
        // 데이터 평탄화
        let flatData;
        if (options.flattenFn) {
            flatData = options.flattenFn(rowData);
        } else if (options.type === 'analysis') {
            flatData = flattenAnalysisData(rowData);
        } else if (options.type === 'policy') {
            flatData = flattenPolicyData(rowData);
        } else if (options.type === 'object') {
            flatData = flattenObjectData(rowData);
        } else {
            // 기본: 불필요한 필드만 제거
            flatData = rowData.map(row => {
                const { id, _seq_row, task_id, ...rest } = row;
                // policy 객체가 있으면 평탄화
                if (rest.policy) {
                    const { policy, ...otherFields } = rest;
                    return { ...otherFields, ...policy };
                }
                return rest;
            });
        }
        
        // 헤더와 필드 추출
        const { headers, fields } = getHeadersAndFieldsFromColumnDefs(columnDefs);
        
        // 원본 데이터도 함께 저장 (valueGetter 사용을 위해)
        const originalData = [];
        gridApi.forEachNodeAfterFilter((node) => {
            originalData.push(node.data);
        });
        
        // 평탄화된 데이터를 헤더 순서에 맞게 값 배열로 변환 (값 정리 포함)
        const orderedData = flatData.map((row, rowIndex) => {
            return fields.map(field => {
                const colDef = columnDefs.find(col => col.field === field);
                
                let value = '';
                
                // valueGetter가 있는 경우 원본 데이터에서 실행
                if (colDef && colDef.valueGetter && originalData[rowIndex]) {
                    try {
                        value = colDef.valueGetter({ data: originalData[rowIndex] });
                        // valueFormatter가 있으면 적용
                        if (colDef.valueFormatter && value !== null && value !== undefined) {
                            value = colDef.valueFormatter({ value });
                        }
                    } catch (e) {
                        console.warn(`valueGetter 실행 실패 (${field}):`, e);
                        value = row[field] || '';
                    }
                } else {
                    // 평탄화된 데이터에서 직접 가져오기
                    value = row[field] || '';
                }
                
                // 값 정리 (null/undefined 처리 및 제어 문자 제거)
                return sanitizeCellValue(value);
            });
        });
        
        // 엑셀 파일 생성 및 다운로드
        await createExcelFile(orderedData, headers, filename, options);
        
    } catch (error) {
        console.error('엑셀 내보내기 실패:', error);
        alert(`내보내기 실패: ${error.message}`);
    }
}

