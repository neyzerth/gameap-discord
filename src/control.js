// Shared logic for /start, /stop and /restart: permission gate, confirmation
// when players are online, task dispatch and progress follow-up.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import {
  startServer, stopServer, restartServer, serverStatus, isActive, playerNames,
} from './gameap.js';
import { canUseServer, knownServerIds, resolveServer, serverMeta } from './config.js';
import { isOperator } from './permissions.js';
import { recordControl } from './state.js';
import { confirmEmbed, controlEmbed } from './embeds.js';
import { log } from './logger.js';

const ACTIONS = {
  start: { label: 'start', run: startServer, confirm: false, target: 'online' },
  stop: { label: 'stop', run: stopServer, confirm: true, target: 'offline' },
  restart: { label: 'restart', run: restartServer, confirm: true, target: 'restart' },
};

const TIMEOUT_MS = 120_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function guardOperator(interaction) {
  if (isOperator(interaction.member)) return true;
  await interaction.reply({
    content: 'You are not allowed to use this command.',
    flags: MessageFlags.Ephemeral,
  });
  return false;
}

export async function resolveServerOption(interaction) {
  const raw = interaction.options.getString('server');
  const serverId = resolveServer(raw);
  if (!serverId) {
    await interaction.reply({ content: `Unknown server: \`${raw}\``, flags: MessageFlags.Ephemeral });
    return null;
  }
  if (!canUseServer(interaction.guildId, serverId)) {
    await interaction.reply({
      content: 'That server is not available in this Discord server.',
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }
  return serverId;
}

export async function autocompleteServers(interaction) {
  const focused = interaction.options.getFocused().toLowerCase();
  const choices = knownServerIds()
    .filter((id) => canUseServer(interaction.guildId, id))
    .map((id) => {
      const meta = serverMeta(id);
      return { name: `${meta.label ?? id} — #${id}`, value: meta.alias ?? id };
    })
    .filter((c) => c.name.toLowerCase().includes(focused))
    .slice(0, 25);
  await interaction.respond(choices);
}

async function confirmWithPlayers(interaction, serverId, action) {
  let players = [];
  try {
    players = await playerNames(serverId);
  } catch {
    players = []; // server probably stopped already: no confirmation needed
  }
  if (!players.length) return true;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('confirm').setLabel(`Yes, ${action}`).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );

  const message = await interaction.editReply({
    embeds: [confirmEmbed(serverId, action, players)],
    components: [row],
  });

  const press = await message
    .awaitMessageComponent({ time: 60_000, filter: (i) => i.user.id === interaction.user.id })
    .catch(() => null);

  if (!press || press.customId !== 'confirm') {
    const cancelled = controlEmbed(serverId, action, 'Cancelled');
    if (press) await press.update({ embeds: [cancelled], components: [] });
    else await interaction.editReply({ embeds: [cancelled], components: [] });
    return false;
  }

  await press.deferUpdate();
  return true;
}

async function follow(interaction, serverId, action, taskId) {
  const startedAt = Date.now();
  const deadline = startedAt + TIMEOUT_MS;
  const pendingPhase = `${action.label}ing…`; // starting… / stopping… / restarting…
  let sawDown = false;

  while (Date.now() < deadline) {
    await sleep(4000);
    const status = await serverStatus(serverId).catch(() => null);
    if (!status) continue;
    const active = isActive(status);

    if (action.target === 'online' && active) return true;
    if (action.target === 'offline' && !active) return true;
    if (action.target === 'restart') {
      if (!active) sawDown = true;
      else if (sawDown) return true;
    }

    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    await interaction
      .editReply({ embeds: [controlEmbed(serverId, action.label, pendingPhase, { taskId, note: `${elapsed}s` })] })
      .catch(() => {});
  }

  log.warn(`follow-up for server ${serverId} (${action.label}) hit the ${TIMEOUT_MS / 1000}s timeout`);
  return false;
}

export async function runControl(interaction, actionName) {
  const action = ACTIONS[actionName];
  if (!(await guardOperator(interaction))) return;

  const serverId = await resolveServerOption(interaction);
  if (!serverId) return;

  // Marca el control manual: la gracia del auto-apagado cuenta desde aquí.
  recordControl(serverId, actionName);

  await interaction.deferReply();

  try {
    const current = await serverStatus(serverId).catch(() => null);
    if (action.target === 'online' && isActive(current)) {
      await interaction.editReply({
        embeds: [controlEmbed(serverId, action.label, 'online', { note: 'It was already running.' })],
      });
      return;
    }
    if (action.target === 'offline' && current && !isActive(current)) {
      await interaction.editReply({
        embeds: [controlEmbed(serverId, action.label, 'offline', { note: 'It was already stopped.' })],
      });
      return;
    }

    if (action.confirm && !(await confirmWithPlayers(interaction, serverId, action.label))) return;

    const started = await action.run(serverId);
    const taskId = started?.task_id;
    log.info(`${action.label} requested for server ${serverId} (task ${taskId})`);

    await interaction.editReply({
      embeds: [controlEmbed(serverId, action.label, `${action.label}ing…`, { taskId })],
      components: [],
    });

    const settled = await follow(interaction, serverId, action, taskId);
    const final = await serverStatus(serverId).catch(() => null);
    const reachedTarget =
      action.target === 'offline' ? final && !isActive(final) : final && isActive(final);

    if (settled || reachedTarget) {
      await interaction.editReply({
        embeds: [controlEmbed(serverId, action.label, action.target === 'offline' ? 'offline' : 'online', { taskId })],
      });
    } else {
      await interaction.editReply({
        embeds: [
          controlEmbed(serverId, action.label, `${action.label}ing…`, {
            taskId,
            note: 'Still working — open the GameAP panel to watch the console.',
          }),
        ],
      });
    }
  } catch (err) {
    log.error(`${actionName} on server ${serverId} failed: ${err.status ?? ''} ${err.message}`);
    await interaction.editReply({
      embeds: [
        controlEmbed(serverId, action.label, 'error', {
          note: `${err.status ?? ''} ${err.message}`.trim(),
        }),
      ],
    });
  }
}
