// Multi-guild configuration resolution. Everything that depends on "which
// discord server / who" lives here, so adding a new guild is a JSON edit.

import { readFileSync } from 'node:fs';
import { resolveAutoStop } from './autostop.js';
import { BASE_LOCALE, canonicalTag, isSupported } from './i18n/index.js';

const SERVERS_FILE = () => process.env.SERVERS_FILE ?? './config/servers.json';
const GUILDS_FILE = () => process.env.GUILDS_FILE ?? './config/guilds.json';

let serversFile = null;
let guildsFile = null;
let overrides = {}; // runtime /feed toggles: { "<guildId>:<serverId>": true|false|{on, channelId} }

function ensure() {
  if (serversFile && guildsFile) return;
  serversFile = JSON.parse(readFileSync(SERVERS_FILE(), 'utf8'));
  guildsFile = JSON.parse(readFileSync(GUILDS_FILE(), 'utf8'));
}

export function reloadConfig() {
  serversFile = null;
  guildsFile = null;
  ensure();
}

// Test hook: inject config objects without touching the filesystem.
export function __setConfig(servers, guilds) {
  serversFile = servers;
  guildsFile = guilds;
}

export function setOverrides(next) {
  overrides = next ?? {};
}

let autoStopOverrides = {};

export function setAutoStopOverrides(next) {
  autoStopOverrides = next ?? {};
}

// Idioma elegido con /language (se guarda en data/locale.json), por guild.
let localeOverrides = {};

export function setLocaleOverrides(next) {
  localeOverrides = next ?? {};
}

// Idioma efectivo de un guild: override de /language -> guild -> defaults ->
// DEFAULT_LOCALE del entorno -> idioma base. Un valor que no corresponda a ningún
// catálogo se ignora (no se sirve medio idioma): se pasa al siguiente candidato.
export function localeFor(guildId) {
  ensure();
  const candidates = [
    localeOverrides[String(guildId)],
    guildsFile.guilds?.[String(guildId)]?.locale,
    guildsFile.defaults?.locale,
    process.env.DEFAULT_LOCALE,
    BASE_LOCALE,
  ];
  for (const candidate of candidates) {
    if (isSupported(candidate)) return canonicalTag(candidate);
  }
  return BASE_LOCALE;
}

// De dónde sale el idioma efectivo, para poder explicarlo en /language.
export function localeSource(guildId) {
  ensure();
  const candidates = [
    ['override', localeOverrides[String(guildId)]],
    ['guild', guildsFile.guilds?.[String(guildId)]?.locale],
    ['defaults', guildsFile.defaults?.locale],
    ['env', process.env.DEFAULT_LOCALE],
  ];
  for (const [source, candidate] of candidates) {
    if (isSupported(candidate)) return source;
  }
  return 'base';
}

// Config efectiva del auto-apagado para un servidor (override -> config -> desactivado).
export function autoStopConfig(serverId) {
  ensure();
  return resolveAutoStop(serverId, { servers: serversFile, overrides: autoStopOverrides });
}

export function allServers() {
  ensure();
  return serversFile;
}

export function serverMeta(serverId) {
  ensure();
  return serversFile[String(serverId)] ?? {};
}

export function knownServerIds() {
  ensure();
  return Object.keys(serversFile);
}

export function guildConfig(guildId) {
  ensure();
  const defaults = guildsFile.defaults ?? {};
  const guild = guildsFile.guilds?.[String(guildId)] ?? {};
  return { ...defaults, ...guild };
}

export function resolveServer(input) {
  ensure();
  const key = String(input ?? '').trim().toLowerCase();
  if (!key) return null;
  if (serversFile[key]) return key;
  const hit = Object.entries(serversFile).find(
    ([, meta]) => String(meta.alias ?? '').toLowerCase() === key,
  );
  return hit ? hit[0] : null;
}

export function canUseServer(guildId, serverId) {
  const list = guildConfig(guildId).servers;
  return !Array.isArray(list) || list.includes(String(serverId));
}

function overrideFor(guildId, serverId) {
  return overrides[`${guildId}:${serverId}`];
}

export function isAnnounceOn(guildId, serverId) {
  ensure();
  const ov = overrideFor(guildId, serverId);
  if (typeof ov === 'object' && ov !== null) return ov.on !== false;
  return ov ?? Boolean(serversFile[String(serverId)]?.announce);
}

// Which channel (if any) this server announces to, inside this guild.
// Resolution order: runtime override channel -> guild feeds[server] -> guild feedChannelId
export function feedTarget(guildId, serverId) {
  ensure();
  if (!isAnnounceOn(guildId, serverId)) return null;

  const cfg = guildConfig(guildId);
  const ov = overrideFor(guildId, serverId);
  const channelId =
    (typeof ov === 'object' && ov?.channelId) ||
    cfg.feeds?.[String(serverId)] ||
    cfg.feedChannelId ||
    null;

  return channelId;
}

// Servers that need polling (once each, regardless of how many guilds listen).
// Un servidor sin feed pero con auto-apagado también se sondea: el reloj de
// inactividad se alimenta del mismo ciclo.
export function pollTargets() {
  ensure();
  return Object.entries(serversFile)
    .filter(([id, meta]) => meta.announce || autoStopConfig(id) !== null)
    .map(([id]) => id);
}
