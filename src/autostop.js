// Reloj de inactividad (auto-apagado). Lógica PURA: sin Date.now(), sin Discord y sin
// panel, para poder testearla sin red. El watcher aporta los deltas de tiempo, resuelve
// la acción devuelta y es el único que ejecuta el stop.

export const DEFAULT_GRACE_MINUTES = 10;
export const DEFAULT_WARN_MINUTES = 15;
export const MAX_HOURS = 168;
export const MAX_WARN_MINUTES = 120;
// Si no podemos medir la lista de jugadores por más de este tiempo, el crédito se reinicia.
export const BLIND_RESET_MS = 2 * 60 * 60 * 1000;

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

export function newIdle() {
  return { idleMs: 0, idleSince: null, warnedAt: null, blindMs: 0, autoStoppedAt: null };
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Precedencia: override escrito desde Discord (data/autostop.json) -> config/servers.json.
// Devuelve null cuando el auto-apagado está desactivado para ese servidor.
export function resolveAutoStop(serverId, { servers, overrides = {}, graceMinutes } = {}) {
  const key = String(serverId);
  const fromConfig = servers?.[key]?.autoStop ?? null;
  const raw = overrides?.[key] ?? fromConfig;
  if (!raw) return null;

  const hours = Number(raw.hours ?? 0);
  if (!Number.isFinite(hours) || hours <= 0) return null;

  return {
    hours: clamp(hours, 0, MAX_HOURS),
    warnMinutes: clamp(Number(raw.warnMinutes ?? DEFAULT_WARN_MINUTES), 0, MAX_WARN_MINUTES),
    graceMinutes: clamp(
      Number(graceMinutes ?? raw.graceMinutes ?? DEFAULT_GRACE_MINUTES),
      0,
      120,
    ),
    source: overrides?.[key] ? 'override' : 'config',
  };
}

// Nuevo estado de inactividad tras un ciclo de sondeo. `deltaMs` es el tiempo transcurrido
// desde el intento anterior (lo mide el watcher).
//
// Reglas:
//   - sondeo OK con 0 jugadores          -> suma
//   - sondeo OK con jugadores            -> reinicia a 0
//   - sondeo fallido y panel apagado     -> reinicia a 0 (un server apagado no acumula crédito)
//   - sondeo fallido con panel activo    -> congela (no suma); si queda ciego > 2 h, reinicia
export function accumulateIdle(prev, { ok, players, active, deltaMs, nowMs = 0 }) {
  const st = prev ?? newIdle();
  const delta = Math.max(0, Number(deltaMs) || 0);
  const carried = { autoStoppedAt: st.autoStoppedAt ?? null };

  if (!ok) {
    if (active === false) return { ...newIdle(), ...carried };

    const blindMs = (st.blindMs ?? 0) + delta;
    if (blindMs > BLIND_RESET_MS) return { ...newIdle(), ...carried };

    return { ...st, blindMs };
  }

  const count = Array.isArray(players) ? players.length : Number(players ?? 0);
  if (count > 0) return { ...newIdle(), ...carried };

  const idleMs = (st.idleMs ?? 0) + delta;
  return {
    ...st,
    idleMs,
    idleSince: st.idleSince ?? Math.max(0, nowMs - idleMs),
    blindMs: 0,
  };
}

// Qué hacer en este tick: 'none' | 'warn' | 'stop'.
export function evaluateIdle(idle, cfg, { nowMs = 0, lastControlMs = null } = {}) {
  const st = idle ?? newIdle();
  const idleMs = st.idleMs ?? 0;

  if (!cfg || cfg.hours <= 0) return { action: 'none', idleMs, remainingMs: Infinity };

  const remainingMs = Math.max(0, cfg.hours * HOUR_MS - idleMs);

  // Gracia: no apagar justo después de un control manual (arranque lento de un modpack).
  if (lastControlMs != null && nowMs - lastControlMs < cfg.graceMinutes * MINUTE_MS) {
    return { action: 'none', idleMs, remainingMs };
  }
  if (idleMs <= 0) return { action: 'none', idleMs, remainingMs };
  if (remainingMs <= 0) return { action: 'stop', idleMs, remainingMs: 0 };

  const warnMs = cfg.warnMinutes * MINUTE_MS;
  if (warnMs > 0 && remainingMs <= warnMs && !st.warnedAt) {
    return { action: 'warn', idleMs, remainingMs };
  }

  return { action: 'none', idleMs, remainingMs };
}

// "3h 05m" / "42m"
export function formatDuration(ms) {
  const total = Math.max(0, Math.round((Number(ms) || 0) / MINUTE_MS));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return hours > 0 ? `${hours}h ${String(minutes).padStart(2, '0')}m` : `${minutes}m`;
}
