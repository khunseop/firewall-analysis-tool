import { api } from "../api.js";
import { openAlert } from "../utils/modal.js";
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
  
  // URL 해시에 따라 탭 전환
  const hash = window.location.hash;
  if (hash === '#/settings/schedules') {
    switchTab('schedules');
  } else if (hash === '#/settings') {
    // 기본 탭은 일반 설정
    switchTab('general');
  }
}

/**
 * 페이지 정리
 */
export function cleanupSettings() {
  cleanupSchedules();
}

