// Power-outage policy: what to announce when the UPS reports that the mains are gone.
//
// Pure decisions only — no sockets, no Discord, no panel. `decidePower` takes the
// previous state plus the parsed `ups.status` and returns which announcements are
// due; the loop that talks to NUT/Discord/GameAP lives in power-watch.js.
//
// Everything here is optional: with no `config/power.json` (or `enabled: false`)
// the loop never starts and the bot behaves exactly as before.

import { t } from './i18n/index.js';

export const ONLINE = 'online';
export const ON_BATTERY = 'onBattery';
export const LOW = 'low';
export const UNKNOWN = 'unknown';

// In-game texts must not carry emoji (Minecraft renders them as tofu on some
// clients). The test suite asserts this over these keys, so a stray ⚡ in the
// catalog fails CI instead of reaching the players.
export const GAME_TEXT_KEYS = [
  'power.game.outage.title',
  'power.game.outage.subtitle',
  'power.game.outage.headline',
  'power.game.outage.body',
  'power.game.low.title',
  'power.game.low.headline',
  'power.game.low.body',
];

export const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

const MIN = 60_000;

export function newPowerState() {
  return { status: null, obSince: null, stage1At: null, stage2At: null, stoppedAt: null };
}

// NUT's ups.status is a space-separated flag list: OL (on line), OB (on battery),
// LB (low battery), CHRG/DISCHRG, RB, CAL, OFF... Anything we do not recognise is
// UNKNOWN, and UNKNOWN means silence.
export function parseUpsStatus(raw) {
  const flags = String(raw ?? '').toUpperCase().split(/\s+/).filter(Boolean);
  if (!flags.length) return UNKNOWN;
  if (flags.includes('OB') && flags.includes('LB')) return LOW;
  if (flags.includes('OB')) return ON_BATTERY;
  if (flags.includes('OL')) return ONLINE;
  return UNKNOWN;
}

// One announcement per episode: 'outage' the first time OB shows up, 'low' the
// first time the battery is low, 'restored' when the mains come back after an
// episode. Going straight from online to low returns ['outage', 'low'] so the
// players still get the warning before the shutdown.
export function decidePower(prev, status, nowMs = Date.now()) {
  const state = { ...newPowerState(), ...(prev ?? {}) };

  // A failed or ambiguous read must never turn into "the mains are gone".
  if (status === UNKNOWN) return { actions: [], state };

  if (status === ONLINE) {
    const hadOutage = Boolean(state.obSince);
    return {
      actions: hadOutage ? ['restored'] : [],
      state: { ...newPowerState(), status: ONLINE },
      durationMs: hadOutage ? Math.max(0, nowMs - state.obSince) : 0,
      stopped: Boolean(state.stoppedAt),
    };
  }

  state.status = status;
  state.obSince ??= nowMs;

  const actions = [];
  if (!state.stage1At) {
    actions.push('outage');
    state.stage1At = nowMs;
  }
  if (status === LOW && !state.stage2At) {
    actions.push('low');
    state.stage2At = nowMs;
  }
  return { actions, state, durationMs: 0, stopped: false };
}

const clampMs = (value, fallback, min, max) => {
  const ms = Number(value);
  if (!Number.isFinite(ms)) return fallback;
  return Math.min(max, Math.max(min, Math.round(ms)));
};

// Normalises config/power.json. Returns null when the feature is disabled or the
// config cannot work (no UPS name, no servers): null means "do not even start the
// loop", which is what keeps the feature invisible for everyone else.
export function normalizePowerConfig(raw, env = process.env) {
  if (!raw || typeof raw !== 'object' || raw.enabled !== true) return null;

  const servers = (Array.isArray(raw.servers) ? raw.servers : []).map((id) => String(id)).filter(Boolean);
  const ups = String(raw.nut?.ups ?? '').trim();
  if (!servers.length || !ups) return null;

  return {
    enabled: true,
    dryRun: raw.dryRun === true || env.POWER_DRY_RUN === 'true',
    nut: {
      host: String(raw.nut?.host ?? '127.0.0.1'),
      port: Number(raw.nut?.port) || 3493,
      ups,
      timeoutMs: clampMs(raw.nut?.timeoutMs, 3000, 500, 15_000),
    },
    pollMs: clampMs(raw.pollMs, 10_000, 2000, 60_000),
    servers,
    channels: { ...(raw.channels ?? {}) },
    notifyEveryoneOnLowBattery: raw.notifyEveryoneOnLowBattery !== false,
    lowBatteryMention: String(raw.lowBatteryMention ?? '@everyone').trim(),
    stopServersOnLowBattery: raw.stopServersOnLowBattery !== false,
    stopDelayMs: clampMs(raw.stopDelayMs, 5000, 0, 30_000),
  };
}

