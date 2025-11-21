import { promptFilename } from './utils/excel.js';

const BASE = "/api/v1";

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    let detail = "Request failed";
    try { const data = await res.json(); detail = data.detail || data.msg || detail; } catch {}
    const error = new Error(detail);
    error.status = res.status;
    throw error;
  }
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
}

export const api = {
  listDevices: () => request(`/devices`),
  getDashboardStats: () => request(`/devices/dashboard/stats`),
  createDevice: (payload) => request(`/devices`, { method: "POST", body: JSON.stringify(payload) }),
  updateDevice: (id, payload) => request(`/devices/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteDevice: (id) => request(`/devices/${id}`, { method: "DELETE" }),
  testConnection: (id) => request(`/devices/${id}/test-connection`, { method: "POST" }),
  syncAll: (id) => request(`/firewall/sync-all/${id}`, { method: "POST" }),
  syncStatus: (id) => request(`/firewall/sync/${id}/status`),
  searchPolicies: (payload) => request(`/firewall/policies/search`, { method: "POST", body: JSON.stringify(payload) }),
  getPolicyCount: (deviceId) => request(`/firewall/${deviceId}/policies/count`),
  getObjectCount: (deviceId) => request(`/firewall/${deviceId}/objects/count`),
  getNetworkObjects: (deviceId) => request(`/firewall/${deviceId}/network-objects`),
  getNetworkGroups: (deviceId) => request(`/firewall/${deviceId}/network-groups`),
  getServices: (deviceId) => request(`/firewall/${deviceId}/services`),
  getServiceGroups: (deviceId) => request(`/firewall/${deviceId}/service-groups`),
  searchObjects: (payload) => request(`/firewall/objects/search`, { method: "POST", body: JSON.stringify(payload) }),
  getPolicies: (deviceId) => request(`/firewall/${deviceId}/policies`),
  getObjectDetails: (deviceId, name) => request(`/firewall/object/details?device_id=${deviceId}&name=${encodeURIComponent(name)}`),
  startAnalysis: (deviceId, analysisType, params = {}) => {
    const { days, targetPolicyId, targetPolicyIds, newPosition } = params;
    if (analysisType === 'redundancy') {
      return request(`/analysis/redundancy/${deviceId}`, { method: "POST" });
    } else if (analysisType === 'unused') {
      const url = `/analysis/unused/${deviceId}${days ? `?days=${days}` : ''}`;
      return request(url, { method: "POST" });
    } else if (analysisType === 'impact') {
      // 여러 정책 ID 지원 (targetPolicyIds 우선, 하위 호환을 위해 targetPolicyId도 지원)
      const policyIds = targetPolicyIds || (targetPolicyId ? [targetPolicyId] : []);
      const policyIdsParam = policyIds.map(id => `target_policy_id=${id}`).join('&');
      const url = `/analysis/impact/${deviceId}?${policyIdsParam}&new_position=${newPosition}`;
      return request(url, { method: "POST" });
    } else if (analysisType === 'unreferenced_objects') {
      return request(`/analysis/unreferenced-objects/${deviceId}`, { method: "POST" });
    } else if (analysisType === 'risky_ports') {
      // 위험포트 분석: 정책 ID 파라미터 추가
      const policyIds = params.targetPolicyIds;
      if (policyIds && policyIds.length > 0) {
        const policyIdsParam = policyIds.map(id => `target_policy_id=${id}`).join('&');
        return request(`/analysis/risky-ports/${deviceId}?${policyIdsParam}`, { method: "POST" });
      }
      return request(`/analysis/risky-ports/${deviceId}`, { method: "POST" });
    } else if (analysisType === 'over_permissive') {
      // 과허용정책 분석: 정책 ID 파라미터 추가
      const policyIds = params.targetPolicyIds;
      if (policyIds && policyIds.length > 0) {
        const policyIdsParam = policyIds.map(id => `target_policy_id=${id}`).join('&');
        return request(`/analysis/over-permissive/${deviceId}?${policyIdsParam}`, { method: "POST" });
      }
      return request(`/analysis/over-permissive/${deviceId}`, { method: "POST" });
    }
    throw new Error(`Unknown analysis type: ${analysisType}`);
  },
  getAnalysisStatus: (deviceId) => request(`/analysis/${deviceId}/status`),
  getAnalysisResults: (taskId) => request(`/analysis/redundancy/${taskId}/results`),
  getLatestAnalysisResult: (deviceId, analysisType) => request(`/analysis/${deviceId}/latest-result?analysis_type=${analysisType}`),
  exportToExcel: async (data, filename) => {
    const res = await fetch(`${BASE}/firewall/export/excel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data, filename }),
    });
    if (!res.ok) {
      let detail = "Export failed";
      try { const data = await res.json(); detail = data.detail || data.msg || detail; } catch {}
      throw new Error(detail);
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  },
  downloadDeviceTemplate: async () => {
    const res = await fetch(`${BASE}/devices/excel-template`);
    if (!res.ok) {
      let detail = "Template download failed";
      try { const data = await res.json(); detail = data.detail || data.msg || detail; } catch {}
      throw new Error(detail);
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = "device_template.xlsx";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  },
  bulkImportDevices: async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${BASE}/devices/bulk-import`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      let detail = "Import failed";
      try { const data = await res.json(); detail = data.detail || data.msg || detail; } catch {}
      const error = new Error(detail);
      error.status = res.status;
      throw error;
    }
    return res.json();
  },
  // Sync Schedule APIs
  listSchedules: () => request(`/sync-schedules`),
  getSchedule: (id) => request(`/sync-schedules/${id}`),
  createSchedule: (payload) => request(`/sync-schedules`, { method: "POST", body: JSON.stringify(payload) }),
  updateSchedule: (id, payload) => request(`/sync-schedules/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteSchedule: (id) => request(`/sync-schedules/${id}`, { method: "DELETE" }),
  // Settings APIs
  getSettings: () => request(`/settings`),
  getSetting: (key) => request(`/settings/${key}`),
  updateSetting: (key, payload) => request(`/settings/${key}`, { method: "PUT", body: JSON.stringify(payload) }),
  // Notification APIs
  createNotification: (payload) => request(`/notifications`, { method: "POST", body: JSON.stringify(payload) }),
  getNotifications: (params = {}) => {
    const queryParams = new URLSearchParams();
    if (params.skip !== undefined) queryParams.append('skip', params.skip);
    if (params.limit !== undefined) queryParams.append('limit', params.limit);
    if (params.category) queryParams.append('category', params.category);
    if (params.type) queryParams.append('type', params.type);
    const query = queryParams.toString();
    return request(`/notifications${query ? `?${query}` : ''}`);
  },
  // Deletion Workflow APIs
  getWorkflowStatus: (deviceId) => request(`/deletion-workflow/${deviceId}/status`),
  startWorkflow: (deviceId) => request(`/deletion-workflow/${deviceId}/start`, { method: "POST" }),
  executeStep: async (deviceId, stepNumber, formData) => {
    const res = await fetch(`${BASE}/deletion-workflow/${deviceId}/step/${stepNumber}/execute`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      let detail = "Step execution failed";
      try { const data = await res.json(); detail = data.detail || data.msg || detail; } catch {}
      const error = new Error(detail);
      error.status = res.status;
      throw error;
    }
    return res.json();
  },
  downloadStepResult: async (deviceId, stepNumber, deviceName = null) => {
    const res = await fetch(`${BASE}/deletion-workflow/${deviceId}/step/${stepNumber}/download`);
    if (!res.ok) {
      let detail = "Download failed";
      try { const data = await res.json(); detail = data.detail || data.msg || detail; } catch {}
      throw new Error(detail);
    }
    const blob = await res.blob();
    
    // Step 7은 ZIP 파일, 나머지는 Excel 파일
    const contentType = res.headers.get('content-type') || '';
    const isZip = contentType.includes('application/zip') || stepNumber === 7;
    const extension = isZip ? '.zip' : '.xlsx';
    
    // 파일명 생성: 날짜_구분_장비명 형식
    // deviceName이 없으면 API를 통해 가져오기
    let finalDeviceName = deviceName;
    if (!finalDeviceName && deviceId) {
      try {
        const { getDeviceName } = await import('./utils/excel.js');
        finalDeviceName = await getDeviceName(deviceId);
      } catch (error) {
        console.error('장비명을 가져오는 중 오류 발생:', error);
        throw new Error('장비명을 가져올 수 없습니다. 페이지를 새로고침해주세요.');
      }
    }
    
    if (!finalDeviceName) {
      throw new Error('장비명을 가져올 수 없습니다. 페이지를 새로고침해주세요.');
    }
    
    const dateStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const sanitizedDeviceName = finalDeviceName.replace(/[\s\/\\:*?"<>|]/g, '_');
    const stepNameMap = {
      1: '신청정보파싱',
      2: 'RequestID추출',
      3: 'MISID업데이트',
      4: '신청정보가공',
      5: '신청정보매핑',
      6: '예외처리',
      7: '중복정책분류'
    };
    const stepName = stepNameMap[stepNumber] || `Step${stepNumber}`;
    const defaultFilename = `${dateStr}_${stepName}_${sanitizedDeviceName}${extension}`;
    
    // 파일명 입력 받기
    const filename = await promptFilename(defaultFilename);
    if (!filename) {
      return; // 사용자가 취소
    }
    
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  },
  downloadMasterFile: async (deviceId, deviceName = null) => {
    const res = await fetch(`${BASE}/deletion-workflow/${deviceId}/master/download`);
    if (!res.ok) {
      let detail = "Download failed";
      try { const data = await res.json(); detail = data.detail || data.msg || detail; } catch {}
      throw new Error(detail);
    }
    const blob = await res.blob();
    
    // 파일명 생성: 날짜_구분_장비명 형식
    // deviceName이 없으면 API를 통해 가져오기
    let finalDeviceName = deviceName;
    if (!finalDeviceName && deviceId) {
      try {
        const { getDeviceName } = await import('./utils/excel.js');
        finalDeviceName = await getDeviceName(deviceId);
      } catch (error) {
        console.error('장비명을 가져오는 중 오류 발생:', error);
        throw new Error('장비명을 가져올 수 없습니다. 페이지를 새로고침해주세요.');
      }
    }
    
    if (!finalDeviceName) {
      throw new Error('장비명을 가져올 수 없습니다. 페이지를 새로고침해주세요.');
    }
    
    const dateStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const sanitizedDeviceName = finalDeviceName.replace(/[\s\/\\:*?"<>|]/g, '_');
    const defaultFilename = `${dateStr}_마스터파일_${sanitizedDeviceName}.xlsx`;
    
    // 파일명 입력 받기
    const filename = await promptFilename(defaultFilename);
    if (!filename) {
      return; // 사용자가 취소
    }
    
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  },
  exportFinalResults: (deviceId) => request(`/deletion-workflow/${deviceId}/final/export`, { method: "POST" }),
  downloadFinalResults: async (deviceId, deviceName = null) => {
    const res = await fetch(`${BASE}/deletion-workflow/${deviceId}/final/download`);
    if (!res.ok) {
      let detail = "Download failed";
      try { const data = await res.json(); detail = data.detail || data.msg || detail; } catch {}
      throw new Error(detail);
    }
    const blob = await res.blob();
    
    // 파일명 생성: 날짜_구분_장비명 형식
    // deviceName이 없으면 API를 통해 가져오기
    let finalDeviceName = deviceName;
    if (!finalDeviceName && deviceId) {
      try {
        const { getDeviceName } = await import('./utils/excel.js');
        finalDeviceName = await getDeviceName(deviceId);
      } catch (error) {
        console.error('장비명을 가져오는 중 오류 발생:', error);
        throw new Error('장비명을 가져올 수 없습니다. 페이지를 새로고침해주세요.');
      }
    }
    
    if (!finalDeviceName) {
      throw new Error('장비명을 가져올 수 없습니다. 페이지를 새로고침해주세요.');
    }
    
    const dateStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const sanitizedDeviceName = finalDeviceName.replace(/[\s\/\\:*?"<>|]/g, '_');
    const defaultFilename = `${dateStr}_최종결과_${sanitizedDeviceName}.zip`;
    
    // 파일명 입력 받기
    const filename = await promptFilename(defaultFilename);
    if (!filename) {
      return; // 사용자가 취소
    }
    
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  },
  resetWorkflow: async (deviceId, deleteFiles = true) => {
    const res = await fetch(`${BASE}/deletion-workflow/${deviceId}/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delete_files: deleteFiles }),
    });
    if (!res.ok) {
      let detail = "Reset failed";
      try { const data = await res.json(); detail = data.detail || data.msg || detail; } catch {}
      const error = new Error(detail);
      error.status = res.status;
      throw error;
    }
    return res.json();
  },
};


