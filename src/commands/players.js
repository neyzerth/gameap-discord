import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import { serverStatus, rconFeatures, playerNames } from '../gameap.js';
import { playersEmbed } from '../embeds.js';
import { autocompleteServers, resolveServerOption } from '../control.js';

export const data = new SlashCommandBuilder()
  .setName('players')
  .setDescription('List the players online right now (via RCON)')
  .setContexts(InteractionContextType.Guild)
  .addStringOption((option) =>
    option.setName('server').setDescription('Server id or alias').setRequired(true).setAutocomplete(true),
  );

export const autocomplete = autocompleteServers;

export const help = {
  examples: ['/players ludopatia', '/players 8'],
  notes:
    'If the server is stopped it answers "RCON unavailable: the server is stopped" instead of an error; same if the game cannot list players (like some modded setups).',
};

export async function execute(interaction) {
  const serverId = await resolveServerOption(interaction);
  if (!serverId) return;

  await interaction.deferReply();

  const status = await serverStatus(serverId).catch(() => null);
  if (status && !status.processActive) {
    await interaction.editReply({
      embeds: [playersEmbed(serverId, []).setDescription('RCON unavailable: the server is stopped.')],
    });
    return;
  }

  const features = await rconFeatures(serverId).catch(() => null);
  if (features && features.playersList === false) {
    await interaction.editReply({
      embeds: [playersEmbed(serverId, []).setDescription('This game does not support listing players over RCON.')],
    });
    return;
  }

  try {
    const players = await playerNames(serverId);
    await interaction.editReply({ embeds: [playersEmbed(serverId, players)] });
  } catch (err) {
    await interaction.editReply({
      embeds: [
        playersEmbed(serverId, []).setDescription(
          `RCON error: ${err.status ?? ''} ${err.message}`.trim(),
        ),
      ],
    });
  }
}