// El panel rechaza comandos RCON de más de 127 caracteres ("command must not exceed
// 127 characters"), así que todo lo que sale por RCON tiene que caber ahí. Se mide en
// bytes UTF-8 porque el panel cuenta bytes y los textos en español llevan acentos.
export const RCON_MAX_BYTES = 127;

const byteLength = (line) => Buffer.byteLength(line, 'utf8');

const styleKey = (component) => JSON.stringify({ ...component, text: undefined });
const sameStyle = (a, b) => styleKey(a) === JSON.stringify(b);
const jsonBytes = (components, prefix) => byteLength(`${prefix}${JSON.stringify(components)}`);

// Junta la unidad con el último componente si el estilo coincide (así el texto no se
// parte en trozos del mismo color).
const mergeInto = (current, { text, style }) => {
  const last = current.at(-1);
  if (last && sameStyle(last, style)) {
    return [...current.slice(0, -1), { ...last, text: `${last.text} ${text}` }];
  }
  return [...current, { text, ...style }];
};

// Para una oración que no cabe ni sola: se parte por palabras.
function packWords(words, limit, prefix) {
  const groups = [];
  let current = [];
  for (const word of words) {
    const merged = mergeInto(current, word);
    if (current.length && jsonBytes(merged, prefix) > limit) {
      groups.push(current);
      current = [{ text: word.text, ...word.style }];
    } else {
      current = merged;
    }
    if (jsonBytes(current, prefix) > limit) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length) groups.push(current);
  return groups;
}

// Parte los componentes en varios `tellraw` para que ningún comando pase del límite
// del panel (un aviso largo devolvería un 400). Primero se corta por oraciones para
// que cada línea del chat se lea completa, y una oración que no quepa sola se parte
// por palabras. Se conservan el orden y el estilo.
export function tellrawChunks(components, limit = RCON_MAX_BYTES) {
  const prefix = 'tellraw @a ';
  const sentences = [];
  for (const component of components) {
    const { text, ...style } = component;
    for (const sentence of String(text).split(/(?<=[.!?:;])\s+/).filter(Boolean)) {
      sentences.push({ text: sentence, style });
    }
  }

  const chunks = [];
  let current = [];
  for (const sentence of sentences) {
    const merged = mergeInto(current, sentence);
    if (current.length && jsonBytes(merged, prefix) > limit) {
      chunks.push(current);
      current = [{ text: sentence.text, ...sentence.style }];
    } else {
      current = merged;
    }

    if (jsonBytes(current, prefix) > limit) {
      // La oración no cabe sola: se parte por palabras (y no se pierde nada).
      const words = current.flatMap((component) => {
        const { text, ...style } = component;
        return String(text).split(/\s+/).filter(Boolean).map((word) => ({ text: word, style }));
      });
      chunks.push(...packWords(words, limit, prefix));
      current = [];
    }
  }
  if (current.length) chunks.push(current);

  return chunks.map((group) => `${prefix}${JSON.stringify(group)}`);
}

// The in-game announcement as RCON lines. tellraw/title take JSON text
// components, so the texts go through JSON.stringify (the escaping stays right
// even if the catalog gains quotes) and `save-all flush` closes the pipeline:
// the host may lose power for good before it can shut down cleanly.
export function rconPipeline(locale, stage) {
  const times = 'title @a times 10 100 20';
  const save = 'save-all flush';
  const title = (key, color) =>
    `title @a title ${JSON.stringify({ text: t(locale, key), color, bold: true })}`;

  if (stage === 'outage') {
    return [
      times,
      title('power.game.outage.title', 'gold'),
      `title @a subtitle ${JSON.stringify({ text: t(locale, 'power.game.outage.subtitle'), color: 'yellow' })}`,
      ...tellrawChunks([
        { text: t(locale, 'power.game.outage.headline'), color: 'gold', bold: true },
        { text: t(locale, 'power.game.outage.body'), color: 'yellow' },
      ]),
      save,
    ];
  }

  if (stage === 'low') {
    return [
      times,
      title('power.game.low.title', 'red'),
      ...tellrawChunks([
        { text: t(locale, 'power.game.low.headline'), color: 'red', bold: true },
        { text: t(locale, 'power.game.low.body'), color: 'yellow' },
      ]),
      save,
    ];
  }

  return [];
}

// '2h 05m' — same shape as the auto-stop clock, kept local so this module stays
// independent from autostop.js.
export function formatOutage(durationMs) {
  const total = Math.max(0, Math.round(Number(durationMs) || 0));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / MIN);
  if (hours) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  const seconds = Math.floor((total % MIN) / 1000);
  return minutes ? `${minutes}m` : `${seconds}s`;
}
