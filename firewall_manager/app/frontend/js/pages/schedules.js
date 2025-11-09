import { api } from "../api.js";
import { openConfirm, openAlert } from "../utils/modal.js";
import { showEmptyMessage, hideEmptyMessage } from "../utils/message.js";
import { formatDateTime } from "../utils/date.js";

// ==================== 상수 ====================

const DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];

// ==================== 전역 변수 ====================

let devicesGridApi;
let schedulesGridApi;
let selectedDeviceIds = [];
let editingScheduleId = null;

// ==================== 유틸리티 함수 ====================

/**
 * 요일 버튼 상태 업데이트
 */
function updateDayButtons(selectedDays) {
  document.querySelectorAll('.day-btn').forEach(btn => {
    const day = parseInt(btn.dataset.day);
    if (selectedDays.includes(day)) {
      btn.classList.add('is-primary');
      btn.classList.remove('is-light');
    } else {
      btn.classList.remove('is-primary');
      btn.classList.add('is-light');
    }
  });
}

/**
 * 선택된 요일 가져오기
 */
function getSelectedDays() {
  return Array.from(document.querySelectorAll('.day-btn.is-primary'))
    .map(btn => parseInt(btn.dataset.day))
    .sort();
}

/**
 * 폼 초기화
 */
export function resetForm() {
  document.getElementById('schedule-name').value = '';
  document.getElementById('schedule-enabled').checked = true;
  document.getElementById('schedule-time').value = '09:00';
  document.getElementById('schedule-description').value = '';
  updateDayButtons([]);
  selectedDeviceIds = [];
  editingScheduleId = null;
  
  // 장비 그리드 선택 해제
  if (devicesGridApi) {
    devicesGridApi.deselectAll();
  }
}

/**
 * 폼에 스케줄 데이터 채우기
 */
export function fillScheduleForm(schedule) {
  document.getElementById('schedule-name').value = schedule.name || '';
  document.getElementById('schedule-enabled').checked = schedule.enabled !== false;
  document.getElementById('schedule-time').value = schedule.time || '09:00';
  document.getElementById('schedule-description').value = schedule.description || '';
  updateDayButtons(schedule.days_of_week || []);
  selectedDeviceIds = schedule.device_ids || [];
  editingScheduleId = schedule.id;
  
  // 장비 그리드 선택
  if (devicesGridApi && selectedDeviceIds.length > 0) {
    selectedDeviceIds.forEach(deviceId => {
      devicesGridApi.getRowNode(deviceId.toString())?.setSelected(true);
    });
  }
}

// ==================== 그리드 설정 ====================

/**
 * 장비 그리드 초기화
 */
export function initDevicesGrid(devices) {
  const columnDefs = [
    {
      headerName: '',
      checkboxSelection: true,
      headerCheckboxSelection: true,
      width: 50,
      pinned: 'left',
      lockPosition: true,
    },
    { headerName: 'ID', field: 'id', width: 80 },
    { headerName: '이름', field: 'name', flex: 1 },
    { headerName: 'IP 주소', field: 'ip_address', width: 150 },
    { headerName: '벤더', field: 'vendor', width: 120 },
  ];

  const gridOptions = {
    columnDefs,
    rowData: devices,
    rowSelection: 'multiple',
    suppressRowClickSelection: true,
    getRowId: (params) => params.data.id.toString(),
    onSelectionChanged: () => {
      const selectedRows = devicesGridApi.getSelectedRows();
      selectedDeviceIds = selectedRows.map(row => row.id);
    },
    defaultColDef: {
      sortable: true,
      filter: true,
      resizable: true,
    },
  };

  const gridDiv = document.querySelector('#devices-grid');
  if (gridDiv) {
    gridDiv.innerHTML = '';
    devicesGridApi = agGrid.createGrid(gridDiv, gridOptions);
  }
}

/**
 * 스케줄 그리드 초기화
 */
export function initSchedulesGrid(schedules) {
  const columnDefs = [
    { headerName: 'ID', field: 'id', width: 80 },
    { headerName: '이름', field: 'name', flex: 1 },
    {
      headerName: '요일',
      field: 'days_of_week',
      width: 200,
      valueFormatter: (params) => {
        if (!params.value || !Array.isArray(params.value)) return '';
        return params.value.map(d => DAY_LABELS[d]).join(', ');
      },
    },
    { headerName: '시간', field: 'time', width: 100 },
    {
      headerName: '장비 수',
      field: 'device_ids',
      width: 100,
      valueFormatter: (params) => {
        return params.value ? params.value.length : 0;
      },
    },
    {
      headerName: '활성화',
      field: 'enabled',
      width: 100,
      cellRenderer: (params) => {
        return params.value ? '<span class="tag is-success">활성</span>' : '<span class="tag is-light">비활성</span>';
      },
    },
    {
      headerName: '마지막 실행',
      field: 'last_run_at',
      width: 180,
      valueFormatter: (params) => {
        return params.value ? formatDateTime(new Date(params.value)) : '-';
      },
    },
    {
      headerName: '실행 상태',
      field: 'last_run_status',
      width: 120,
      cellRenderer: (params) => {
        if (!params.value) return '-';
        if (params.value === 'success') {
          return '<span class="tag is-success">성공</span>';
        } else if (params.value === 'failure') {
          return '<span class="tag is-danger">실패</span>';
        }
        return params.value;
      },
    },
    {
      headerName: '작업',
      width: 150,
      cellRenderer: (params) => {
        return `
          <div class="buttons">
            <button class="button is-small is-info edit-schedule" data-id="${params.data.id}">수정</button>
            <button class="button is-small is-danger delete-schedule" data-id="${params.data.id}">삭제</button>
          </div>
        `;
      },
      cellRendererParams: {},
    },
  ];

  const gridOptions = {
    columnDefs,
    rowData: schedules,
    defaultColDef: {
      sortable: true,
      filter: true,
      resizable: true,
    },
  };

  const gridDiv = document.querySelector('#schedules-grid');
  if (gridDiv) {
    gridDiv.innerHTML = '';
    schedulesGridApi = agGrid.createGrid(gridDiv, gridOptions);
    
    // 그리드 높이 조절
    const updateHeight = () => {
      const rowCount = schedulesGridApi.getDisplayedRowCount();
      const headerHeight = 40;
      const rowHeight = 40;
      const maxHeight = 600;
      const calculatedHeight = Math.min(headerHeight + rowCount * rowHeight, maxHeight);
      gridDiv.style.height = `${calculatedHeight}px`;
      schedulesGridApi.sizeColumnsToFit();
    };
    
    schedulesGridApi.addEventListener('firstDataRendered', updateHeight);
    schedulesGridApi.addEventListener('modelUpdated', updateHeight);
    
    // 이벤트 위임으로 버튼 클릭 처리
    gridDiv.addEventListener('click', (e) => {
      if (e.target.classList.contains('edit-schedule')) {
        const scheduleId = parseInt(e.target.dataset.id);
        editSchedule(scheduleId);
      } else if (e.target.classList.contains('delete-schedule')) {
        const scheduleId = parseInt(e.target.dataset.id);
        deleteSchedule(scheduleId);
      }
    });
  }
}

