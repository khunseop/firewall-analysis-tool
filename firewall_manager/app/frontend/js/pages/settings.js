import { api } from "../api.js";
import { showEmptyMessage, hideEmptyMessage } from "../utils/message.js";
import { createCommonGridOptions } from "../utils/grid.js";
import { openAlert, openConfirm } from "../utils/modal.js";
// schedules.js의 함수들을 재사용
import { 
  loadDevices, 
  loadSchedules,
  resetForm,
  saveSchedule,
  setupDayButtons,
  cleanupSchedules
} from "./schedules.js";

// ==================== 탭 관리 ====================

/**
 * 탭 전환
 */
function switchTab(tabName) {
  // 모든 탭 콘텐츠 숨기기
  document.querySelectorAll('.tab-content').forEach(content => {
    content.style.display = 'none';
  });
  
  // 모든 탭 아이템 비활성화
  document.querySelectorAll('.tab-item').forEach(item => {
    item.classList.remove('is-active');
  });
  
  // 선택된 탭 활성화
  const tabContent = document.getElementById(`tab-${tabName}`);
  const tabItem = document.querySelector(`.tab-item[data-tab="${tabName}"]`);
  
  if (tabContent) {
    tabContent.style.display = 'block';
  }
  if (tabItem) {
    tabItem.classList.add('is-active');
  }
}

/**
 * 탭 이벤트 설정
 */
function setupTabs() {
  document.querySelectorAll('.tab-item').forEach(item => {
    item.addEventListener('click', () => {
      const tabName = item.dataset.tab;
      switchTab(tabName);
    });
  });
}

// ==================== 일반 설정 ====================

/**
 * 설정 로드
 */
async function loadSettings() {
  try {
    const setting = await api.getSetting('sync_parallel_limit');
    if (setting) {
      document.getElementById('sync-parallel-limit').value = setting.value;
    } else {
      // 기본값 4
      document.getElementById('sync-parallel-limit').value = '4';
    }
  } catch (error) {
    console.error('Failed to load settings:', error);
    // 기본값 4
    document.getElementById('sync-parallel-limit').value = '4';
  }
}

/**
 * 설정 저장
 */
async function saveSettings() {
  const limit = parseInt(document.getElementById('sync-parallel-limit').value);
  
  // 유효성 검사
  if (isNaN(limit) || limit < 1 || limit > 10) {
    await openAlert('오류', '1-10 사이의 숫자를 입력하세요');
    return;
  }
  
  try {
    await api.updateSetting('sync_parallel_limit', {
      value: limit.toString(),
      description: '동기화 병렬 처리 개수 (동시에 동기화할 수 있는 장비 수)'
    });
    await openAlert('성공', '설정이 저장되었습니다');
  } catch (error) {
    console.error('Failed to save settings:', error);
    await openAlert('오류', `설정 저장에 실패했습니다: ${error.message}`);
  }
}

/**
 * 위험 포트 설정 로드
 */
async function loadRiskyPorts() {
  try {
    const setting = await api.getSetting('risky_ports');
    if (setting && setting.value) {
      try {
        const riskyPorts = JSON.parse(setting.value);
        if (Array.isArray(riskyPorts)) {
          document.getElementById('risky-ports-input').value = riskyPorts.join('\n');
        }
      } catch (e) {
        console.error('Failed to parse risky ports:', e);
      }
    }
  } catch (error) {
    if (error.status !== 404) {
      console.error('Failed to load risky ports:', error);
    }
  }
}

/**
 * 위험 포트 설정 저장
 */
async function saveRiskyPorts() {
  const input = document.getElementById('risky-ports-input');
  const value = input.value.trim();
  
  // 입력값을 줄바꿈으로 분리하고 빈 줄 제거
  const ports = value.split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
  
  // 형식 검증 (프로토콜/포트 또는 프로토콜/포트-포트)
  const portPattern = /^[a-z]+\/\d+(-\d+)?$/i;
  const invalidPorts = ports.filter(port => !portPattern.test(port));
  
  if (invalidPorts.length > 0) {
    await openAlert('오류', `잘못된 형식의 포트가 있습니다:\n${invalidPorts.join('\n')}`);
    return;
  }
  
  try {
    // JSON 배열로 변환하여 저장
    await api.updateSetting('risky_ports', {
      value: JSON.stringify(ports),
      description: '위험 포트 목록 (프로토콜/포트 또는 프로토콜/포트-포트 형식)'
    });
    await openAlert('성공', '위험 포트 설정이 저장되었습니다');
  } catch (error) {
    console.error('Failed to save risky ports:', error);
    await openAlert('오류', `위험 포트 설정 저장에 실패했습니다: ${error.message}`);
  }
}

