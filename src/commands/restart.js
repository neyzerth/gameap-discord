import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import { autocompleteServers, runControl } from '../control.js';
import { localizeCommand, localizeOption } from '../i18n/commands.js';

export const data = localizeCommand(
  new SlashCommandBuilder()
    .setName('restart')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      localizeOption(
        option.setName('server').setRequired(true).setAutocomplete(true),
        'restart',
        'server',
      ),
    ),
  'restart',
);

export const autocomplete = autocompleteServers;

export const help = {
  examples: ['/restart mc-survival', '/restart 8'],
};

export async function execute(interaction) {
  await runControl(interaction, 'restart');
}
