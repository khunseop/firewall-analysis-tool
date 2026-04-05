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
  } else {
    // 기본 탭은 일반 설정
    switchTab('general');
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
    domLayout: 'autoHeight',
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

// ==================== 정책 삭제 워크플로우 설정 (fpat.yaml 구조 기반) ====================

/**
 * 정책 삭제 워크플로우 설정 로드
 */
async function loadDeletionWorkflowConfig() {
  try {
    const config = await api.getDeletionWorkflowConfig();

    // analysis_criteria
    const ac = config.analysis_criteria || {};
    document.getElementById('config-recent-policy-days').value = ac.recent_policy_days ?? 90;
    document.getElementById('config-unused-threshold-days').value = ac.unused_threshold_days ?? 90;

    const ex = config.exceptions || {};

    // exceptions.static_list — 문자열 배열 또는 객체 배열 모두 지원
    loadStaticListRows(ex.static_list || []);

    // exceptions.request_ids
    loadRequestIdRows(ex.request_ids || []);

    // exceptions.policy_rules
    loadPolicyRuleRows(ex.policy_rules || []);

    // policy_processing.aggregation.column_mapping
    const pp = config.policy_processing || {};
    loadColumnMapping((pp.aggregation || {}).column_mapping || {});

  } catch (error) {
    console.error('Failed to load deletion workflow config:', error);
  }
}

// ── 공통 행 생성 헬퍼 (규칙명/ID/패턴, 사유, 시작일, 만료일, 삭제) ──

function _makeExceptionRow(cssClass, fields) {
  // fields: [{placeholder, value, dataField, width?, monospace?}, ...]
  const div = document.createElement('div');
  div.className = `columns is-mobile is-gapless mb-1 ${cssClass}`;
  div.innerHTML = fields.map(f => `
    <div class="column ${f.width || 'is-3'}" style="padding:2px">
      <input class="input is-small${f.monospace ? ' font-monospace' : ''}" type="${f.type || 'text'}"
        placeholder="${f.placeholder}" value="${(f.value || '').replace(/"/g, '&quot;')}"
        data-field="${f.dataField}" />
    </div>
  `).join('') + `
    <div class="column is-1" style="padding:2px">
      <button class="button is-small is-danger is-light is-fullwidth"
        onclick="this.closest('.${cssClass}').remove()">×</button>
    </div>
  `;
  return div;
}

// ── static_list ──

function loadStaticListRows(staticList) {
  const container = document.getElementById('config-static-list');
  container.innerHTML = '';
  for (const item of staticList) {
    // 구 형식(문자열) 호환
    const name   = typeof item === 'string' ? item : (item.name   || '');
    const reason = typeof item === 'string' ? ''   : (item.reason || '');
    const start  = typeof item === 'string' ? ''   : (item.start  || '');
    const until  = typeof item === 'string' ? ''   : (item.until  || '');
    container.appendChild(createStaticListRow(name, reason, start, until));
  }
}

function createStaticListRow(name, reason, start, until) {
  return _makeExceptionRow('static-list-row', [
    { placeholder: '규칙명 (예: VPN_ACCESS)', value: name,   dataField: 'name',   monospace: true },
    { placeholder: '사유',                    value: reason, dataField: 'reason' },
    { placeholder: '시작일',                  value: start,  dataField: 'start',  type: 'date', width: 'is-2' },
    { placeholder: '만료일',                  value: until,  dataField: 'until',  type: 'date', width: 'is-2' },
  ]);
}

function collectStaticList() {
  return Array.from(document.querySelectorAll('.static-list-row')).map(row => ({
    name:   row.querySelector('[data-field="name"]').value.trim(),
    reason: row.querySelector('[data-field="reason"]').value.trim(),
    start:  row.querySelector('[data-field="start"]').value.trim(),
    until:  row.querySelector('[data-field="until"]').value.trim(),
  })).filter(item => item.name);
}

// ── request_ids ──

function loadRequestIdRows(requestIds) {
  const container = document.getElementById('config-request-ids-list');
  container.innerHTML = '';
  for (const item of requestIds) {
    container.appendChild(createRequestIdRow(
      item.id || '', item.reason || '', item.start || '', item.until || ''
    ));
  }
}

function createRequestIdRow(id, reason, start, until) {
  return _makeExceptionRow('request-id-row', [
    { placeholder: '신청 ID (예: PS-2024-0001)', value: id,     dataField: 'id',     monospace: true },
    { placeholder: '사유',                        value: reason, dataField: 'reason' },
    { placeholder: '시작일',                      value: start,  dataField: 'start',  type: 'date', width: 'is-2' },
    { placeholder: '만료일',                      value: until,  dataField: 'until',  type: 'date', width: 'is-2' },
  ]);
}

function collectRequestIds() {
  return Array.from(document.querySelectorAll('.request-id-row')).map(row => ({
    id:     row.querySelector('[data-field="id"]').value.trim(),
    reason: row.querySelector('[data-field="reason"]').value.trim(),
    start:  row.querySelector('[data-field="start"]').value.trim(),
    until:  row.querySelector('[data-field="until"]').value.trim(),
  })).filter(item => item.id);
}

// ── policy_rules ──

function loadPolicyRuleRows(policyRules) {
  const container = document.getElementById('config-policy-rules-list');
  container.innerHTML = '';
  for (const item of policyRules) {
    container.appendChild(createPolicyRuleRow(
      item.pattern || '', item.reason || '', item.start || '', item.until || ''
    ));
  }
}

function createPolicyRuleRow(pattern, reason, start, until) {
  return _makeExceptionRow('policy-rule-row', [
    { placeholder: '정규표현식 (예: ^MGMT_.*)', value: pattern, dataField: 'pattern', monospace: true },
    { placeholder: '사유',                      value: reason,  dataField: 'reason' },
    { placeholder: '시작일',                    value: start,   dataField: 'start',  type: 'date', width: 'is-2' },
    { placeholder: '만료일',                    value: until,   dataField: 'until',  type: 'date', width: 'is-2' },
  ]);
}

function collectPolicyRules() {
  return Array.from(document.querySelectorAll('.policy-rule-row')).map(row => ({
    pattern: row.querySelector('[data-field="pattern"]').value.trim(),
    reason:  row.querySelector('[data-field="reason"]').value.trim(),
    start:   row.querySelector('[data-field="start"]').value.trim(),
    until:   row.querySelector('[data-field="until"]').value.trim(),
  })).filter(item => item.pattern);
}

// ── column_mapping (원본 → 표준 / fpat.yaml 형식) ──

/**
 * 컬럼 매핑 로드 (fpat.yaml: { "원본컬럼명": "표준컬럼명" })
 */
function loadColumnMapping(mapping) {
  const container = document.getElementById('column-mapping-list');
  container.innerHTML = '';
  for (const [originalCol, standardCol] of Object.entries(mapping)) {
    container.appendChild(createColumnMappingRow(originalCol, standardCol));
  }
}

function createColumnMappingRow(originalCol, standardCol) {
  const div = document.createElement('div');
  div.className = 'field is-grouped mb-2 column-mapping-row';
  div.innerHTML = `
    <div class="control is-expanded">
      <input class="input is-small" type="text" placeholder="원본 컬럼명 (예: 신청번호)"
        value="${originalCol}" data-field="original" />
    </div>
    <div class="control" style="align-self:center; padding: 0 8px">→</div>
    <div class="control is-expanded">
      <input class="input is-small font-monospace" type="text" placeholder="표준 컬럼명 (예: REQUEST_ID)"
        value="${standardCol}" data-field="standard" />
    </div>
    <div class="control">
      <button class="button is-small is-danger is-light" onclick="this.closest('.column-mapping-row').remove()">삭제</button>
    </div>
  `;
  return div;
}

function addColumnMapping() {
  document.getElementById('column-mapping-list').appendChild(createColumnMappingRow('', ''));
}

function collectColumnMapping() {
  const result = {};
  document.querySelectorAll('.column-mapping-row').forEach(row => {
    const original = row.querySelector('[data-field="original"]').value.trim();
    const standard = row.querySelector('[data-field="standard"]').value.trim();
    if (original && standard) result[original] = standard;
  });
  return result;
}

// ── save / collect / validate / reset ──

/**
 * GUI에서 fpat.yaml 구조로 설정 수집
 */
function collectDeletionWorkflowConfig() {
  return {
    analysis_criteria: {
      recent_policy_days:    parseInt(document.getElementById('config-recent-policy-days').value)    || 90,
      unused_threshold_days: parseInt(document.getElementById('config-unused-threshold-days').value) || 90,
    },
    exceptions: {
      static_list:  collectStaticList(),
      request_ids:  collectRequestIds(),
      policy_rules: collectPolicyRules(),
    },
    policy_processing: {
      aggregation: {
        column_mapping: collectColumnMapping(),
      },
    },
  };
}

function validateDeletionWorkflowConfig(config) {
  const days = config.analysis_criteria.recent_policy_days;
  if (isNaN(days) || days < 1 || days > 365) {
    openAlert({ title: '오류', message: '신규 정책 판단 기간은 1-365일 사이여야 합니다.' });
    return false;
  }
  return true;
}

async function saveDeletionWorkflowConfig() {
  try {
    const config = collectDeletionWorkflowConfig();
    if (!validateDeletionWorkflowConfig(config)) return;
    await api.updateDeletionWorkflowConfig(config);
    await openAlert({ title: '성공', message: '설정이 저장되었습니다.' });
    await loadDeletionWorkflowConfig();
  } catch (error) {
    console.error('Failed to save deletion workflow config:', error);
    await openAlert({ title: '오류', message: `설정 저장에 실패했습니다: ${error.message}` });
  }
}

async function resetDeletionWorkflowConfig() {
  const confirmed = await openConfirm({ title: '확인', message: '기본 설정으로 초기화하시겠습니까?' });
  if (!confirmed) return;
  document.getElementById('config-recent-policy-days').value = 90;
  document.getElementById('config-unused-threshold-days').value = 90;
  document.getElementById('config-static-list').innerHTML = '';
  document.getElementById('config-request-ids-list').innerHTML = '';
  document.getElementById('config-policy-rules-list').innerHTML = '';
  document.getElementById('column-mapping-list').innerHTML = '';
  await openAlert({ title: '성공', message: '기본값으로 초기화되었습니다.' });
}

function _setupToggle(btnId, contentId, textId) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.addEventListener('click', () => {
    const content = document.getElementById(contentId);
    const text = document.getElementById(textId);
    const isHidden = content.style.display === 'none';
    content.style.display = isHidden ? 'block' : 'none';
    text.textContent = isHidden ? '접기' : '펼치기';
  });
}