// ==================== 페이지 초기화 ====================

/**
 * 페이지 초기화
 */
export function initSettings(rootEl) {
  // 탭 설정
  setupTabs();
  
  // 일반 설정 탭 초기화
  const saveSettingsBtn = document.getElementById('btn-save-settings');
  if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener('click', saveSettings);
  }
  loadSettings();
  
  // 위험 포트 설정 초기화
  const saveRiskyPortsBtn = document.getElementById('btn-save-risky-ports');
  if (saveRiskyPortsBtn) {
    saveRiskyPortsBtn.addEventListener('click', saveRiskyPorts);
  }
  loadRiskyPorts();
  
  // 동기화 스케줄 탭 초기화 (schedules.js의 함수 재사용)
  setupDayButtons();
  
  // 저장 버튼
  const saveBtn = document.getElementById('btn-save-schedule');
  if (saveBtn) {
    saveBtn.addEventListener('click', saveSchedule);
  }
  
  // 취소 버튼
  const cancelBtn = document.getElementById('btn-cancel-schedule');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      resetForm();
    });
  }
  
  // 데이터 로드
  loadDevices();
  loadSchedules();
  
  // 알림 로그 탭 초기화
  initNotificationLogs();
  
  // 정책 삭제 워크플로우 설정 탭 초기화
  initDeletionWorkflowConfig();
  
  // URL 해시에 따라 탭 전환
  const hash = window.location.hash;
  if (hash === '#/settings/schedules') {
    switchTab('schedules');
  } else if (hash === '#/settings/logs') {
    switchTab('logs');
  } else if (hash === '#/settings/deletion-workflow') {
    switchTab('deletion-workflow');
  } else if (hash === '#/settings') {
    // 기본 탭은 알림 로그
    switchTab('logs');
  }
}

// ==================== 알림 로그 ====================

let logsGrid = null;

/**
 * 알림 로그 그리드 초기화
 */
function initLogsGrid() {
  const gridDiv = document.getElementById('logs-grid');
  if (!gridDiv) return;

  const columnDefs = [
    {
      headerName: '시간',
      field: 'timestamp',
      width: 180,
      valueFormatter: (params) => {
        if (!params.value) return '';
        const date = new Date(params.value);
        // 한국 시간(KST)으로 명시적으로 표시
        return date.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
      },
      sort: 'desc'
    },
    {
      headerName: '제목',
      field: 'title',
      flex: 1,
      minWidth: 150
    },
    {
      headerName: '메시지',
      field: 'message',
      flex: 2,
      minWidth: 200
    },
    {
      headerName: '타입',
      field: 'type',
      width: 100,
      cellRenderer: (params) => {
        const typeMap = {
          'info': '정보',
          'success': '성공',
          'warning': '경고',
          'error': '오류'
        };
        return typeMap[params.value] || params.value;
      },
      cellStyle: (params) => {
        const colorMap = {
          'info': { color: '#6b7280' },
          'success': { color: '#10b981' },
          'warning': { color: '#f59e0b' },
          'error': { color: '#ef4444' }
        };
        return colorMap[params.value] || {};
      }
    },
    {
      headerName: '카테고리',
      field: 'category',
      width: 120,
      cellRenderer: (params) => {
        const categoryMap = {
          'sync': '동기화',
          'analysis': '분석',
          'system': '시스템'
        };
        return categoryMap[params.value] || params.value || '-';
      }
    },
    {
      headerName: '장비',
      field: 'device_name',
      width: 150,
      cellRenderer: (params) => params.value || '-'
    },
  ];

  const commonOptions = createCommonGridOptions({
    paginationPageSizeSelector: [25, 50, 100, 200],
    domLayout: 'autoHeight', // 로그 그리드는 autoHeight 유지
    suppressNoRowsOverlay: false
  });

  const gridOptions = {
    ...commonOptions,
    columnDefs,
    rowData: [],
    defaultColDef: {
      ...commonOptions.defaultColDef,
      sortable: true // 로그 그리드는 정렬 허용
    }
  };

  logsGrid = agGrid.createGrid(gridDiv, gridOptions);
}

