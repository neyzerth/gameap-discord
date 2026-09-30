import { rconFeatures, playerNames, serverStatus, stopServer } from './gameap.js';
import {
  pollTargets, feedTarget, autoStopConfig, setOverrides, setAutoStopOverrides, setLocaleOverrides,
} from './config.js';
import { getState, save, diff, loadFeeds, loadAutoStop, loadLocales } from './state.js';
import { announcePlayers, fanOut, autostopWarningEmbed, autoStopEmbed } from './embeds.js';
import { accumulateIdle, evaluateIdle, formatDuration, newIdle } from './autostop.js';
import { log } from './logger.js';

const INTERVAL = Number(process.env.POLL_INTERVAL_MS ?? 20000);
// Modo seguro para probar el auto-apagado: loguea y anuncia lo que haría, sin llamar al panel.
const AUTOSTOP_DRY_RUN = String(process.env.AUTOSTOP_DRY_RUN ?? 'false') === 'true';

async function fillPlayers(state, serverId, st) {
  const features = await rconFeatures(serverId);
  if (!features?.playersList) {
    if (st.unsupported !== true) {
      st.unsupported = true;
      log.info(`server ${serverId} does not support listing players; feed and auto-stop disabled for it`);
    }
    return null;
  }
  return playerNames(serverId);
}

export function startWatcher(client) {
  const state = getState();
  setOverrides(loadFeeds());
  setAutoStopOverrides(loadAutoStop());
  setLocaleOverrides(loadLocales());
  let busy = false;
  const lastPollAt = new Map(); // serverId -> ms del último intento (delta del reloj de inactividad)

  const tick = async () => {
    if (busy) return; // never overlap cycles when the panel is slow
    busy = true;
    try {
      for (const serverId of pollTargets()) {
        const st = (state.servers[serverId] ??= { players: [], initialized: false, unknown: false });
        if (st.unsupported) continue;

        const now = Date.now();
        const deltaMs = now - (lastPollAt.get(serverId) ?? now - INTERVAL);
        lastPollAt.set(serverId, now);

        let players = null;
        let ok = false;
        let active = null; // null = no se pudo saber; false = el panel dice que está apagado

        try {
          players = await fillPlayers(state, serverId, st);
          if (players === null) continue; // juego sin soporte para listar jugadores
          ok = true;
        } catch (err) {
          // Server off, RCON down or panel hiccup: never invent "left" events.
          st.unknown = true;
          const status = await serverStatus(serverId).catch(() => null);
          if (status?.processActive === false) {
            active = false;
            log.debug(`server ${serverId} is offline; skipping poll`);
          } else {
            log.warn(`server ${serverId}: no player data (${err.status ?? 'net'}) ${err.message}`);
          }
        }

        if (ok) {
          const changes = diff(st, players);
          const silent = changes.baseline || st.unknown;
          st.players = players;
          st.initialized = true;
          st.unknown = false;

          if (silent) {
            log.info(`baseline server ${serverId}: ${players.length} player(s)`);
          }

          for (const guild of client.guilds.cache.values()) {
            if (!feedTarget(guild.id, serverId)) continue;

            const key = `${guild.id}:${serverId}`;
            const feed = (state.feeds[key] ??= { initialized: false });
            // A newly subscribed channel starts silent: no "everybody joined" burst.
            if (silent || !feed.initialized) {
              feed.initialized = true;
              continue;
            }
            if (changes.joins.length || changes.leaves.length) {
              await announcePlayers(client, guild.id, serverId, changes, players.length);
            }
          }
        }

        // --- Reloj de inactividad (auto-apagado) ---
        st.idle = accumulateIdle(st.idle, { ok, players, active, deltaMs, nowMs: now });

        const cfg = autoStopConfig(serverId);
        if (!cfg) continue;

        const verdict = evaluateIdle(st.idle, cfg, {
          nowMs: now,
          lastControlMs: st.lastControlAt ?? null,
        });

        if (verdict.action === 'warn') {
          const minutesLeft = Math.max(1, Math.round(verdict.remainingMs / 60000));
          // El embed se construye por guild: cada Discord lo recibe en su idioma.
          const sent = await fanOut(client, serverId, (locale) =>
            autostopWarningEmbed(locale, serverId, verdict.idleMs, minutesLeft, cfg),
          );
          st.idle.warnedAt = now;
          log.info(
            `server ${serverId} idle ${formatDuration(verdict.idleMs)}: warned ${sent} channel(s), stopping in ${minutesLeft}m`,
          );
        } else if (verdict.action === 'stop') {
          const idleText = formatDuration(verdict.idleMs);
          if (AUTOSTOP_DRY_RUN) {
            log.warn(`[dry-run] would stop server ${serverId} (idle ${idleText})`);
            await fanOut(client, serverId, (locale) =>
              autoStopEmbed(locale, serverId, verdict.idleMs, { dryRun: true }),
            );
          } else {
            try {
              const started = await stopServer(serverId);
              log.info(`auto-stopped server ${serverId} after ${idleText} idle (task ${started?.task_id})`);
              await fanOut(client, serverId, (locale) => autoStopEmbed(locale, serverId, verdict.idleMs));
            } catch (err) {
              log.warn(`auto-stop of server ${serverId} failed: ${err.status ?? ''} ${err.message}`.trim());
            }
          }
          st.idle = { ...newIdle(), autoStoppedAt: now };
          st.lastAutoStop = { at: now, idleMs: verdict.idleMs };
        }
      }
      save(state);
    } catch (err) {
      log.error('watcher cycle failed:', err.message);
    } finally {
      busy = false;
    }
  };

  tick();
  return setInterval(tick, INTERVAL);
}
