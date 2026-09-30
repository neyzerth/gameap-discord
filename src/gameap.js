// GameAP panel API client. Every call goes through the panel; RCON is executed
// by the panel/daemon side, so no game port is ever touched from here.

const BASE = process.env.GAMEAP_API_URL ?? 'http://127.0.0.1:8025';
const TOKEN = process.env.GAMEAP_TOKEN;

async function api(path, { method = 'GET', body } = {}) {
  if (!TOKEN) throw new Error('GAMEAP_TOKEN is not configured');

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const err = new Error(data?.error || data?.message || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const listServers = (page = 1, perPage = 50) =>
  api(`/api/servers?page=${page}&per_page=${perPage}`);

// { processActive: boolean }
export const serverStatus = (id) => api(`/api/servers/${id}/status`);

export const startServer = (id) => api(`/api/servers/${id}/start`, { method: 'POST', body: {} });
export const stopServer = (id) => api(`/api/servers/${id}/stop`, { method: 'POST', body: {} });
export const restartServer = (id) => api(`/api/servers/${id}/restart`, { method: 'POST', body: {} });

// { rcon, playersManage, playersList, playersKick, playersBan }
export const rconFeatures = (id) => api(`/api/servers/${id}/rcon/features`);

// [{ id, name, score, ping, ip }]
export const rconPlayers = (id) => api(`/api/servers/${id}/rcon/players`);

// { output }
export const rconCommand = (id, command) =>
  api(`/api/servers/${id}/rcon`, { method: 'POST', body: { command } });

export const isActive = (status) => status?.processActive === true;

export async function playerNames(id) {
  const players = await rconPlayers(id);
  return (players ?? []).map((p) => String(p.name ?? '').trim()).filter(Boolean);
}