/**
 * 알림 로그 로드
 */
async function loadNotificationLogs() {
  const category = document.getElementById('log-filter-category')?.value || '';
  const type = document.getElementById('log-filter-type')?.value || '';

  try {
    const response = await api.getNotifications({
      skip: 0,
      limit: 1000,
      category: category || undefined,
      type: type || undefined
    });

    if (logsGrid) {
      logsGrid.setGridOption('rowData', response.items || []);
    }

    const messageContainer = document.getElementById('logs-message-container');
    if (response.items && response.items.length === 0) {
      showEmptyMessage(messageContainer, '알림 로그가 없습니다.');
    } else {
      hideEmptyMessage(messageContainer);
    }
  } catch (error) {
    console.error('Failed to load notification logs:', error);
    const messageContainer = document.getElementById('logs-message-container');
    showEmptyMessage(messageContainer, '알림 로그를 불러오는데 실패했습니다.');
  }
}

/**
 * 알림 로그 탭 초기화
 */
function initNotificationLogs() {
  // 그리드 초기화
  initLogsGrid();

  // 필터 이벤트
  const categoryFilter = document.getElementById('log-filter-category');
  const typeFilter = document.getElementById('log-filter-type');

  if (categoryFilter) {
    categoryFilter.addEventListener('change', loadNotificationLogs);
  }
  if (typeFilter) {
    typeFilter.addEventListener('change', loadNotificationLogs);
  }

  // 초기 로드
  loadNotificationLogs();
}

// ==================== 정책 삭제 워크플로우 설정 ====================

/**
 * 정책 삭제 워크플로우 설정 로드
 */
async function loadDeletionWorkflowConfig() {
  try {
    const config = await api.getDeletionWorkflowConfig();
    
    // 기본 설정
    document.getElementById('config-recent-policy-days').value = config.timeframes?.recent_policy_days || 90;
    
    // 예외 목록
    const exceptList = config.except_list || [];
    document.getElementById('config-except-list').value = exceptList.join('\n');
    
    // 파싱 패턴 (동적 로드)
    const patterns = config.parsing_patterns || {};
    loadParsingPatterns(patterns);
    
    // Request Type 매핑
    const requestTypeMapping = patterns.request_type_mapping || {};
    document.getElementById('config-request-type-p').value = requestTypeMapping.P || 'GROUP';
    document.getElementById('config-request-type-f').value = requestTypeMapping.F || 'GENERAL';
    document.getElementById('config-request-type-s').value = requestTypeMapping.S || 'SERVER';
    document.getElementById('config-request-type-m').value = requestTypeMapping.M || 'PAM';
    
    // 컬럼 매핑
    loadColumnMapping(config.application_info_column_mapping || {});
    
  } catch (error) {
    console.error('Failed to load deletion workflow config:', error);
    await openAlert({ title: '오류', message: `설정을 불러오는데 실패했습니다: ${error.message}` });
  }
}

/**
 * 표준 컬럼명 목록 (application_info_column_mapping의 키)
 */
const STANDARD_COLUMNS = [
  'REQUEST_ID', 'REQUEST_START_DATE', 'REQUEST_END_DATE', 'TITLE',
  'REQUESTER_ID', 'REQUESTER_EMAIL', 'REQUESTER_NAME', 'REQUESTER_DEPT',
  'WRITE_PERSON_ID', 'WRITE_PERSON_EMAIL', 'WRITE_PERSON_NAME', 'WRITE_PERSON_DEPT',
  'APPROVAL_PERSON_ID', 'APPROVAL_PERSON_EMAIL', 'APPROVAL_PERSON_NAME', 'APPROVAL_PERSON_DEPT_NAME',
  'REQUEST_DATE', 'REQUEST_STATUS', 'PROGRESS', 'MIS_ID', 'GROUP_VERSION'
];

/**
 * 파싱 패턴 로드
 */
function loadParsingPatterns(patterns) {
  const container = document.getElementById('parsing-patterns-list');
  container.innerHTML = '';
  
  // request_type_mapping은 제외
  const filteredPatterns = { ...patterns };
  delete filteredPatterns.request_type_mapping;
  
  for (const [patternName, patternData] of Object.entries(filteredPatterns)) {
    if (patternName === 'description') continue;
    const row = createParsingPatternRow(patternName, patternData);
    container.appendChild(row);
  }
}

