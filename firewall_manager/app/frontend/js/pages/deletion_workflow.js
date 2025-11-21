import { api } from "../api.js";
import { openAlert, openConfirm } from "../utils/modal.js";
import { showEmptyMessage, hideEmptyMessage } from "../utils/message.js";
import { setButtonLoading } from "../utils/loading.js";
import { saveSearchParams, loadSearchParams } from "../utils/storage.js";

let currentDeviceId = null;
let workflowStatus = null;
let allDevices = [];

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
export async function initDeletionWorkflow(rootEl) {
  currentDeviceId = null;
  workflowStatus = null;
  eventHandlersSetup = false; // 이벤트 핸들러 플래그 리셋
  
  // 초기 상태: 빈 메시지 표시
  showEmptyMessage("workflow-message-container", "장비를 선택하세요");
  
  await loadDevices();
  setupEventHandlers();
  
  // 저장된 장비 선택이 있으면 자동으로 워크플로우 상태 로드
  const savedState = loadSearchParams("deletion_workflow");
  if (savedState && savedState.deviceId) {
    const select = document.getElementById("device-select");
    if (select) {
      // Tom Select가 있으면 value를 확인하고, 없으면 일반 value 확인
      const deviceId = select.tomselect 
        ? select.tomselect.getValue() 
        : select.value;
      if (deviceId) {
        // 값이 이미 설정되어 있으면 워크플로우 상태 로드
        await handleDeviceChange(parseInt(deviceId, 10));
      }
    }
  }
}

/**
 * 장비 목록 로드 및 초기화
 */
async function loadDevices() {
  try {
    allDevices = await api.listDevices();
    const select = document.getElementById("device-select");
    if (!select) return;

    select.innerHTML = '<option value="">장비를 선택하세요</option>';
    allDevices.forEach(device => {
      const option = document.createElement("option");
      option.value = device.id;
      option.textContent = `${device.name} (${device.vendor})`;
      select.appendChild(option);
    });

    // 저장된 장비 선택 복원
    const savedState = loadSearchParams("deletion_workflow");
    const savedDeviceId = savedState?.deviceId || null;

    // Initialize Tom Select for device selector
    try {
      if (window.TomSelect && select) {
        // 기존 Tom Select 인스턴스가 있으면 제거
        if (select.tomselect) {
          try {
            select.tomselect.destroy();
          } catch (e) {
            console.warn("Tom Select destroy 실패:", e);
          }
        }
        
        // Tom Select 초기화
        select.tomselect = new window.TomSelect(select, {
          placeholder: "장비를 선택하세요",
          plugins: ["remove_button"],
          maxOptions: null,
        });

        // 저장된 장비 선택 복원
        if (savedDeviceId) {
          select.tomselect.setValue(savedDeviceId.toString());
        }

        // 장비 선택 변경 이벤트
        select.tomselect.on("change", (value) => {
          const deviceId = value ? parseInt(value, 10) : null;
          handleDeviceChange(deviceId);
        });
      } else {
        // Tom Select가 없으면 일반 select 사용
        if (savedDeviceId) {
          select.value = savedDeviceId;
        }
        select.addEventListener("change", (e) => {
          const deviceId = parseInt(e.target.value, 10);
          handleDeviceChange(deviceId);
        });
      }
    } catch (error) {
      console.error("Tom Select 초기화 실패:", error);
      // Tom Select 초기화 실패 시 일반 select 사용
      if (savedDeviceId) {
        select.value = savedDeviceId;
      }
      select.addEventListener("change", (e) => {
        const deviceId = parseInt(e.target.value, 10);
        handleDeviceChange(deviceId);
      });
    }
  } catch (error) {
    console.error("장비 목록 로드 실패:", error);
    await openAlert({ 
      title: "오류", 
      message: `장비 목록을 불러오지 못했습니다: ${error.message}` 
    });
  }
}

/**
 * 장비 선택 변경 핸들러
 */
async function handleDeviceChange(deviceId) {
  const deviceIdNum = deviceId ? parseInt(deviceId, 10) : null;

  // 검색 조건 저장
  if (deviceIdNum) {
    saveSearchParams("deletion_workflow", { deviceId: deviceIdNum });
  } else {
    saveSearchParams("deletion_workflow", { deviceId: null });
  }

  // 장비 선택 처리
  if (deviceIdNum) {
    currentDeviceId = deviceIdNum;
    hideEmptyMessage("workflow-message-container");
    await loadWorkflowStatus();
  } else {
    currentDeviceId = null;
    hideWorkflowUI();
    showEmptyMessage("workflow-message-container", "장비를 선택하세요");
  }
}

