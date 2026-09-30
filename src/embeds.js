import { EmbedBuilder } from 'discord.js';
import { feedTarget, localeFor, serverMeta } from './config.js';
import { t, plural } from './i18n/index.js';
import { formatDuration } from './autostop.js';
import { log } from './logger.js';

const COLOR = { online: 0x57f287, offline: 0x99aab5, warn: 0xfee75c, error: 0xed4245, info: 0x5865f2 };

// Todos los embeds reciben el locale del guild como primer argumento: el mismo
// aviso se envía a varios Discord y cada uno lo lee en su idioma.

export function title(serverId) {
  const meta = serverMeta(serverId);
  return `${meta.emoji ?? '🎮'} ${meta.label ?? `Server #${serverId}`}`;
}

export function stateEmoji(server) {
  return server?.online || server?.process_active ? '🟢' : '⚪';
}

export function serversEmbed(locale, servers) {
  const lines = servers.map((s) =>
    t(locale, 'embeds.servers.line', {
      emoji: stateEmoji(s),
      label: serverMeta(s.id).label ?? s.name,
      id: s.id,
      game: s.game_id,
      ip: s.server_ip,
      port: s.server_port,
    }),
  );
  return new EmbedBuilder()
    .setColor(COLOR.info)
    .setTitle(t(locale, 'embeds.servers.title'))
    .setDescription(lines.join('\n') || t(locale, 'embeds.servers.empty'))
    .setTimestamp();
}

export function statusEmbed(locale, serverId, status, players, features, autoStop = null) {
  const active = status?.processActive === true;
  const embed = new EmbedBuilder()
    .setColor(active ? COLOR.online : COLOR.offline)
    .setTitle(title(serverId))
    .addFields(
      {
        name: t(locale, 'embeds.status.state'),
        value: t(locale, active ? 'embeds.status.running' : 'embeds.status.stopped'),
        inline: true,
      },
      {
        name: t(locale, 'embeds.status.players'),
        value: players ? String(players.length) : '—',
        inline: true,
      },
    )
    .setTimestamp();

  if (autoStop) {
    embed.addFields({
      name: t(locale, 'embeds.status.autoStop'),
      value: autoStopValue(locale, autoStop),
      inline: true,
    });
  }

  if (players?.length) {
    embed.addFields({
      name: t(locale, 'embeds.status.onlineNow'),
      value: players.map((p) => `\`${p}\``).join(', ').slice(0, 1024),
    });
  }
  if (features && features.rcon === false) {
    embed.setFooter({ text: t(locale, 'embeds.status.noRcon') });
  }
  return embed;
}

const PHASES = {
  starting: { color: COLOR.warn, key: 'embeds.control.starting' },
  stopping: { color: COLOR.warn, key: 'embeds.control.stopping' },
  restarting: { color: COLOR.warn, key: 'embeds.control.restarting' },
  online: { color: COLOR.online, key: 'embeds.control.online' },
  offline: { color: COLOR.offline, key: 'embeds.control.offline' },
  error: { color: COLOR.error, key: 'embeds.control.error' },
  cancelled: { color: COLOR.info, key: 'embeds.control.cancelled' },
};

export function controlEmbed(locale, serverId, actionId, phase, extra = {}) {
  const state = PHASES[phase] ?? { color: COLOR.info, key: `embeds.control.${phase}` };
  const embed = new EmbedBuilder()
    .setColor(state.color)
    .setTitle(t(locale, 'embeds.control.title', { title: title(serverId), action: t(locale, `actions.${actionId}`) }))
    .setDescription(t(locale, state.key))
    .setTimestamp();

  if (extra.taskId) embed.setFooter({ text: t(locale, 'embeds.control.task', { taskId: extra.taskId }) });
  if (extra.note) {
    embed.addFields({ name: t(locale, 'embeds.control.note'), value: String(extra.note).slice(0, 1024) });
  }
  return embed;
}

