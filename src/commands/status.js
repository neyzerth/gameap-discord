import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import { serverStatus, rconFeatures, playerNames } from '../gameap.js';
import { statusEmbed } from '../embeds.js';
import { autocompleteServers, resolveServerOption } from '../control.js';
import { autoStopConfig, localeFor } from '../config.js';
import { evaluateIdle } from '../autostop.js';
import { getState } from '../state.js';
import { localizeCommand, localizeOption } from '../i18n/commands.js';

export const data = localizeCommand(
  new SlashCommandBuilder()
    .setName('status')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      localizeOption(
        option.setName('server').setRequired(true).setAutocomplete(true),
        'status',
        'server',
      ),
    ),
  'status',
);

export const autocomplete = autocompleteServers;

export const help = {
  examples: ['/status mc-survival', '/status 8'],
};

export async function execute(interaction) {
  const serverId = await resolveServerOption(interaction);
  if (!serverId) return;

  await interaction.deferReply();

  const status = await serverStatus(serverId).catch(() => null);
  const features = await rconFeatures(serverId).catch(() => null);
  let players = null;
  if (status?.processActive && features?.playersList) {
    players = await playerNames(serverId).catch(() => null);
  }

  const autoStopCfg = autoStopConfig(serverId);
  const autoStop = autoStopCfg
    ? { hours: autoStopCfg.hours, idleMs: evaluateIdle(getState().servers[String(serverId)]?.idle, autoStopCfg, { nowMs: Date.now() }).idleMs }
    : { hours: 0, idleMs: 0 };

  await interaction.editReply({
    embeds: [statusEmbed(localeFor(interaction.guildId), serverId, status, players, features, autoStop)],
  });
}
