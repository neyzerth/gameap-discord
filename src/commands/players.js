import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import { serverStatus, rconFeatures, playerNames } from '../gameap.js';
import { playersEmbed } from '../embeds.js';
import { autocompleteServers, resolveServerOption } from '../control.js';
import { localeFor } from '../config.js';
import { t } from '../i18n/index.js';

export const data = new SlashCommandBuilder()
  .setName('players')
  .setDescription('List the players online right now (via RCON)')
  .setContexts(InteractionContextType.Guild)
  .addStringOption((option) =>
    option.setName('server').setDescription('Server id or alias').setRequired(true).setAutocomplete(true),
  );

export const autocomplete = autocompleteServers;

export const help = {
  examples: ['/players mc-survival', '/players 8'],
  notes:
    'If the server is stopped it answers "RCON unavailable: the server is stopped" instead of an error; same if the game cannot list players (like some modded setups).',
};

export async function execute(interaction) {
  const serverId = await resolveServerOption(interaction);
  if (!serverId) return;

  const locale = localeFor(interaction.guildId);

  await interaction.deferReply();

  const status = await serverStatus(serverId).catch(() => null);
  if (status && !status.processActive) {
    await interaction.editReply({
      embeds: [playersEmbed(locale, serverId, []).setDescription(t(locale, 'errors.rconStopped'))],
    });
    return;
  }

  const features = await rconFeatures(serverId).catch(() => null);
  if (features && features.playersList === false) {
    await interaction.editReply({
      embeds: [playersEmbed(locale, serverId, []).setDescription(t(locale, 'errors.rconUnsupported'))],
    });
    return;
  }

  try {
    const players = await playerNames(serverId);
    await interaction.editReply({ embeds: [playersEmbed(locale, serverId, players)] });
  } catch (err) {
    await interaction.editReply({
      embeds: [
        playersEmbed(locale, serverId, []).setDescription(
          t(locale, 'errors.rconError', { message: `${err.status ?? ''} ${err.message}`.trim() }),
        ),
      ],
    });
  }
}
