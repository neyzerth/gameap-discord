// Power-outage loop: reads NUT (upsd at 127.0.0.1:3493 by default) and turns a
// mains change into announcements.
//
// It is a timer of its own, not a step of the player watcher, on purpose: the
// watcher cycle can spend seconds talking to the panel, and the low-battery
// window is short (the host shuts down a couple of minutes after LB).
//
// The whole module is inert unless config/power.json exists and is enabled.

import { readUpsVars } from './nut.js';
import { decidePower, formatOutage, parseUpsStatus, rconPipeline } from './power.js';
import { localeFor, powerChannel, powerConfig, powerConfigRaw, serverMeta } from './config.js';
import { getState, save } from './state.js';
import { isActive, rconCommand, serverStatus, stopServer } from './gameap.js';
import { announcePower, powerLowEmbed, powerOutageEmbed, powerRestoredEmbed } from './embeds.js';
import { t } from './i18n/index.js';
import { log } from './logger.js';

const NUT_VARS = ['ups.status', 'battery.charge', 'battery.runtime'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

export function startPowerWatch(client) {
  const cfg = powerConfig();
  if (!cfg) {
    if (powerConfigRaw()?.enabled) {
      log.warn('config/power.json is enabled but incomplete (it needs nut.ups and servers) — power watch stays off');
    } else {
      log.debug('power watch disabled (no config/power.json, or enabled: false)');
    }
    return null;
  }

  log.info(
    `power watch on: ${cfg.nut.ups}@${cfg.nut.host}:${cfg.nut.port} every ${cfg.pollMs}ms · ` +
      `servers ${cfg.servers.join(', ')}${cfg.dryRun ? ' · DRY RUN' : ''}`,
  );

  const state = getState();
  let busy = false;

  // Where this server's notices go, per guild: the mapping in config/power.json
  // or that guild's feed channel. A guild that cannot use the server gets none.
  const targetsFor = (serverId) =>
    [...client.guilds.cache.values()]
      .map((guild) => ({ channelId: powerChannel(guild.id, serverId), locale: localeFor(guild.id) }))
      .filter((target) => target.channelId);

  const activeServers = async () => {
    const active = [];
    for (const id of cfg.servers) {
      const status = await serverStatus(id).catch(() => null);
      if (isActive(status)) active.push(id);
    }
    return active;
  };

  const sendRcon = async (serverId, stage, locale) => {
    const lines = rconPipeline(locale, stage);
    if (cfg.dryRun) {
      log.warn(`[dry-run] server ${serverId} would get: ${lines.join(' | ')}`);
      return;
    }
    for (const line of lines) {
      try {
        await rconCommand(serverId, line);
      } catch (err) {
        // One failed line must not swallow the rest: the last line is the save.
        log.warn(`power ${stage}: RCON on server ${serverId} failed (${err.status ?? 'net'} ${err.message})`);
      }
    }
    log.info(`power ${stage}: in-game warning sent to server ${serverId}`);
  };

  const stopServers = async (active) => {
    const stopped = [];
    for (const id of active) {
      if (cfg.dryRun) {
        log.warn(`[dry-run] would stop server ${id}`);
        continue;
      }
      try {
        const task = await stopServer(id);
        stopped.push(id);
        log.info(`power low: stop sent to server ${id} (task ${task?.task_id})`);
      } catch (err) {
        log.warn(`power low: could not stop server ${id}: ${err.message}`);
      }
    }
    return stopped;
  };

  const runAction = async (action, { durationMs, stoppedIdle }) => {
    if (action === 'restored') {
      for (const id of cfg.servers) {
        for (const target of targetsFor(id)) {
          const embed = powerRestoredEmbed(target.locale, {
            duration: formatOutage(durationMs),
            alias: serverMeta(id).alias ?? id,
            stopped: stoppedIdle,
          });
          if (cfg.dryRun) embed.setFooter({ text: t(target.locale, 'power.dryRun') });
          await announcePower(client, target.channelId, embed);
        }
      }
      return;
    }

    const active = await activeServers();
    for (const id of active) {
      const locale = targetsFor(id)[0]?.locale ?? localeFor(null);
      await sendRcon(id, action, locale);
    }

    for (const id of cfg.servers) {
      for (const target of targetsFor(id)) {
        const embed =
          action === 'low'
            ? powerLowEmbed(target.locale, { label: serverMeta(id).label ?? `#${id}` })
            : powerOutageEmbed(target.locale, {
                label: serverMeta(id).label ?? `#${id}`,
                charge: state.power.charge ?? null,
                runtime: state.power.runtime ?? null,
              });
        if (cfg.dryRun) embed.setFooter({ text: t(target.locale, 'power.dryRun') });
        await announcePower(client, target.channelId, embed, {
          mention: action === 'low' && cfg.notifyEveryoneOnLowBattery ? cfg.lowBatteryMention : null,
        });
      }
    }

    if (action === 'low' && cfg.stopServersOnLowBattery) {
      // A beat so the players can read the warning before the server goes down.
      await sleep(cfg.stopDelayMs);
      const stopped = await stopServers(active);
      if (stopped.length) state.power.stoppedAt = Date.now();
    }
  };

  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const read = await readUpsVars(NUT_VARS, {
        ups: cfg.nut.ups,
        host: cfg.nut.host,
        port: cfg.nut.port,
        timeoutMs: cfg.nut.timeoutMs,
      });

      // A failed read is not an outage: report it and change nothing.
      if (!read.ok) {
        log.debug(`power watch: NUT read failed (${read.error})`);
        return;
      }

      const status = parseUpsStatus(read.vars['ups.status']);
      const previous = state.power ?? null;
      const { actions, state: next, durationMs, stopped } = decidePower(previous, status, Date.now());

      next.charge = read.vars['battery.charge'] ?? null;
      next.runtime = read.vars['battery.runtime'] ? formatOutage(Number(read.vars['battery.runtime']) * 1000) : null;

      const changed = JSON.stringify(next) !== JSON.stringify(previous);
      state.power = next;
      if (!actions.length) {
        if (changed) save(state);
        return;
      }

      log.info(`power: ${status} -> ${actions.join(', ')}`);
      for (const action of actions) await runAction(action, { durationMs, stoppedIdle: stopped });
      save(state);
    } catch (err) {
      log.error('power watch cycle failed:', err.message);
    } finally {
      busy = false;
    }
  };

  tick();
  return setInterval(tick, cfg.pollMs);
}
