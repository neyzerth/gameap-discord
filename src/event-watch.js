// Event loop: posts the one-shot messages listed in config/event.json.
//
// A timer of its own, not a step of the player watcher: it has to fire whether or
// not any player is online, and it must not wait behind a slow panel call.
//
// The whole module is inert unless config/event.json exists and is enabled.

import { eventConfig, eventConfigRaw } from './config.js';
import { dueEvents, pruneSent } from './events.js';
import { getState, save } from './state.js';
import { log } from './logger.js';

// A failed post is retried on the next ticks inside the grace window; after this
// many tries it is marked as sent so a broken channel does not spam the log
// every poll for hours.
const MAX_ATTEMPTS = 5;

const hours = (ms) => Math.round(ms / 3_600_000);

export function startEventWatch(client) {
  const cfg = eventConfig();
  if (!cfg) {
    if (eventConfigRaw()?.enabled) {
      log.warn('config/event.json is enabled but has no valid entries — event watch stays off');
    } else {
      log.debug('event watch disabled (no config/event.json, or enabled: false)');
    }
    return null;
  }

  for (const problem of cfg.problems) log.warn(`config/event.json: ${problem}`);
  const every = cfg.pollMs < 1000 ? `${cfg.pollMs}ms` : `${Math.round(cfg.pollMs / 1000)}s`;
  log.info(
    `event watch on: ${cfg.events.length} scheduled message(s) · grace ${hours(cfg.graceMs)}h · every ${every}`,
  );

  const attempts = new Map(); // sentKey -> tries, memory only

  const channelFor = async (channelId) => {
    const cached = client.channels.cache.get(channelId);
    if (cached) return cached;
    return client.channels.fetch(channelId).catch(() => null);
  };

  const markSent = (state, key) => {
    state.events ??= { sent: [] };
    state.events.sent ??= [];
    if (!state.events.sent.includes(key)) state.events.sent.push(key);
    attempts.delete(key);
  };

  let busy = false;

  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const state = getState();
      state.events ??= { sent: [] };
      state.events.sent = pruneSent(state.events.sent, Date.now());

      const { due, expired } = dueEvents(cfg, Date.now(), state.events.sent);
      let dirty = false;

      for (const item of expired) {
        log.warn(
          `event missed: ${new Date(item.event.atMs).toISOString()} -> ${item.channelId} ` +
            `(${hours(item.lateMs)}h late, past the ${hours(cfg.graceMs)}h grace window)`,
        );
        markSent(state, item.key);
        dirty = true;
      }

      for (const item of due) {
        const channel = await channelFor(item.channelId);
        if (!channel?.isTextBased?.()) {
          log.warn(`event: channel ${item.channelId} is not reachable or not text-based — skipped`);
          markSent(state, item.key);
          dirty = true;
          continue;
        }

        try {
          // No mentions at all: the content comes from a config file, and a stray
          // "@everyone" in it should never ping the whole server.
          await channel.send({ content: item.event.content, allowedMentions: { parse: [] } });
          markSent(state, item.key);
          dirty = true;
          log.info(`event sent: ${item.event.content.length} chars -> #${channel.name ?? item.channelId}`);
        } catch (err) {
          const tries = (attempts.get(item.key) ?? 0) + 1;
          attempts.set(item.key, tries);
          log.warn(`event: could not post to ${item.channelId} (try ${tries}/${MAX_ATTEMPTS}): ${err.message}`);
          if (tries >= MAX_ATTEMPTS) {
            markSent(state, item.key);
            dirty = true;
            log.error(`event: giving up on ${item.channelId} after ${tries} tries`);
          }
        }
      }

      if (dirty) save(state);
    } catch (err) {
      log.error('event watch cycle failed:', err.message);
    } finally {
      busy = false;
    }
  };

  tick();
  return setInterval(tick, cfg.pollMs);
}
