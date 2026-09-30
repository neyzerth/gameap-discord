import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import { loadFeeds, saveFeeds } from '../state.js';
import { localeFor, setOverrides } from '../config.js';
import { autocompleteServers, guardOperator, resolveServerOption } from '../control.js';
import { t } from '../i18n/index.js';
import { localizeCommand, localizeOption } from '../i18n/commands.js';

export const data = localizeCommand(
  new SlashCommandBuilder()
    .setName('feed')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      localizeOption(
        option.setName('server').setRequired(true).setAutocomplete(true),
        'feed',
        'server',
      ),
    )
    .addStringOption((option) =>
      localizeOption(
        option
          .setName('state')
          .setRequired(true)
          .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' }),
        'feed',
        'state',
      ),
    ),
  'feed',
);

export const autocomplete = autocompleteServers;

export const help = {
  examples: ['/feed mc-survival on', '/feed mc-survival off'],
};

export async function execute(interaction) {
  if (!(await guardOperator(interaction))) return;
  const serverId = await resolveServerOption(interaction);
  if (!serverId) return;

  const locale = localeFor(interaction.guildId);
  const state = interaction.options.getString('state');
  const key = `${interaction.guildId}:${serverId}`;
  const feeds = loadFeeds();

  // Runtime override, so the versioned config file stays untouched.
  feeds[key] = state === 'on' ? { on: true, channelId: interaction.channelId } : { on: false };
  saveFeeds(feeds);
  setOverrides(feeds);

  await interaction.reply(
    state === 'on'
      ? t(locale, 'feed.enabled', { channel: interaction.channelId })
      : t(locale, 'feed.disabled'),
  );
}
