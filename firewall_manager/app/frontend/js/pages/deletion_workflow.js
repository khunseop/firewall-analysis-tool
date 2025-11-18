import { api } from "../api.js";
import { openAlert } from "../utils/modal.js";
import { showEmptyMessage, hideEmptyMessage } from "../utils/message.js";
import { setButtonLoading } from "../utils/loading.js";

let currentDeviceId = null;
let workflowStatus = null;

const STEP_NAMES = {
  1: "신청정보 파싱",
  2: "Request ID 추출",
  3: "MIS ID 업데이트",
  4: "신청정보 가공",
  5: "신청정보 매핑",
  6: "예외처리",
  7: "중복정책 분류"
};

const STEP_STATUS = {
  PENDING: "pending",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  FAILED: "failed"
};

/**
 * 페이지 초기화
 */
export function initDeletionWorkflow(rootEl) {
  currentDeviceId = null;
  workflowStatus = null;
  
  // 초기 상태: 빈 메시지 표시
  showEmptyMessage("workflow-message-container", "장비를 선택하세요");
  
  loadDevices();
  setupEventHandlers();
}

/**
 * 장비 목록 로드
 */
async function loadDevices() {
  try {
    const devices = await api.listDevices();
    const select = document.getElementById("device-select");
    select.innerHTML = '<option value="">장비를 선택하세요</option>';
    
    devices.forEach(device => {
      const option = document.createElement("option");
      option.value = device.id;
      option.textContent = device.name;
      select.appendChild(option);
    });
  } catch (error) {
    console.error("장비 목록 로드 실패:", error);
    openAlert("오류", `장비 목록을 불러오지 못했습니다: ${error.message}`);
  }
}

/**
 * 이벤트 핸들러 설정
 */
function setupEventHandlers() {
  // 장비 선택 변경
  document.getElementById("device-select").addEventListener("change", async (e) => {
    const deviceId = parseInt(e.target.value);
    if (deviceId) {
      currentDeviceId = deviceId;
      hideEmptyMessage("workflow-message-container");
      await loadWorkflowStatus();
    } else {
      currentDeviceId = null;
      hideWorkflowUI();
      showEmptyMessage("workflow-message-container", "장비를 선택하세요");
    }
  });

  // 워크플로우 초기화
  document.getElementById("btn-reset-workflow").addEventListener("click", async () => {
    if (!currentDeviceId) return;
    await resetWorkflow();
  });

  // 워크플로우 시작
  document.getElementById("btn-start-workflow").addEventListener("click", async () => {
    if (!currentDeviceId) return;
    await startWorkflow();
  });

  // 단계 실행 버튼들
  document.querySelectorAll(".step-execute-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const stepNumber = parseInt(e.target.dataset.step);
      await executeStep(stepNumber);
    });
  });

  // 단계 다운로드 버튼들
  document.querySelectorAll(".step-download-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const stepNumber = parseInt(e.target.dataset.step);
      await downloadStepResult(stepNumber);
    });
  });

  // 마스터 파일 다운로드
  document.getElementById("btn-download-master").addEventListener("click", async () => {
    if (!currentDeviceId) return;
    await downloadMasterFile();
  });

  // 최종 결과 생성
  document.getElementById("btn-export-final").addEventListener("click", async () => {
    if (!currentDeviceId) return;
    await exportFinalResults();
  });

  // 최종 결과 다운로드
  document.getElementById("btn-download-final").addEventListener("click", async () => {
    if (!currentDeviceId) return;
    await downloadFinalResults();
  });

  // 파일 업로드 핸들러 - 파일명 표시
  document.getElementById("file-mis-id").addEventListener("change", (e) => {
    updateFileLabel(e.target, "file-mis-id-label");
  });

  document.getElementById("file-application-info").addEventListener("change", (e) => {
    updateFileLabel(e.target, "file-application-info-label");
  });

  document.getElementById("file-redundancy").addEventListener("change", (e) => {
    updateFileLabel(e.target, "file-redundancy-label");
  });
}

/**
 * 워크플로우 상태 로드
 */