/**
 * 파싱 패턴 행 생성
 */
function createParsingPatternRow(patternName, patternData) {
  const div = document.createElement('div');
  div.className = 'box mb-4 parsing-pattern-row';
  div.dataset.patternName = patternName;
  
  const pattern = patternData?.pattern || '';
  const groupMapping = patternData?.group_mapping || {};
  const removePrefix = patternData?.remove_prefix || '';
  const description = patternData?.description || '';
  
  // group_mapping을 JSON 문자열로 변환
  const groupMappingStr = JSON.stringify(groupMapping, null, 2);
  
  div.innerHTML = `
    <div class="level mb-3">
      <div class="level-left">
        <h3 class="subtitle is-6 mb-0">${patternName}</h3>
      </div>
      <div class="level-right">
        <button class="button is-small is-danger" onclick="removeParsingPattern(this)">삭제</button>
      </div>
    </div>
    
    <div class="field">
      <label class="label is-small">패턴 이름</label>
      <div class="control">
        <input class="input is-small parsing-pattern-name" type="text" value="${patternName}" placeholder="패턴 이름 (예: gsams3)" />
      </div>
    </div>
    
    <div class="field">
      <label class="label is-small">정규표현식 패턴</label>
      <div class="control">
        <textarea class="textarea is-small font-monospace parsing-pattern-pattern" rows="2" placeholder="정규표현식 패턴">${pattern}</textarea>
      </div>
    </div>
    
    <div class="field">
      <label class="label is-small">그룹 매핑 (JSON)</label>
      <div class="control">
        <textarea class="textarea is-small font-monospace parsing-pattern-group-mapping" rows="3" placeholder='{"ruleset_id": 1, "start_date": 2}'>${groupMappingStr}</textarea>
      </div>
      <p class="help">정규표현식 그룹 번호와 필드명 매핑 (JSON 형식)</p>
    </div>
    
    <div class="field">
      <label class="label is-small">제거할 접두사 (선택사항)</label>
      <div class="control">
        <input class="input is-small parsing-pattern-remove-prefix" type="text" value="${removePrefix}" placeholder="예: *ACL*" />
      </div>
    </div>
    
    <div class="field">
      <label class="label is-small">설명 (선택사항)</label>
      <div class="control">
        <input class="input is-small parsing-pattern-description" type="text" value="${description}" placeholder="패턴 설명" />
      </div>
    </div>
  `;
  
  return div;
}

/**
 * 파싱 패턴 추가
 */
function addParsingPattern() {
  const container = document.getElementById('parsing-patterns-list');
  const newPattern = {
    pattern: '',
    group_mapping: {},
    description: ''
  };
  const row = createParsingPatternRow('', newPattern);
  container.appendChild(row);
  
  // 패턴 이름 입력 필드를 편집 가능하게
  const nameInput = row.querySelector('.parsing-pattern-name');
  nameInput.removeAttribute('readonly');
  nameInput.style.backgroundColor = '';
}

/**
 * 파싱 패턴 삭제
 */
function removeParsingPattern(button) {
  button.closest('.parsing-pattern-row').remove();
}

/**
 * 컬럼 매핑 로드
 */
function loadColumnMapping(mapping) {
  const container = document.getElementById('column-mapping-list');
  container.innerHTML = '';
  
  // 표준 컬럼명 목록을 순서대로 표시
  for (const standardCol of STANDARD_COLUMNS) {
    const originalCols = mapping[standardCol] || [];
    const row = createColumnMappingRow(standardCol, originalCols);
    container.appendChild(row);
  }
  
  // 표준 컬럼명 목록에 없는 매핑도 표시 (사용자 정의)
  for (const [standardCol, originalCols] of Object.entries(mapping)) {
    if (standardCol === 'description' || STANDARD_COLUMNS.includes(standardCol)) {
      continue;
    }
    const row = createColumnMappingRow(standardCol, originalCols);
    container.appendChild(row);
  }
}

/**
 * 컬럼 매핑 행 생성
 */
