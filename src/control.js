// Shared logic for /start, /stop and /restart: permission gate, confirmation
// when players are online, task dispatch and progress follow-up.
//
// Los logs de este archivo siguen en inglés (son para el operador); lo que ve el
// jugador en Discord se resuelve con el idioma del guild.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import {
  startServer, stopServer, restartServer, serverStatus, isActive, playerNames,
} from './gameap.js';
import { canUseServer, knownServerIds, localeFor, resolveServer, serverMeta } from './config.js';
import { isOperator } from './permissions.js';
import { recordControl } from './state.js';
import { confirmEmbed, controlEmbed } from './embeds.js';
import { t } from './i18n/index.js';
import { log } from './logger.js';

const ACTIONS = {
  start: { id: 'start', run: startServer, confirm: false, target: 'online', phase: 'starting' },
  stop: { id: 'stop', run: stopServer, confirm: true, target: 'offline', phase: 'stopping' },
  restart: { id: 'restart', run: restartServer, confirm: true, target: 'restart', phase: 'restarting' },
};

const TIMEOUT_MS = 120_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The command name comes from the interaction, so `/rcon` can have its own roles
// (`commandRoles`) while everything else keeps the guild's `operatorRoleIds`.
export async function guardOperator(interaction, commandName = interaction?.commandName) {
  if (isOperator(interaction.member, commandName)) return true;
  await interaction.reply({
    content: t(localeFor(interaction.guildId), 'errors.notAllowed'),
    flags: MessageFlags.Ephemeral,
  });
  return false;
}

export async function resolveServerOption(interaction) {
  const locale = localeFor(interaction.guildId);
  const raw = interaction.options.getString('server');
  const serverId = resolveServer(raw);
  if (!serverId) {
    await interaction.reply({
      content: t(locale, 'errors.unknownServer', { server: raw }),
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }
  if (!canUseServer(interaction.guildId, serverId)) {
    await interaction.reply({
      content: t(locale, 'errors.serverNotAvailable'),
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

async function confirmWithPlayers(interaction, serverId, action, locale) {
  let players = [];
  try {
    players = await playerNames(serverId);
  } catch {
    players = []; // server probably stopped already: no confirmation needed
  }
  if (!players.length) return true;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('confirm')
      .setLabel(t(locale, `buttons.confirm.${action.id}`))
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('cancel')
      .setLabel(t(locale, 'buttons.cancel'))
      .setStyle(ButtonStyle.Secondary),
  );

  const message = await interaction.editReply({
    embeds: [confirmEmbed(locale, serverId, action.id, players)],
    components: [row],
  });

  const press = await message
    .awaitMessageComponent({ time: 60_000, filter: (i) => i.user.id === interaction.user.id })
    .catch(() => null);

  if (!press || press.customId !== 'confirm') {
    const cancelled = controlEmbed(locale, serverId, action.id, 'cancelled');
    if (press) await press.update({ embeds: [cancelled], components: [] });
    else await interaction.editReply({ embeds: [cancelled], components: [] });
    return false;
  }

  await press.deferUpdate();
  return true;
}

async function follow(interaction, serverId, action, taskId, locale) {
  const startedAt = Date.now();
  const deadline = startedAt + TIMEOUT_MS;
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
      .editReply({
        embeds: [controlEmbed(locale, serverId, action.id, action.phase, { taskId, note: `${elapsed}s` })],
      })
      .catch(() => {});
  }

  log.warn(`follow-up for server ${serverId} (${action.id}) hit the ${TIMEOUT_MS / 1000}s timeout`);
  return false;
}

export async function runControl(interaction, actionName) {
  const action = ACTIONS[actionName];
  if (!(await guardOperator(interaction))) return;

  const serverId = await resolveServerOption(interaction);
  if (!serverId) return;

  const locale = localeFor(interaction.guildId);

  // Marca el control manual: la gracia del auto-apagado cuenta desde aquí.
  recordControl(serverId, actionName);

  await interaction.deferReply();

  try {
    const current = await serverStatus(serverId).catch(() => null);
    if (action.target === 'online' && isActive(current)) {
      await interaction.editReply({
        embeds: [
          controlEmbed(locale, serverId, action.id, 'online', {
            note: t(locale, 'embeds.control.alreadyRunning'),
          }),
        ],
      });
      return;
    }
    if (action.target === 'offline' && current && !isActive(current)) {
      await interaction.editReply({
        embeds: [
          controlEmbed(locale, serverId, action.id, 'offline', {
            note: t(locale, 'embeds.control.alreadyStopped'),
          }),
        ],
      });
      return;
    }

    if (action.confirm && !(await confirmWithPlayers(interaction, serverId, action, locale))) return;

    const started = await action.run(serverId);
    const taskId = started?.task_id;
    log.info(`${action.id} requested for server ${serverId} (task ${taskId})`);

    await interaction.editReply({
      embeds: [controlEmbed(locale, serverId, action.id, action.phase, { taskId })],
      components: [],
    });

    const settled = await follow(interaction, serverId, action, taskId, locale);
    const final = await serverStatus(serverId).catch(() => null);
    const reachedTarget =
      action.target === 'offline' ? final && !isActive(final) : final && isActive(final);

    if (settled || reachedTarget) {
      await interaction.editReply({
        embeds: [
          controlEmbed(locale, serverId, action.id, action.target === 'offline' ? 'offline' : 'online', {
            taskId,
          }),
        ],
      });
    } else {
      await interaction.editReply({
        embeds: [
          controlEmbed(locale, serverId, action.id, action.phase, {
            taskId,
            note: t(locale, 'embeds.control.stillWorking'),
          }),
        ],
      });
    }
  } catch (err) {
    log.error(`${actionName} on server ${serverId} failed: ${err.status ?? ''} ${err.message}`);
    await interaction.editReply({
      embeds: [
        controlEmbed(locale, serverId, action.id, 'error', {
          note: `${err.status ?? ''} ${err.message}`.trim(),
        }),
      ],
    });
  }
}
