import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const STATE_FILE = () => process.env.STATE_FILE ?? './data/state.json';
const FEEDS_FILE = () => process.env.FEEDS_STATE_FILE ?? './data/feeds.json';
const AUTO_STOP_FILE = () => process.env.AUTOSTOP_FILE ?? './data/autostop.json';
const LOCALES_FILE = () => process.env.LOCALES_STATE_FILE ?? './data/locale.json';

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2));
}

// { servers: { "<id>": {players, initialized, unknown} }, feeds: { "<guild>:<id>": {initialized} } }
export function load() {
  const state = readJson(STATE_FILE(), {});
  state.servers ??= {};
  state.feeds ??= {};
  return state;
}

export function save(state) {
  writeJson(STATE_FILE(), state);
}

// Runtime /feed toggles, kept out of the versioned config file.
export function loadFeeds() {
  return readJson(FEEDS_FILE(), {});
}

export function saveFeeds(feeds) {
  writeJson(FEEDS_FILE(), feeds);
}

// Runtime /autostop overrides, mismo patrón que feeds.json: clave = id del servidor.
export function loadAutoStop() {
  return readJson(AUTO_STOP_FILE(), {});
}

export function saveAutoStop(overrides) {
  writeJson(AUTO_STOP_FILE(), overrides);
}

// Idioma elegido con /language: clave = id del guild, valor = tag ('es-MX').
export function loadLocales() {
  return readJson(LOCALES_FILE(), {});
}

export function saveLocales(locales) {
  writeJson(LOCALES_FILE(), locales);
}

// Estado compartido: el watcher y los comandos deben ver el MISMO objeto, porque el
// watcher guarda cada tick y sobrescribiría lo que hubiera escrito un comando.
let shared = null;

export function getState() {
  shared ??= load();
  return shared;
}

// Marca el momento del último control manual, para la gracia del auto-apagado.
export function recordControl(serverId, action, nowMs = Date.now()) {
  const state = getState();
  const st = (state.servers[String(serverId)] ??= { players: [], initialized: false, unknown: false });
  st.lastControlAt = nowMs;
  st.lastControlAction = action;
  return st;
}

// Pure diff: what joined and what left since the last poll.
export function diff(prev, next) {
  if (!prev?.initialized) return { joins: [], leaves: [], baseline: true };

  const before = new Set(prev.players ?? []);
  const after = new Set(next ?? []);

  return {
    joins: [...after].filter((name) => !before.has(name)),
    leaves: [...before].filter((name) => !after.has(name)),
    baseline: false,
  };
}