async function loadWorkflowStatus() {
  if (!currentDeviceId) return;

  try {
    const status = await api.getWorkflowStatus(currentDeviceId);
    workflowStatus = status;
    updateWorkflowUI(status);
  } catch (error) {
    console.error("워크플로우 상태 로드 실패:", error);
    // 워크플로우가 없으면 초기 상태로 표시
    workflowStatus = {
      device_id: currentDeviceId,
      status: "not_started",
      current_step: 0
    };
    updateWorkflowUI(workflowStatus);
  }
}

/**
 * 워크플로우 UI 업데이트
 */
function updateWorkflowUI(status) {
  const statusBox = document.getElementById("workflow-status-box");
  const checklistBox = document.getElementById("workflow-checklist-box");
  const downloadBox = document.getElementById("download-box");

  if (status.status === "not_started") {
    statusBox.style.display = "block";
    checklistBox.style.display = "block";
    downloadBox.style.display = "none";
    
    document.getElementById("workflow-status").textContent = "시작 전";
    document.getElementById("current-step").textContent = "-";
    
    // 모든 단계를 대기 상태로 설정
    for (let i = 1; i <= 7; i++) {
      updateStepStatus(i, "pending", false);
    }
  } else {
    statusBox.style.display = "block";
    checklistBox.style.display = "block";
    downloadBox.style.display = "block";

    // 상태 표시
    const statusText = {
      "pending": "대기 중",
      "in_progress": "진행 중",
      "completed": "완료",
      "failed": "실패",
      "paused": "일시정지"
    };
    document.getElementById("workflow-status").textContent = statusText[status.status] || status.status;
    document.getElementById("current-step").textContent = status.current_step || "-";

    // 단계별 상태 업데이트
    const stepFiles = status.step_files || {};
    const currentStep = status.current_step || 0;
    
    for (let i = 1; i <= 7; i++) {
      // 파일 존재 여부 확인
      let hasFile = false;
      if (i === 1) {
        // Step 1은 stepFiles['1'] 또는 master_file_path 확인
        hasFile = !!stepFiles['1'] || !!status.master_file_path;
      } else if (i === 7) {
        // Step 7은 7_notice 또는 7_delete 확인
        hasFile = !!stepFiles['7_notice'] || !!stepFiles['7_delete'];
      } else {
        // 다른 step은 stepFiles[stepNumber] 확인
        hasFile = !!stepFiles[i.toString()];
      }
      
      // 단계 완료 여부 판단: 현재 단계보다 작거나, 현재 단계이고 완료 상태
      const isCompleted = i < currentStep || (i === currentStep && status.status === "completed");
      const isInProgress = i === currentStep && status.status === "in_progress";
      const isFailed = i === currentStep && status.status === "failed";
      
      if (isCompleted) {
        // 완료된 step은 항상 다운로드 버튼 표시 (파일이 없으면 백엔드에서 404 반환)
        updateStepStatus(i, "completed", true);
      } else if (isInProgress) {
        updateStepStatus(i, "in_progress", false);
      } else if (isFailed) {
        updateStepStatus(i, "failed", false);
      } else {
        updateStepStatus(i, "pending", false);
      }
    }

    // 최종 결과 버튼 표시
    if (status.final_files && Object.keys(status.final_files).length > 0) {
      document.getElementById("btn-download-final").style.display = "inline-block";
    }
  }
}

/**
 * 단계 상태 업데이트
 */
