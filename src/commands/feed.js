import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import { loadFeeds, saveFeeds } from '../state.js';
import { setOverrides } from '../config.js';
import { autocompleteServers, guardOperator, resolveServerOption } from '../control.js';

export const data = new SlashCommandBuilder()
  .setName('feed')
  .setDescription('Subscribe or unsubscribe this channel to a server join/leave feed')
  .setContexts(InteractionContextType.Guild)
  .addStringOption((option) =>
    option.setName('server').setDescription('Server id or alias').setRequired(true).setAutocomplete(true),
  )
  .addStringOption((option) =>
    option
      .setName('state')
      .setDescription('Turn the feed on (this channel) or off')
      .setRequired(true)
      .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' }),
  );

export const autocomplete = autocompleteServers;

export const help = {
  examples: ['/feed ludopatia on', '/feed ludopatia off'],
  notes:
    'It applies to the channel where you run it, not to the whole server. New subscriptions start silent: the next message comes with the next real join or leave, not with the people already inside.',
};

export async function execute(interaction) {
  if (!(await guardOperator(interaction))) return;
  const serverId = await resolveServerOption(interaction);
  if (!serverId) return;

  const state = interaction.options.getString('state');
  const key = `${interaction.guildId}:${serverId}`;
  const feeds = loadFeeds();

  // Runtime override, so the versioned config file stays untouched.
  feeds[key] = state === 'on' ? { on: true, channelId: interaction.channelId } : { on: false };
  saveFeeds(feeds);
  setOverrides(feeds);

  await interaction.reply(
    state === 'on'
      ? `✅ Feed for <#${interaction.channelId}> enabled. The next join/leave will show up here.`
      : '🔕 Feed disabled for this server here.',
  );
}
