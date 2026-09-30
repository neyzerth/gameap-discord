import { EmbedBuilder } from 'discord.js';
import { feedTarget, serverMeta } from './config.js';
import { formatDuration } from './autostop.js';
import { log } from './logger.js';

const COLOR = { online: 0x57f287, offline: 0x99aab5, warn: 0xfee75c, error: 0xed4245, info: 0x5865f2 };

export function title(serverId) {
  const meta = serverMeta(serverId);
  return `${meta.emoji ?? '🎮'} ${meta.label ?? `Server #${serverId}`}`;
}

export function stateEmoji(server) {
  return server?.online || server?.process_active ? '🟢' : '⚪';
}

export function serversEmbed(servers) {
  const lines = servers.map(
    (s) =>
      `${stateEmoji(s)} **${serverMeta(s.id).label ?? s.name}** \`#${s.id}\` — ${s.game_id} · ${s.server_ip}:${s.server_port}`,
  );
  return new EmbedBuilder()
    .setColor(COLOR.info)
    .setTitle('Game servers')
    .setDescription(lines.join('\n') || 'No servers available.')
    .setTimestamp();
}

export function statusEmbed(serverId, status, players, features, autoStop = null) {
  const active = status?.processActive === true;
  const embed = new EmbedBuilder()
    .setColor(active ? COLOR.online : COLOR.offline)
    .setTitle(title(serverId))
    .addFields(
      { name: 'State', value: active ? '🟢 running' : '⚪ stopped', inline: true },
      { name: 'Players', value: players ? String(players.length) : '—', inline: true },
    )
    .setTimestamp();

  if (autoStop) {
    embed.addFields({
      name: 'Auto-stop',
      value: autoStopValue(autoStop),
      inline: true,
    });
  }

  if (players?.length) {
    embed.addFields({ name: 'Online now', value: players.map((p) => `\`${p}\``).join(', ').slice(0, 1024) });
  }
  if (features && features.rcon === false) {
    embed.setFooter({ text: 'RCON is not configured for this server' });
  }
  return embed;
}

export function controlEmbed(serverId, action, phase, extra = {}) {
  const map = {
    starting: { color: COLOR.warn, text: 'Starting…' },
    stopping: { color: COLOR.warn, text: 'Stopping…' },
    restarting: { color: COLOR.warn, text: 'Restarting…' },
    online: { color: COLOR.online, text: '🟢 Online' },
    offline: { color: COLOR.offline, text: '⚪ Stopped' },
    error: { color: COLOR.error, text: '⚠️ Failed' },
  };
  const state = map[phase] ?? { color: COLOR.info, text: phase };
  const embed = new EmbedBuilder()
    .setColor(state.color)
    .setTitle(`${title(serverId)} — ${action}`)
    .setDescription(state.text)
    .setTimestamp();

  if (extra.taskId) embed.setFooter({ text: `Daemon task #${extra.taskId}` });
  if (extra.note) embed.addFields({ name: 'Note', value: String(extra.note).slice(0, 1024) });
  return embed;
}

