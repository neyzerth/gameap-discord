import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import { serverStatus, rconFeatures, playerNames } from '../gameap.js';
import { statusEmbed } from '../embeds.js';
import { autocompleteServers, resolveServerOption } from '../control.js';
import { autoStopConfig } from '../config.js';
import { evaluateIdle } from '../autostop.js';
import { getState } from '../state.js';

export const data = new SlashCommandBuilder()
  .setName('status')
  .setDescription('Show one server in detail: state, players, RCON support')
  .setContexts(InteractionContextType.Guild)
  .addStringOption((option) =>
    option.setName('server').setDescription('Server id or alias').setRequired(true).setAutocomplete(true),
  );

export const autocomplete = autocompleteServers;

export const help = {
  examples: ['/status mc-survival', '/status 8'],
  notes:
    'One server in detail: state, player count, who is online and whether RCON works for that game. For the whole list use `/servers`.',
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
    embeds: [statusEmbed(serverId, status, players, features, autoStop)],
  });
}
