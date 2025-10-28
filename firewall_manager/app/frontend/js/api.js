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
};


