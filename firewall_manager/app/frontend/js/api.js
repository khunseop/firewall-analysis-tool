const BASE = "/api/v1";

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    let detail = "Request failed";
    try { const data = await res.json(); detail = data.detail || data.msg || detail; } catch {}
    throw new Error(detail);
  }
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
}

export const api = {
  listDevices: () => request(`/devices`),
  createDevice: (payload) => request(`/devices`, { method: "POST", body: JSON.stringify(payload) }),
  updateDevice: (id, payload) => request(`/devices/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteDevice: (id) => request(`/devices/${id}`, { method: "DELETE" }),
  testConnection: (id) => request(`/devices/${id}/test-connection`, { method: "POST" }),
  syncAll: (id) => request(`/firewall/sync-all/${id}`, { method: "POST" }),
  syncStatus: (id) => request(`/firewall/sync/${id}/status`),
  searchPolicies: (payload) => request(`/firewall/policies/search`, { method: "POST", body: JSON.stringify(payload) }),
  getNetworkObjects: (deviceId) => request(`/firewall/${deviceId}/network-objects`),
  getNetworkGroups: (deviceId) => request(`/firewall/${deviceId}/network-groups`),
  getServices: (deviceId) => request(`/firewall/${deviceId}/services`),
  getServiceGroups: (deviceId) => request(`/firewall/${deviceId}/service-groups`),
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
};