/**
 * 정책 삭제 워크플로우 설정 탭 초기화
 */
function initDeletionWorkflowConfig() {
  const saveBtn = document.getElementById('btn-save-deletion-workflow-config');
  if (saveBtn) saveBtn.addEventListener('click', saveDeletionWorkflowConfig);

  const resetBtn = document.getElementById('btn-reset-deletion-workflow-config');
  if (resetBtn) resetBtn.addEventListener('click', resetDeletionWorkflowConfig);

  const addStaticRuleBtn = document.getElementById('btn-add-static-rule');
  if (addStaticRuleBtn) addStaticRuleBtn.addEventListener('click', () => {
    document.getElementById('config-static-list').appendChild(createStaticListRow('', '', '', ''));
  });

  const addRequestIdBtn = document.getElementById('btn-add-request-id');
  if (addRequestIdBtn) addRequestIdBtn.addEventListener('click', () => {
    document.getElementById('config-request-ids-list').appendChild(createRequestIdRow('', '', '', ''));
  });

  const addPolicyRuleBtn = document.getElementById('btn-add-policy-rule');
  if (addPolicyRuleBtn) addPolicyRuleBtn.addEventListener('click', () => {
    document.getElementById('config-policy-rules-list').appendChild(createPolicyRuleRow('', '', '', ''));
  });

  const addMappingBtn = document.getElementById('btn-add-column-mapping');
  if (addMappingBtn) addMappingBtn.addEventListener('click', addColumnMapping);

  _setupToggle('toggle-column-mapping', 'column-mapping-content', 'column-mapping-toggle-text');

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