export function confirmEmbed(serverId, action, players) {
  return new EmbedBuilder()
    .setColor(COLOR.warn)
    .setTitle(`${title(serverId)} — confirm ${action}`)
    .setDescription(
      `**${players.length}** player(s) are online:\n${players.map((p) => `\`${p}\``).join(', ').slice(0, 900)}`,
    )
    .setFooter({ text: 'This will affect them. Confirm within 60s.' });
}

export function playersEmbed(serverId, players) {
  const embed = new EmbedBuilder()
    .setColor(players.length ? COLOR.online : COLOR.offline)
    .setTitle(`${title(serverId)} — players`)
    .setTimestamp();

  if (!players.length) {
    embed.setDescription('No players online.');
  } else {
    embed.setDescription(players.map((p) => `• ${p}`).join('\n').slice(0, 4000));
  }
  return embed;
}

// --- Auto-apagado por inactividad -------------------------------------------------

// "2h · 41m left" / "2h · stopping now" / "off"
function autoStopValue(autoStop) {
  if (!autoStop || !autoStop.hours) return 'off';
  if (autoStop.idleMs > 0) {
    return `⏳ ${autoStop.hours}h · ${formatDuration(autoStop.idleMs)} idle`;
  }
  return `${autoStop.hours}h · idle clock at 0`;
}

export function autostopWarningEmbed(serverId, idleMs, minutesLeft, cfg) {
  const alias = serverMeta(serverId).alias ?? serverId;
  return new EmbedBuilder()
    .setColor(COLOR.warn)
    .setAuthor({ name: title(serverId) })
    .setDescription(
      `⏳ No players for **${formatDuration(idleMs)}** — stopping in **${minutesLeft}m** unless someone joins.`,
    )
    .setFooter({ text: `Auto-stop after ${cfg.hours}h idle · /autostop ${alias} hours:0 to disable` })
    .setTimestamp();
}

export function autoStopEmbed(serverId, idleMs, { dryRun = false } = {}) {
  const alias = serverMeta(serverId).alias ?? serverId;
  return new EmbedBuilder()
    .setColor(COLOR.offline)
    .setAuthor({ name: title(serverId) })
    .setDescription(`😴 Stopped after **${formatDuration(idleMs)}** with no players.`)
    .setFooter({ text: dryRun ? 'DRY RUN — nothing was stopped' : `Start it again with /start ${alias}` })
    .setTimestamp();
}

// Embed de estado del comando /autostop (público).
export function autostopStatusEmbed(serverId, cfg, { idleMs = 0, minutesLeft = null, guildId = null } = {}) {
  const alias = serverMeta(serverId).alias ?? serverId;
  const embed = new EmbedBuilder()
    .setColor(cfg ? COLOR.info : COLOR.offline)
    .setTitle(`${title(serverId)} — auto-stop`)
    .setTimestamp();

  if (!cfg) {
    embed
      .setDescription('**Disabled.** This server will not stop by itself.')
      .addFields({ name: 'Enable it', value: `\`/autostop ${alias} hours:2\`` });
    return embed;
  }

  embed.setDescription(
    `Stops the server after **${cfg.hours}h** with no players` +
      (cfg.warnMinutes > 0 ? `, with a warning **${cfg.warnMinutes}m** before.` : ', with no warning message.'),
  );
  embed.addFields(
    { name: 'Setting from', value: cfg.source === 'override' ? '`/autostop` (Discord)' : '`config/servers.json`', inline: true },
    { name: 'Idle now', value: idleMs > 0 ? formatDuration(idleMs) : '—', inline: true },
    { name: 'Stops in', value: minutesLeft == null ? '—' : formatDuration(minutesLeft), inline: true },
  );

  if (guildId !== null) {
    const target = feedTarget(guildId, serverId);
    embed.addFields({
      name: 'Notified in this Discord',
      value: target ? `<#${target}>` : 'no channel subscribed here — use `/feed` to add one',
    });
  }

  embed.setFooter({ text: `Disable with /autostop ${alias} hours:0` });
  return embed;
}

// Envía un embed a todos los canales suscritos a ese servidor (fan-out por guild).
export async function fanOut(client, serverId, embed) {
  let sent = 0;
  for (const guild of client.guilds.cache.values()) {
    const channelId = feedTarget(guild.id, serverId);
    if (!channelId) continue;
    if (await sendToChannel(client, channelId, embed)) sent += 1;
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

// Fan-out: one announcement per subscribed guild/channel.
export async function announcePlayers(client, guildId, serverId, changes, total) {
  const channelId = feedTarget(guildId, serverId);
  if (!channelId) return false;

  const lines = [];
  if (changes.joins.length) lines.push(`🟢 **joined:** ${changes.joins.join(', ')}`);
  if (changes.leaves.length) lines.push(`🔴 **left:** ${changes.leaves.join(', ')}`);

  const embed = new EmbedBuilder()
    .setColor(changes.joins.length && !changes.leaves.length ? COLOR.online : COLOR.warn)
    .setAuthor({ name: title(serverId) })
    .setDescription(lines.join('\n').slice(0, 4000))
    .setFooter({ text: `Online now: ${total}` })
    .setTimestamp();

  return sendToChannel(client, channelId, embed);
}