// 이벤트 핸들러가 등록되었는지 추적
let eventHandlersSetup = false;

/**
 * 이벤트 핸들러 설정
 */
function setupEventHandlers() {
  // 이미 설정되었으면 중복 등록 방지
  if (eventHandlersSetup) {
    return;
  }
  
  // 장비 선택은 Tom-select의 onChange에서 처리됨

  // 워크플로우 초기화 버튼
  const btnReset = document.getElementById("btn-reset-workflow");
  if (btnReset) {
    // 기존 리스너 제거 후 새로 등록
    btnReset.replaceWith(btnReset.cloneNode(true));
    const newBtnReset = document.getElementById("btn-reset-workflow");
    newBtnReset.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log("Reset 버튼 클릭됨, currentDeviceId:", currentDeviceId);
      if (!currentDeviceId) {
        console.warn("currentDeviceId가 없어서 초기화를 건너뜁니다");
        await openAlert({
          title: "알림",
          message: "장비를 먼저 선택해주세요."
        });
        return;
      }
      await resetWorkflow();
    });
    console.log("Reset 버튼 이벤트 리스너 등록 완료");
  } else {
    console.warn("Reset 버튼을 찾을 수 없습니다");
  }

  // 워크플로우 시작 버튼
  const btnStart = document.getElementById("btn-start-workflow");
  if (btnStart) {
    // 기존 리스너 제거 후 새로 등록
    btnStart.replaceWith(btnStart.cloneNode(true));
    const newBtnStart = document.getElementById("btn-start-workflow");
    newBtnStart.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!currentDeviceId) return;
      await startWorkflow();
    });
  }
  
  eventHandlersSetup = true;

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
  const btnDownloadMaster = document.getElementById("btn-download-master");
  if (btnDownloadMaster) {
    btnDownloadMaster.addEventListener("click", async () => {
      if (!currentDeviceId) return;
      await downloadMasterFile();
    });
  }

  // 최종 결과 생성
  const btnExportFinal = document.getElementById("btn-export-final");
  if (btnExportFinal) {
    btnExportFinal.addEventListener("click", async () => {
      if (!currentDeviceId) return;
      await exportFinalResults();
    });
  }

  // 최종 결과 다운로드
  const btnDownloadFinal = document.getElementById("btn-download-final");
  if (btnDownloadFinal) {
    btnDownloadFinal.addEventListener("click", async () => {
      if (!currentDeviceId) return;
      await downloadFinalResults();
    });
  }

  // 파일 업로드 핸들러 - 파일명 표시
  const fileMisId = document.getElementById("file-mis-id");
  if (fileMisId) {
    fileMisId.addEventListener("change", (e) => {
      updateFileLabel(e.target, "file-mis-id-label");
    });
  }

  const fileApplicationInfo = document.getElementById("file-application-info");
  if (fileApplicationInfo) {
    fileApplicationInfo.addEventListener("change", (e) => {
      updateFileLabel(e.target, "file-application-info-label");
    });
  }

  const fileRedundancy = document.getElementById("file-redundancy");
  if (fileRedundancy) {
    fileRedundancy.addEventListener("change", (e) => {
      updateFileLabel(e.target, "file-redundancy-label");
    });
  }
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
    await openAlert({ 
      title: "성공", 
      message: "워크플로우가 시작되었습니다." 
    });
    await loadWorkflowStatus();
  } catch (error) {
    console.error("워크플로우 시작 실패:", error);
    await openAlert({ 
      title: "오류", 
      message: `워크플로우 시작 실패: ${error.message}` 
    });
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
    await openAlert({ 
      title: "성공", 
      message: `Step ${stepNumber} 실행이 완료되었습니다.` 
    });
    await loadWorkflowStatus();
  } catch (error) {
    console.error(`Step ${stepNumber} 실행 실패:`, error);
    updateStepStatus(stepNumber, "failed", false);
    await openAlert({ 
      title: "오류", 
      message: `Step ${stepNumber} 실행 실패: ${error.message}` 
    });
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
    // 장비명 가져오기 (반드시 필요)
    const device = allDevices.find(d => d.id === currentDeviceId);
    if (!device || !device.name) {
      await openAlert({ 
        title: "오류", 
        message: "장비명을 가져올 수 없습니다. 페이지를 새로고침해주세요." 
      });
      return;
    }
    await api.downloadStepResult(currentDeviceId, stepNumber, device.name);
  } catch (error) {
    console.error("다운로드 실패:", error);
    await openAlert({ 
      title: "오류", 
      message: `다운로드 실패: ${error.message}` 
    });
  }
}

