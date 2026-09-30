import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import { serverStatus, rconFeatures, playerNames } from '../gameap.js';
import { playersEmbed } from '../embeds.js';
import { autocompleteServers, resolveServerOption } from '../control.js';
import { localeFor } from '../config.js';
import { t } from '../i18n/index.js';
import { localizeCommand, localizeOption } from '../i18n/commands.js';

export const data = localizeCommand(
  new SlashCommandBuilder()
    .setName('players')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      localizeOption(
        option.setName('server').setRequired(true).setAutocomplete(true),
        'players',
        'server',
      ),
    ),
  'players',
);

export const autocomplete = autocompleteServers;

export const help = {
  examples: ['/players mc-survival', '/players 8'],
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