// ==================== 데이터 로딩 ====================

/**
 * 장비 목록 로드
 */
export async function loadDevices() {
  try {
    const devices = await api.listDevices();
    initDevicesGrid(devices);
    if (devices.length === 0) {
      showEmptyMessage('devices-message-container', '장비를 추가하세요');
    } else {
      hideEmptyMessage('devices-message-container');
    }
  } catch (error) {
    console.error('Failed to load devices:', error);
    openAlert('오류', `장비 목록을 불러오는데 실패했습니다: ${error.message}`);
  }
}

/**
 * 스케줄 목록 로드
 */
export async function loadSchedules() {
  try {
    const schedules = await api.listSchedules();
    initSchedulesGrid(schedules);
    if (schedules.length === 0) {
      showEmptyMessage('schedules-message-container', '등록된 스케줄이 없습니다');
    } else {
      hideEmptyMessage('schedules-message-container');
    }
  } catch (error) {
    console.error('Failed to load schedules:', error);
    openAlert('오류', `스케줄 목록을 불러오는데 실패했습니다: ${error.message}`);
  }
}

// ==================== 스케줄 CRUD ====================

/**
 * 스케줄 저장
 */
export async function saveSchedule() {
  const name = document.getElementById('schedule-name').value.trim();
  const enabled = document.getElementById('schedule-enabled').checked;
  const time = document.getElementById('schedule-time').value;
  const description = document.getElementById('schedule-description').value.trim();
  const daysOfWeek = getSelectedDays();

  // 유효성 검사
  if (!name) {
    openAlert('오류', '스케줄 이름을 입력하세요');
    return;
  }

  if (daysOfWeek.length === 0) {
    openAlert('오류', '최소 하나의 요일을 선택하세요');
    return;
  }

  if (selectedDeviceIds.length === 0) {
    openAlert('오류', '최소 하나의 장비를 선택하세요');
    return;
  }

  const payload = {
    name,
    enabled,
    days_of_week: daysOfWeek,
    time,
    device_ids: selectedDeviceIds,
    description: description || null,
  };

  try {
    if (editingScheduleId) {
      await api.updateSchedule(editingScheduleId, payload);
      openAlert('성공', '스케줄이 수정되었습니다');
    } else {
      await api.createSchedule(payload);
      openAlert('성공', '스케줄이 생성되었습니다');
    }
    resetForm();
    await loadSchedules();
  } catch (error) {
    console.error('Failed to save schedule:', error);
    openAlert('오류', `스케줄 저장에 실패했습니다: ${error.message}`);
  }
}

/**
 * 스케줄 수정
 */
export async function editSchedule(scheduleId) {
  try {
    const schedule = await api.getSchedule(scheduleId);
    fillScheduleForm(schedule);
    // 폼 영역으로 스크롤
    document.querySelector('.box').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    console.error('Failed to load schedule:', error);
    openAlert('오류', `스케줄을 불러오는데 실패했습니다: ${error.message}`);
  }
}

/**
 * 스케줄 삭제
 */
export async function deleteSchedule(scheduleId) {
  const confirmed = await openConfirm('확인', '이 스케줄을 삭제하시겠습니까?');
  if (!confirmed) return;

  try {
    await api.deleteSchedule(scheduleId);
    openAlert('성공', '스케줄이 삭제되었습니다');
    await loadSchedules();
  } catch (error) {
    console.error('Failed to delete schedule:', error);
    openAlert('오류', `스케줄 삭제에 실패했습니다: ${error.message}`);
  }
}

// ==================== 이벤트 핸들러 ====================

/**
 * 요일 버튼 클릭 핸들러
 */
export function setupDayButtons() {
  document.querySelectorAll('.day-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.classList.toggle('is-primary');
      btn.classList.toggle('is-light');
    });
  });
}

/**
 * 페이지 초기화
 */
export function initSchedules(rootEl) {
  // 요일 버튼 설정
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
}

/**
 * 페이지 정리
 */
export function cleanupSchedules() {
  if (devicesGridApi) {
    devicesGridApi.destroy();
    devicesGridApi = null;
  }
  if (schedulesGridApi) {
    schedulesGridApi.destroy();
    schedulesGridApi = null;
  }
  selectedDeviceIds = [];
  editingScheduleId = null;
}