/**
 * 마스터 파일 다운로드
 */
async function downloadMasterFile() {
  if (!currentDeviceId) return;

  try {
    // 장비명 가져오기 (반드시 필요)
    const device = allDevices.find(d => d.id === currentDeviceId);
    if (!device || !device.name) {
      await openAlert({ 
        title: "오류", 
        message: "장비명을 가져올 수 없습니다. 페이지를 새로고침해주세요." 
      });
      return;
    }
    await api.downloadMasterFile(currentDeviceId, device.name);
  } catch (error) {
    console.error("마스터 파일 다운로드 실패:", error);
    await openAlert({ 
      title: "오류", 
      message: `마스터 파일 다운로드 실패: ${error.message}` 
    });
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
    await openAlert({ 
      title: "성공", 
      message: "최종 결과 파일이 생성되었습니다." 
    });
    document.getElementById("btn-download-final").style.display = "inline-block";
    await loadWorkflowStatus();
  } catch (error) {
    console.error("최종 결과 생성 실패:", error);
    await openAlert({ 
      title: "오류", 
      message: `최종 결과 생성 실패: ${error.message}` 
    });
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
    // 장비명 가져오기 (반드시 필요)
    const device = allDevices.find(d => d.id === currentDeviceId);
    if (!device || !device.name) {
      await openAlert({ 
        title: "오류", 
        message: "장비명을 가져올 수 없습니다. 페이지를 새로고침해주세요." 
      });
      return;
    }
    await api.downloadFinalResults(currentDeviceId, device.name);
  } catch (error) {
    console.error("최종 결과 다운로드 실패:", error);
    await openAlert({ 
      title: "오류", 
      message: `최종 결과 다운로드 실패: ${error.message}` 
    });
  }
}

/**
 * 워크플로우 초기화
 */
async function resetWorkflow() {
  console.log("resetWorkflow() 호출됨, currentDeviceId:", currentDeviceId);
  if (!currentDeviceId) {
    console.warn("currentDeviceId가 없어서 초기화를 건너뜁니다");
    return;
  }

  // 확인 다이얼로그
  console.log("확인 다이얼로그 표시 중...");
  const confirmed = await openConfirm({
    title: "워크플로우 초기화",
    message: "워크플로우를 초기화하시겠습니까?\n\n초기화하면:\n- 워크플로우 상태가 초기화됩니다\n- 임시 파일들이 삭제됩니다",
    okText: "초기화",
    cancelText: "취소",
    modalId: "modal-confirm" // 명시적으로 지정
  });
  console.log("확인 다이얼로그 결과:", confirmed);
  if (!confirmed) {
    console.log("사용자가 취소했습니다");
    return;
  }

  const btn = document.getElementById("btn-reset-workflow");
  if (!btn) {
    console.error("Reset 버튼을 찾을 수 없습니다");
    return;
  }

  try {
    console.log("워크플로우 초기화 API 호출 중...");
    setButtonLoading(btn, true);
    await api.resetWorkflow(currentDeviceId, true);
    console.log("워크플로우 초기화 API 호출 완료");
    await openAlert({ 
      title: "성공", 
      message: "워크플로우가 초기화되었습니다." 
    });
    
    // UI 초기화
    hideWorkflowUI();
    showEmptyMessage("workflow-message-container", "장비를 선택하세요");
    
    // 장비 선택 초기화
    const select = document.getElementById("device-select");
    if (select) {
      if (select.tomselect) {
        select.tomselect.clear();
      } else {
        select.value = "";
      }
    }
    
    // 저장된 상태 초기화
    saveSearchParams("deletion_workflow", { deviceId: null });
    currentDeviceId = null;
    workflowStatus = null;
  } catch (error) {
    console.error("워크플로우 초기화 실패:", error);
    await openAlert({ 
      title: "오류", 
      message: `워크플로우 초기화 실패: ${error.message}` 
    });
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