function updateStepStatus(stepNumber, status, hasFile) {
  const statusEl = document.getElementById(`step-${stepNumber}-status`);
  const checkbox = document.querySelector(`.step-checkbox[data-step="${stepNumber}"]`);
  const executeBtn = document.querySelector(`.step-execute-btn[data-step="${stepNumber}"]`);
  const downloadBtn = document.querySelector(`.step-download-btn[data-step="${stepNumber}"]`);
  const stepItem = document.querySelector(`.step-item[data-step="${stepNumber}"]`);

  // 상태 태그 업데이트
  const statusText = {
    "pending": "대기",
    "in_progress": "진행중",
    "completed": "완료",
    "failed": "실패"
  };
  statusEl.textContent = statusText[status] || status;
  
  // 태그 색상
  statusEl.className = "tag";
  if (status === "completed") {
    statusEl.classList.add("is-success");
  } else if (status === "in_progress") {
    statusEl.classList.add("is-info");
  } else if (status === "failed") {
    statusEl.classList.add("is-danger");
  } else {
    statusEl.classList.add("is-light");
  }

  // 체크박스 상태
  checkbox.checked = status === "completed";
  checkbox.disabled = status === "in_progress";

  // 실행 버튼 활성화/비활성화
  if (status === "in_progress") {
    executeBtn.disabled = true;
    executeBtn.textContent = "실행 중...";
  } else {
    executeBtn.disabled = false;
    executeBtn.textContent = "실행";
  }

  // 다운로드 버튼 표시
  if (downloadBtn) {
    if (hasFile) {
      downloadBtn.style.display = "inline-block";
      downloadBtn.disabled = false;
    } else {
      downloadBtn.style.display = "none";
    }
  } else {
    console.warn(`다운로드 버튼을 찾을 수 없습니다: step-${stepNumber}-download`);
  }

  // 이전 단계 완료 여부 확인하여 실행 버튼 활성화
  if (stepNumber > 1) {
    const prevStepStatusEl = document.getElementById(`step-${stepNumber - 1}-status`);
    if (prevStepStatusEl) {
      const prevStepStatus = prevStepStatusEl.textContent;
      // 이전 단계가 완료되지 않았고 현재 단계가 대기 상태면 비활성화
      if (prevStepStatus !== "완료" && status === "pending") {
        executeBtn.disabled = true;
        executeBtn.title = "이전 단계를 먼저 완료해주세요.";
      } else {
        executeBtn.title = "";
      }
    }
  }
}

/**
 * 파일 라벨 업데이트
 */
function updateFileLabel(fileInput, labelId) {
  const label = document.getElementById(labelId);
  if (label && fileInput.files[0]) {
    label.textContent = fileInput.files[0].name;
  } else if (label) {
    // 기본 라벨 텍스트 복원
    if (labelId === "file-mis-id-label") {
      label.textContent = "CSV 선택";
    } else if (labelId === "file-application-info-label") {
      label.textContent = "엑셀 선택";
    } else if (labelId === "file-redundancy-label") {
      label.textContent = "중복정책 분석 결과";
    }
  }
}

/**
 * 워크플로우 시작
 */
async function startWorkflow() {
  if (!currentDeviceId) return;

  const btn = document.getElementById("btn-start-workflow");
  try {
    setButtonLoading(btn, true);
    const result = await api.startWorkflow(currentDeviceId);
    openAlert("성공", "워크플로우가 시작되었습니다.");
    await loadWorkflowStatus();
  } catch (error) {
    console.error("워크플로우 시작 실패:", error);
    openAlert("오류", `워크플로우 시작 실패: ${error.message}`);
  } finally {
    setButtonLoading(btn, false);
  }
}

/**
 * 단계 실행
 */
async function executeStep(stepNumber) {
  if (!currentDeviceId) return;

  const executeBtn = document.querySelector(`.step-execute-btn[data-step="${stepNumber}"]`);
  
  try {
    updateStepStatus(stepNumber, "in_progress", false);
    setButtonLoading(executeBtn, true);

    const formData = new FormData();
    
    // Step 3: CSV 파일
    if (stepNumber === 3) {
      const fileInput = document.getElementById("file-mis-id");
      if (!fileInput.files[0]) {
        throw new Error("MIS ID CSV 파일을 선택해주세요.");
      }
      formData.append("csv_file", fileInput.files[0]);
    }
    
    // Step 4: 신청정보 엑셀 파일
    if (stepNumber === 4) {
      const fileInput = document.getElementById("file-application-info");
      if (!fileInput.files[0]) {
        throw new Error("신청정보 엑셀 파일을 선택해주세요.");
      }
      formData.append("excel_file", fileInput.files[0]);
    }
    
    // Step 5: 신청정보 엑셀 파일 (Step 4와 동일)
    if (stepNumber === 5) {
      const fileInput = document.getElementById("file-application-info");
      if (fileInput.files[0]) {
        formData.append("excel_file", fileInput.files[0]);
      }
    }
    
    // Step 6: 벤더 선택
    if (stepNumber === 6) {
      const vendor = document.getElementById("vendor-select").value;
      formData.append("vendor", vendor);
    }
    
    // Step 7: 중복정책 분석 결과 파일
    if (stepNumber === 7) {
      const fileInput = document.getElementById("file-redundancy");
      if (!fileInput.files[0]) {
        throw new Error("중복정책 분석 결과 파일을 선택해주세요.");
      }
      formData.append("redundancy_file", fileInput.files[0]);
    }

    const result = await api.executeStep(currentDeviceId, stepNumber, formData);
    openAlert("성공", `Step ${stepNumber} 실행이 완료되었습니다.`);
    await loadWorkflowStatus();
  } catch (error) {
    console.error(`Step ${stepNumber} 실행 실패:`, error);
    updateStepStatus(stepNumber, "failed", false);
    openAlert("오류", `Step ${stepNumber} 실행 실패: ${error.message}`);
  } finally {
    setButtonLoading(executeBtn, false);
  }
}