function createColumnMappingRow(standardCol, originalCols) {
  const div = document.createElement('div');
  div.className = 'field is-grouped mb-3';
  div.innerHTML = `
    <div class="control is-expanded">
      <input class="input is-small" type="text" value="${standardCol}" placeholder="표준 컬럼명" readonly style="background-color: #f5f5f5;" />
    </div>
    <div class="control is-expanded">
      <input class="input is-small column-mapping-original" type="text" value="${Array.isArray(originalCols) ? originalCols.join(', ') : ''}" placeholder="원본 컬럼명 (쉼표로 구분)" data-standard="${standardCol}" />
    </div>
    <div class="control">
      <button class="button is-small is-danger" onclick="removeColumnMapping(this)">삭제</button>
    </div>
  `;
  return div;
}

/**
 * 정책 삭제 워크플로우 설정 저장
 */
async function saveDeletionWorkflowConfig() {
  try {
    // GUI에서 설정 수집
    const config = collectDeletionWorkflowConfig();
    
    // 유효성 검사
    if (!validateDeletionWorkflowConfig(config)) {
      return;
    }
    
    await api.updateDeletionWorkflowConfig(config);
    await openAlert({ title: '성공', message: '설정이 저장되었습니다' });
    // 저장 후 다시 로드
    await loadDeletionWorkflowConfig();
  } catch (error) {
    console.error('Failed to save deletion workflow config:', error);
    await openAlert({ title: '오류', message: `설정 저장에 실패했습니다: ${error.message}` });
  }
}

/**
 * GUI에서 설정 수집
 */
function collectDeletionWorkflowConfig() {
  // 예외 목록 처리
  const exceptListText = document.getElementById('config-except-list').value.trim();
  const exceptList = exceptListText 
    ? exceptListText.split('\n').map(line => line.trim()).filter(line => line.length > 0)
    : [];
  
  // 파싱 패턴 수집
  const parsingPatterns = {};
  document.querySelectorAll('.parsing-pattern-row').forEach(row => {
    const patternName = row.querySelector('.parsing-pattern-name').value.trim();
    const pattern = row.querySelector('.parsing-pattern-pattern').value.trim();
    const groupMappingText = row.querySelector('.parsing-pattern-group-mapping').value.trim();
    const removePrefix = row.querySelector('.parsing-pattern-remove-prefix').value.trim();
    const description = row.querySelector('.parsing-pattern-description').value.trim();
    
    if (!patternName) return; // 패턴 이름이 없으면 스킵
    
    let groupMapping = {};
    if (groupMappingText) {
      try {
        groupMapping = JSON.parse(groupMappingText);
      } catch (e) {
        console.warn(`파싱 패턴 ${patternName}의 그룹 매핑 JSON 파싱 실패:`, e);
      }
    }
    
    parsingPatterns[patternName] = {
      pattern: pattern,
      group_mapping: groupMapping,
      description: description || ''
    };
    
    if (removePrefix) {
      parsingPatterns[patternName].remove_prefix = removePrefix;
    }
  });
  
  // Request Type 매핑 추가
  parsingPatterns.request_type_mapping = {
    P: document.getElementById('config-request-type-p').value.trim() || 'GROUP',
    F: document.getElementById('config-request-type-f').value.trim() || 'GENERAL',
    S: document.getElementById('config-request-type-s').value.trim() || 'SERVER',
    M: document.getElementById('config-request-type-m').value.trim() || 'PAM',
    description: "Request ID 첫 글자에 따른 타입 매핑"
  };
  
  // 컬럼 매핑 수집
  const columnMapping = {};
  document.querySelectorAll('.column-mapping-original').forEach(input => {
    const standardCol = input.dataset.standard;
    const originalColsText = input.value.trim();
    if (standardCol && originalColsText) {
      const originalCols = originalColsText.split(',').map(col => col.trim()).filter(col => col.length > 0);
      if (originalCols.length > 0) {
        columnMapping[standardCol] = originalCols;
      }
    }
  });
  
  return {
    except_list: exceptList,
    timeframes: {
      recent_policy_days: parseInt(document.getElementById('config-recent-policy-days').value) || 90
    },
    parsing_patterns: parsingPatterns,
    application_info_column_mapping: columnMapping,
    // 기존 설정 유지 (columns, translated_columns는 코드에서 하드코딩되어 있으므로 유지)
    columns: {
      all: [
        "예외", "만료여부", "신청이력", "Rule Name", "Enable", "Action",
        "Source", "User", "Destination", "Service", "Application",
        "Security Profile", "Category", "Description",
        "Request Type", "Request ID", "Ruleset ID", "MIS ID", "Request User", "Start Date", "End Date"
      ],
      no_history: [
        "예외", "Rule Name", "Enable", "Action",
        "Source", "User", "Destination", "Service", "Application",
        "Security Profile", "Category", "Description"
      ],
      date_columns: [
        "REQUEST_START_DATE", "REQUEST_END_DATE", "Start Date", "End Date"
      ]
    },
    translated_columns: {
      "Rule Name": "규칙명",
      "Enable": "활성화",
      "Action": "동작",
      "Source": "출발지",
      "User": "사용자",
      "Destination": "목적지",
      "Service": "서비스",
      "Application": "애플리케이션",
      "Security Profile": "보안 프로필",
      "Category": "카테고리",
      "Description": "설명"
    }
  };
}

