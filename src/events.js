// One-shot scheduled messages: what to post, where, and whether it is due yet.
//
// Pure decisions only — no Discord, no timers, no files. The loop that actually
// posts lives in event-watch.js, and `config/event.json` is read by config.js.
//
// Optional feature: with no `config/event.json` (or `enabled: false`) the loop
// never starts and the bot behaves exactly as before.
//
// Why a scheduler at all: some things the bot says on purpose are not a reaction
// to anything (an event starting, a date, a tease). A one-shot list with an
// idempotent mark in `data/state.json` means a restart does not repeat it and a
// late start does not lose it.

const MINUTE = 60_000;

export const DEFAULT_POLL_MS = 30_000;
export const DEFAULT_GRACE_HOURS = 12;
export const MAX_CONTENT = 2000; // Discord's message limit

// Timestamps come from JSON as strings. An ISO string with offset
// (`2026-10-23T20:00:00-07:00`) is unambiguous; without offset, JavaScript reads
// it as the container's local time, which is why the docs ask for the offset.
export function parseAt(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value);
  if (typeof value !== 'string' || !value.trim()) return null;
  const ms = Date.parse(value.trim());
  return Number.isNaN(ms) ? null : new Date(ms);
}

// `key` identifies the message (time + text); the sent mark is per channel, so
// one event can post the same text in several channels and only the channels
// that already got it are skipped.
export function eventKey(event) {
  return `${event.at.toISOString()}|${event.content}`;
}

export function sentKey(event, channelId) {
  return `${eventKey(event)}|${channelId}`;
}

function channelList(raw) {
  const list = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const ids = list.map((id) => String(id ?? '').trim()).filter(Boolean);
  return [...new Set(ids)];
}

// Returns null when the feature is off; otherwise the normalized config plus the
// problems found. Invalid entries are dropped (and reported), never fatal: a typo
// in the schedule must not keep the bot from starting.
export function normalizeEventConfig(raw) {
  if (!raw || typeof raw !== 'object' || raw.enabled !== true) return null;

  const problems = [];
  const pollMs = Number(raw.pollMs) > 0 ? Number(raw.pollMs) : DEFAULT_POLL_MS;
  const graceHours = Number(raw.graceHours) >= 0 ? Number(raw.graceHours) : DEFAULT_GRACE_HOURS;

  const items = Array.isArray(raw.events) ? raw.events : [];
  if (!Array.isArray(raw.events)) problems.push('"events" must be an array');

  const events = [];
  items.forEach((item, index) => {
    const where = `events[${index}]`;
    if (!item || typeof item !== 'object') {
      problems.push(`${where}: not an object`);
      return;
    }
    const at = parseAt(item.at);
    if (!at) {
      problems.push(`${where}.at: not a valid date ("${item.at}")`);
      return;
    }
    const channels = channelList(item.channels);
    if (!channels.length) {
      problems.push(`${where}.channels: needs at least one channel id`);
      return;
    }
    const content = typeof item.content === 'string' ? item.content : '';
    if (!content.trim()) {
      problems.push(`${where}.content: empty`);
      return;
    }
    if (content.length > MAX_CONTENT) {
      problems.push(`${where}.content: ${content.length} chars, over Discord's ${MAX_CONTENT}`);
      return;
    }
    events.push({ at, atMs: at.getTime(), content, channels, key: eventKey({ at, content }) });
  });

  if (!events.length) return null;

  events.sort((a, b) => a.atMs - b.atMs);
  return { enabled: true, pollMs, graceMs: graceHours * 60 * MINUTE, events, problems };
}

// What to send right now: entries whose time has come and that are still inside
// the grace window. Anything older than the window is reported as expired and
// marked, so a machine that was off for days does not dump a pile of stale
// messages when it comes back.
export function dueEvents(cfg, nowMs, sent = []) {
  const done = new Set(sent);
  const due = [];
  const expired = [];

  for (const event of cfg.events) {
    for (const channelId of event.channels) {
      const key = sentKey(event, channelId);
      if (done.has(key)) continue;
      if (nowMs < event.atMs) continue;
      if (nowMs - event.atMs > cfg.graceMs) expired.push({ event, channelId, key, lateMs: nowMs - event.atMs });
      else due.push({ event, channelId, key });
    }
  }

  due.sort((a, b) => a.event.atMs - b.event.atMs);
  return { due, expired };
}

// The sent list would grow forever otherwise: keys carry the ISO timestamp, so
// anything older than `keepMs` is safe to drop (the events are one-shot).
export function pruneSent(sent, nowMs, keepMs = 60 * 24 * 60 * MINUTE) {
  const list = Array.isArray(sent) ? sent : [];
  return list.filter((key) => {
    const at = parseAt(String(key).split('|')[0]);
    return at ? nowMs - at.getTime() <= keepMs : true;
  });
}
