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
    const textarea = document.getElementById('deletion-workflow-config-input');
    if (textarea) {
      textarea.value = JSON.stringify(config, null, 2);
    }
  } catch (error) {
    console.error('Failed to load deletion workflow config:', error);
    await openAlert('오류', `설정을 불러오는데 실패했습니다: ${error.message}`);
  }
}

/**
 * 정책 삭제 워크플로우 설정 저장
 */
async function saveDeletionWorkflowConfig() {
  const textarea = document.getElementById('deletion-workflow-config-input');
  const value = textarea.value.trim();
  
  if (!value) {
    await openAlert('오류', '설정을 입력하세요');
    return;
  }
  
  let config;
  try {
    config = JSON.parse(value);
  } catch (e) {
    await openAlert('오류', `잘못된 JSON 형식입니다:\n${e.message}`);
    return;
  }
  
  try {
    await api.updateDeletionWorkflowConfig(config);
    await openAlert('성공', '설정이 저장되었습니다');
    // 저장 후 다시 로드하여 서버에서 반환된 형식으로 표시
    await loadDeletionWorkflowConfig();
  } catch (error) {
    console.error('Failed to save deletion workflow config:', error);
    await openAlert('오류', `설정 저장에 실패했습니다: ${error.message}`);
  }
}

/**
 * 정책 삭제 워크플로우 설정 초기화 (기본값으로 리셋)
 */
async function resetDeletionWorkflowConfig() {
  const confirmed = await openConfirm('확인', '기본 설정으로 초기화하시겠습니까? 현재 설정이 모두 사라집니다.');
  if (!confirmed) return;
  
  try {
    // 기본 설정 구조 (예시 - 실제로는 서버에서 가져오거나 하드코딩)
    const defaultConfig = {
      "file_naming": {
        "policy_version_format": "_v{version}",
        "final_version_suffix": "_vf",
        "request_id_prefix": "request_id_"
      },
      "file_extensions": {
        "excel": ".xlsx",
        "csv": ".csv"
      },
      "excel_styles": {
        "header_fill_color": "E0E0E0",
        "history_fill_color": "ccffff"
      },
      "columns": {
        "all": [
          "예외", "만료여부", "신청이력", "Rule Name", "Enable", "Action",
          "Source", "User", "Destination", "Service", "Application",
          "Security Profile", "Category", "Description",
          "Request Type", "Request ID", "Ruleset ID", "MIS ID", "Request User", "Start Date", "End Date"
        ],
        "no_history": [
          "예외", "Rule Name", "Enable", "Action",
          "Source", "User", "Destination", "Service", "Application",
          "Security Profile", "Category", "Description"
        ],
        "date_columns": [
          "REQUEST_START_DATE", "REQUEST_END_DATE", "Start Date", "End Date"
        ]
      },
      "translated_columns": {
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
      },
      "except_list": [],
      "timeframes": {
        "recent_policy_days": 90
      },
      "parsing_patterns": {
        "gsams3": {
          "pattern": "",
          "group_mapping": {
            "ruleset_id": 1,
            "start_date": 2,
            "end_date": 3,
            "request_user": 4,
            "request_id": 5,
            "mis_id": 6
          },
          "description": "GSAMS3 형식 패턴"
        },
        "gsams1_rulename": {
          "pattern": "",
          "group_mapping": {
            "request_id": 1
          },
          "description": "GSAMS1 규칙명 패턴"
        },
        "gsams1_user": {
          "pattern": "",
          "group_mapping": {
            "request_user": 1
          },
          "remove_prefix": "*ACL*",
          "description": "GSAMS1 사용자 패턴"
        },
        "gsams1_description": {
          "pattern": "",
          "group_mapping": {
            "request_id": 1
          },
          "description": "GSAMS1 description 패턴"
        },
        "gsams1_date": {
          "pattern": "",
          "group_mapping": {
            "date_range": 0
          },
          "description": "GSAMS1 날짜 패턴"
        },
        "request_type_mapping": {
          "P": "GROUP",
          "F": "GENERAL",
          "S": "SERVER",
          "M": "PAM",
          "description": "Request ID 첫 글자에 따른 타입 매핑"
        }
      }
    };
    
    const textarea = document.getElementById('deletion-workflow-config-input');
    if (textarea) {
      textarea.value = JSON.stringify(defaultConfig, null, 2);
    }
  } catch (error) {
    console.error('Failed to reset deletion workflow config:', error);
    await openAlert('오류', `설정 초기화에 실패했습니다: ${error.message}`);
  }
}

/**
 * 정책 삭제 워크플로우 설정 포맷 (JSON 포맷팅)
 */
function formatDeletionWorkflowConfig() {
  const textarea = document.getElementById('deletion-workflow-config-input');
  const value = textarea.value.trim();
  
  if (!value) {
    return;
  }
  
  try {
    const config = JSON.parse(value);
    textarea.value = JSON.stringify(config, null, 2);
  } catch (e) {
    // 포맷 실패 시 에러 표시하지 않음 (사용자가 수정 중일 수 있음)
    console.warn('Failed to format JSON:', e);
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
  
  // 포맷 버튼
  const formatBtn = document.getElementById('btn-format-deletion-workflow-config');
  if (formatBtn) {
    formatBtn.addEventListener('click', formatDeletionWorkflowConfig);
  }
  
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