/**
 * 설정 유효성 검사
 */
function validateDeletionWorkflowConfig(config) {
  // 날짜 범위 검증
  const days = config.timeframes.recent_policy_days;
  if (isNaN(days) || days < 1 || days > 365) {
    openAlert({ title: '오류', message: '신규 정책 판단 기간은 1-365일 사이여야 합니다.' });
    return false;
  }
  
  // 파싱 패턴 유효성 검사
  for (const [patternName, patternData] of Object.entries(config.parsing_patterns)) {
    if (patternName === 'request_type_mapping' || patternName === 'description') continue;
    
    if (!patternName) {
      openAlert({ title: '오류', message: '파싱 패턴 이름이 비어있습니다.' });
      return false;
    }
    
    // group_mapping이 객체인지 확인
    if (patternData.group_mapping && typeof patternData.group_mapping !== 'object') {
      openAlert({ title: '오류', message: `파싱 패턴 '${patternName}'의 그룹 매핑이 올바르지 않습니다.` });
      return false;
    }
  }
  
  return true;
}

/**
 * 컬럼 매핑 추가
 */
function addColumnMapping() {
  const container = document.getElementById('column-mapping-list');
  
  // 표준 컬럼명 선택 드롭다운 생성
  const div = document.createElement('div');
  div.className = 'field is-grouped mb-3';
  div.innerHTML = `
    <div class="control is-expanded">
      <div class="select is-small is-fullwidth">
        <select class="column-mapping-standard-select">
          <option value="">표준 컬럼명 선택...</option>
          ${STANDARD_COLUMNS.map(col => `<option value="${col}">${col}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="control is-expanded">
      <input class="input is-small column-mapping-original" type="text" placeholder="원본 컬럼명 (쉼표로 구분)" />
    </div>
    <div class="control">
      <button class="button is-small is-success" onclick="confirmAddColumnMapping(this)">추가</button>
    </div>
    <div class="control">
      <button class="button is-small is-light" onclick="cancelAddColumnMapping(this)">취소</button>
    </div>
  `;
  container.appendChild(div);
}

/**
 * 컬럼 매핑 추가 확인
 */
function confirmAddColumnMapping(button) {
  const row = button.closest('.field');
  const select = row.querySelector('.column-mapping-standard-select');
  const input = row.querySelector('.column-mapping-original');
  
  const standardCol = select.value.trim();
  const originalColsText = input.value.trim();
  
  if (!standardCol) {
    openAlert({ title: '오류', message: '표준 컬럼명을 선택하세요.' });
    return;
  }
  
  if (!originalColsText) {
    openAlert({ title: '오류', message: '원본 컬럼명을 입력하세요.' });
    return;
  }
  
  // 기존 매핑이 있는지 확인
  const existingRow = document.querySelector(`input[data-standard="${standardCol}"]`)?.closest('.field');
  if (existingRow) {
    // 기존 매핑 업데이트
    const existingInput = existingRow.querySelector('.column-mapping-original');
    const existingCols = existingInput.value.split(',').map(c => c.trim()).filter(c => c);
    const newCols = originalColsText.split(',').map(c => c.trim()).filter(c => c);
    existingInput.value = [...new Set([...existingCols, ...newCols])].join(', ');
    row.remove();
  } else {
    // 새 매핑 추가
    const originalCols = originalColsText.split(',').map(c => c.trim()).filter(c => c);
    const newRow = createColumnMappingRow(standardCol, originalCols);
    row.replaceWith(newRow);
  }
}

/**
 * 컬럼 매핑 추가 취소
 */
function cancelAddColumnMapping(button) {
  button.closest('.field').remove();
}

/**
 * 컬럼 매핑 삭제
 */
function removeColumnMapping(button) {
  button.closest('.field').remove();
}

/**
 * 정책 삭제 워크플로우 설정 초기화 (기본값으로 리셋)
 */
async function resetDeletionWorkflowConfig() {
  const confirmed = await openConfirm({ title: '확인', message: '기본 설정으로 초기화하시겠습니까? 현재 설정이 모두 사라집니다.' });
  if (!confirmed) return;
  
  try {
    // 기본 설정으로 초기화
    document.getElementById('config-recent-policy-days').value = 90;
    document.getElementById('config-except-list').value = '';
    
    // 파싱 패턴 초기화
    document.getElementById('parsing-patterns-list').innerHTML = '';
    
    // Request Type 매핑 초기화
    document.getElementById('config-request-type-p').value = 'GROUP';
    document.getElementById('config-request-type-f').value = 'GENERAL';
    document.getElementById('config-request-type-s').value = 'SERVER';
    document.getElementById('config-request-type-m').value = 'PAM';
    
    // 컬럼 매핑 초기화
    document.getElementById('column-mapping-list').innerHTML = '';
    
    await openAlert({ title: '성공', message: '기본 설정으로 초기화되었습니다.' });
  } catch (error) {
    console.error('Failed to reset deletion workflow config:', error);
    await openAlert({ title: '오류', message: `설정 초기화에 실패했습니다: ${error.message}` });
  }
}

/**
 * 정책 삭제 워크플로우 설정 탭 초기화
 */
function initDeletionWorkflowConfig() {
  // 저장 버튼
  const saveBtn = document.getElementById('btn-save-deletion-workflow-config');
  if (saveBtn) {
    saveBtn.addEventListener('click', saveDeletionWorkflowConfig);
  }
  
  // 초기화 버튼
  const resetBtn = document.getElementById('btn-reset-deletion-workflow-config');
  if (resetBtn) {
    resetBtn.addEventListener('click', resetDeletionWorkflowConfig);
  }
  
  // 컬럼 매핑 추가 버튼
  const addMappingBtn = document.getElementById('btn-add-column-mapping');
  if (addMappingBtn) {
    addMappingBtn.addEventListener('click', addColumnMapping);
  }
  
  // 파싱 패턴 추가 버튼
  const addParsingPatternBtn = document.getElementById('btn-add-parsing-pattern');
  if (addParsingPatternBtn) {
    addParsingPatternBtn.addEventListener('click', addParsingPattern);
  }
  
  // 파싱 패턴 토글
  const toggleParsingPatterns = document.getElementById('toggle-parsing-patterns');
  if (toggleParsingPatterns) {
    toggleParsingPatterns.addEventListener('click', () => {
      const content = document.getElementById('parsing-patterns-content');
      const toggleText = document.getElementById('parsing-patterns-toggle-text');
      if (content.style.display === 'none') {
        content.style.display = 'block';
        toggleText.textContent = '접기';
      } else {
        content.style.display = 'none';
        toggleText.textContent = '펼치기';
      }
    });
  }
  
  // 컬럼 매핑 토글
  const toggleColumnMapping = document.getElementById('toggle-column-mapping');
  if (toggleColumnMapping) {
    toggleColumnMapping.addEventListener('click', () => {
      const content = document.getElementById('column-mapping-content');
      const toggleText = document.getElementById('column-mapping-toggle-text');
      if (content.style.display === 'none') {
        content.style.display = 'block';
        toggleText.textContent = '접기';
      } else {
        content.style.display = 'none';
        toggleText.textContent = '펼치기';
      }
    });
  }
  
  // 전역 함수로 등록 (HTML에서 호출하기 위해)
  window.removeColumnMapping = removeColumnMapping;
  window.confirmAddColumnMapping = confirmAddColumnMapping;
  window.cancelAddColumnMapping = cancelAddColumnMapping;
  window.removeParsingPattern = removeParsingPattern;
  
  // 초기 로드
  loadDeletionWorkflowConfig();
}

/**
 * 페이지 정리
 */
export function cleanupSettings() {
  cleanupSchedules();
  if (logsGrid) {
    logsGrid.destroy();
    logsGrid = null;
  }
}


