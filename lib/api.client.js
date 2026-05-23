// lib/api.client.js
// Client-side API wrapper — token stored in memory (XSS safe)

let _accessToken = null;
let _refreshing = null;

export function setAccessToken(t) { _accessToken = t; }
export function getAccessToken() { return _accessToken; }
export function clearTokens() { _accessToken = null; }

async function apiFetch(url, options = {}) {
  const headers = { "Content-Type": "application/json", ...options.headers };
  if (_accessToken) headers["Authorization"] = `Bearer ${_accessToken}`;

  const res = await fetch(url, { ...options, headers, credentials: "include" });

  // Silent refresh on 401
  if (res.status === 401 && !options._retry) {
    if (!_refreshing) {
      _refreshing = silentRefresh().finally(() => { _refreshing = null; });
    }
    await _refreshing;
    if (_accessToken) return apiFetch(url, { ...options, _retry: true });
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(json.error || "Request failed");
    error.status = res.status;
    throw error;
  }
  return json.data;
}

async function silentRefresh() {
  try {
    const data = await fetch("/api/auth/refresh", { method: "POST", credentials: "include" }).then(r => r.json());
    if (data?.data?.accessToken) { _accessToken = data.data.accessToken; return data.data; }
  } catch { _accessToken = null; }
  return null;
}

export const apiAuth = {
  async signup(payload) {
    const data = await apiFetch("/api/auth/signup", { method: "POST", body: JSON.stringify(payload) });
    if (data.accessToken) setAccessToken(data.accessToken);
    return data;
  },
  async login(email, password) {
    const data = await apiFetch("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    if (data.accessToken) setAccessToken(data.accessToken);
    return data;
  },
  async logout() {
    await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    clearTokens();
  },
  async me() { return apiFetch("/api/auth/me"); },
  async refresh() { return silentRefresh(); },
};

export const apiProducts = {
  list(params = {}) {
    const q = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([,v]) => v)));
    return apiFetch(`/api/products?${q}`);
  },
};

export const apiOrders = {
  create(payload) { return apiFetch("/api/orders", { method: "POST", body: JSON.stringify(payload) }); },
  list(params = {}) {
    const q = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([,v]) => v)));
    return apiFetch(`/api/orders?${q}`);
  },
};

export const apiJobs = {
  list(params = {}) {
    const q = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([,v]) => v)));
    return apiFetch(`/api/jobs?${q}`);
  },
};

export const apiNotifications = {
  list() { return apiFetch("/api/notifications"); },
  markAll() { return apiFetch("/api/notifications", { method: "PATCH" }); },
};

export const apiDrivers = {
  available(params = {}) {
    const q = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([,v]) => v)));
    return apiFetch(`/api/drivers/available?${q}`);
  },
};

export const apiPayments = {
  createIntent(payload) { return apiFetch("/api/payments/create-intent", { method: "POST", body: JSON.stringify(payload) }); },
};