/**
 * 단계 결과 다운로드
 */
async function downloadStepResult(stepNumber) {
  if (!currentDeviceId) return;

  try {
    await api.downloadStepResult(currentDeviceId, stepNumber);
  } catch (error) {
    console.error("다운로드 실패:", error);
    openAlert("오류", `다운로드 실패: ${error.message}`);
  }
}

/**
 * 마스터 파일 다운로드
 */
async function downloadMasterFile() {
  if (!currentDeviceId) return;

  try {
    await api.downloadMasterFile(currentDeviceId);
  } catch (error) {
    console.error("마스터 파일 다운로드 실패:", error);
    openAlert("오류", `마스터 파일 다운로드 실패: ${error.message}`);
  }
}

/**
 * 최종 결과 생성
 */
async function exportFinalResults() {
  if (!currentDeviceId) return;

  const btn = document.getElementById("btn-export-final");
  try {
    setButtonLoading(btn, true);
    const result = await api.exportFinalResults(currentDeviceId);
    openAlert("성공", "최종 결과 파일이 생성되었습니다.");
    document.getElementById("btn-download-final").style.display = "inline-block";
    await loadWorkflowStatus();
  } catch (error) {
    console.error("최종 결과 생성 실패:", error);
    openAlert("오류", `최종 결과 생성 실패: ${error.message}`);
  } finally {
    setButtonLoading(btn, false);
  }
}

/**
 * 최종 결과 다운로드
 */
async function downloadFinalResults() {
  if (!currentDeviceId) return;

  try {
    await api.downloadFinalResults(currentDeviceId);
  } catch (error) {
    console.error("최종 결과 다운로드 실패:", error);
    openAlert("오류", `최종 결과 다운로드 실패: ${error.message}`);
  }
}

/**
 * 워크플로우 초기화
 */
async function resetWorkflow() {
  if (!currentDeviceId) return;

  // 확인 다이얼로그
  const confirmed = confirm("워크플로우를 초기화하시겠습니까?\n\n초기화하면:\n- 워크플로우 상태가 초기화됩니다\n- 임시 파일들이 삭제됩니다\n\n계속하시겠습니까?");
  if (!confirmed) return;

  const btn = document.getElementById("btn-reset-workflow");
  try {
    setButtonLoading(btn, true);
    await api.resetWorkflow(currentDeviceId, true);
    openAlert("성공", "워크플로우가 초기화되었습니다.");
    
    // UI 초기화
    hideWorkflowUI();
    showEmptyMessage("workflow-message-container", "장비를 선택하세요");
    
    // 상태 다시 로드 (초기 상태로)
    await loadWorkflowStatus();
  } catch (error) {
    console.error("워크플로우 초기화 실패:", error);
    openAlert("오류", `워크플로우 초기화 실패: ${error.message}`);
  } finally {
    setButtonLoading(btn, false);
  }
}

/**
 * 워크플로우 UI 숨기기
 */
function hideWorkflowUI() {
  document.getElementById("workflow-status-box").style.display = "none";
  document.getElementById("workflow-checklist-box").style.display = "none";
  document.getElementById("download-box").style.display = "none";
  
  // 파일 입력 초기화
  document.getElementById("file-mis-id").value = "";
  document.getElementById("file-application-info").value = "";
  document.getElementById("file-redundancy").value = "";
  
  // 파일 라벨 초기화
  updateFileLabel(document.getElementById("file-mis-id"), "file-mis-id-label");
  updateFileLabel(document.getElementById("file-application-info"), "file-application-info-label");
  updateFileLabel(document.getElementById("file-redundancy"), "file-redundancy-label");
}