export function confirmEmbed(locale, serverId, actionId, players) {
  return new EmbedBuilder()
    .setColor(COLOR.warn)
    .setTitle(t(locale, 'embeds.confirm.title', { title: title(serverId), action: t(locale, `actions.${actionId}`) }))
    .setDescription(
      `${plural(locale, 'embeds.confirm.players', players.length, { count: players.length })}\n` +
        `${players.map((p) => `\`${p}\``).join(', ').slice(0, 900)}`,
    )
    .setFooter({ text: t(locale, 'embeds.confirm.footer') });
}

export function playersEmbed(locale, serverId, players) {
  const embed = new EmbedBuilder()
    .setColor(players.length ? COLOR.online : COLOR.offline)
    .setTitle(t(locale, 'embeds.players.title', { title: title(serverId) }))
    .setTimestamp();

  if (!players.length) {
    embed.setDescription(t(locale, 'embeds.players.none'));
  } else {
    embed.setDescription(players.map((p) => `• ${p}`).join('\n').slice(0, 4000));
  }
  return embed;
}

// --- Auto-apagado por inactividad -------------------------------------------------

// "⏳ 2h · 41m idle" / "2h · idle clock at 0" / "off"
function autoStopValue(locale, autoStop) {
  if (!autoStop || !autoStop.hours) return t(locale, 'embeds.autostop.off');
  if (autoStop.idleMs > 0) {
    return t(locale, 'embeds.autostop.clockIdle', {
      hours: autoStop.hours,
      idle: formatDuration(autoStop.idleMs),
    });
  }
  return t(locale, 'embeds.autostop.clockZero', { hours: autoStop.hours });
}

export function autostopWarningEmbed(locale, serverId, idleMs, minutesLeft, cfg) {
  const alias = serverMeta(serverId).alias ?? serverId;
  return new EmbedBuilder()
    .setColor(COLOR.warn)
    .setAuthor({ name: title(serverId) })
    .setDescription(
      t(locale, 'embeds.autostop.warning', {
        idle: formatDuration(idleMs),
        minutes: minutesLeft,
      }),
    )
    .setFooter({
      text: t(locale, 'embeds.autostop.warningFooter', { hours: cfg.hours, alias }),
    })
    .setTimestamp();
}

export function autoStopEmbed(locale, serverId, idleMs, { dryRun = false } = {}) {
  const alias = serverMeta(serverId).alias ?? serverId;
  return new EmbedBuilder()
    .setColor(COLOR.offline)
    .setAuthor({ name: title(serverId) })
    .setDescription(t(locale, 'embeds.autostop.stopped', { idle: formatDuration(idleMs) }))
    .setFooter({
      text: dryRun
        ? t(locale, 'embeds.autostop.dryRunFooter')
        : t(locale, 'embeds.autostop.startAgainFooter', { alias }),
    })
    .setTimestamp();
}

// Embed de estado del comando /autostop (público).
export function autostopStatusEmbed(locale, serverId, cfg, { idleMs = 0, minutesLeft = null, guildId = null } = {}) {
  const alias = serverMeta(serverId).alias ?? serverId;
  const embed = new EmbedBuilder()
    .setColor(cfg ? COLOR.info : COLOR.offline)
    .setTitle(t(locale, 'embeds.autostop.title', { title: title(serverId) }))
    .setTimestamp();

  if (!cfg) {
    embed
      .setDescription(t(locale, 'embeds.autostop.disabled'))
      .addFields({
        name: t(locale, 'embeds.autostop.enableField'),
        value: t(locale, 'embeds.autostop.enableExample', { alias }),
      });
    return embed;
  }

  embed.setDescription(
    cfg.warnMinutes > 0
      ? t(locale, 'embeds.autostop.summaryWarn', { hours: cfg.hours, warn: cfg.warnMinutes })
      : t(locale, 'embeds.autostop.summaryNoWarn', { hours: cfg.hours }),
  );
  embed.addFields(
    {
      name: t(locale, 'embeds.autostop.settingFrom'),
      value: cfg.source === 'override' ? t(locale, 'embeds.autostop.settingOverride') : '`config/servers.json`',
      inline: true,
    },
    {
      name: t(locale, 'embeds.autostop.idleNow'),
      value: idleMs > 0 ? formatDuration(idleMs) : '—',
      inline: true,
    },
    {
      name: t(locale, 'embeds.autostop.stopsIn'),
      value: minutesLeft == null ? '—' : formatDuration(minutesLeft),
      inline: true,
    },
  );

  if (guildId !== null) {
    const target = feedTarget(guildId, serverId);
    embed.addFields({
      name: t(locale, 'embeds.autostop.notifiedIn'),
      value: target ? `<#${target}>` : t(locale, 'embeds.autostop.noChannel'),
    });
  }

  embed.setFooter({ text: t(locale, 'embeds.autostop.disableFooter', { alias }) });
  return embed;
}

// Envía un embed a todos los canales suscritos a ese servidor (fan-out por guild).
// `buildEmbed(locale, guildId)` se llama por guild: cada Discord recibe el mismo
// aviso en su propio idioma, nunca el de la config del primero de la lista.
export async function fanOut(client, serverId, buildEmbed) {
  let sent = 0;
  for (const guild of client.guilds.cache.values()) {
    const channelId = feedTarget(guild.id, serverId);
    if (!channelId) continue;
    const locale = localeFor(guild.id);
    if (await sendToChannel(client, channelId, buildEmbed(locale, guild.id))) sent += 1;
  }
  return sent;
}

async function sendToChannel(client, channelId, embed) {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased()) {
      log.warn(`feed channel ${channelId} is not text based`);
      return false;
    }
    await channel.send({ embeds: [embed] });
    return true;
  } catch (err) {
    log.warn(`could not announce to ${channelId}: ${err.message}`);
    return false;
  }
}

// Un anuncio por guild suscrita, en el idioma de ese guild.
export async function announcePlayers(client, guildId, serverId, changes, total) {
  const channelId = feedTarget(guildId, serverId);
  if (!channelId) return false;

  const locale = localeFor(guildId);
  const lines = [];
  if (changes.joins.length) {
    lines.push(t(locale, 'embeds.feed.joined', { players: changes.joins.join(', ') }));
  }
  if (changes.leaves.length) {
    lines.push(t(locale, 'embeds.feed.left', { players: changes.leaves.join(', ') }));
  }

  const embed = new EmbedBuilder()
    .setColor(changes.joins.length && !changes.leaves.length ? COLOR.online : COLOR.warn)
    .setAuthor({ name: title(serverId) })
    .setDescription(lines.join('\n').slice(0, 4000))
    .setFooter({ text: t(locale, 'embeds.feed.onlineNow', { count: total }) })
    .setTimestamp();

  return sendToChannel(client, channelId, embed);
}
