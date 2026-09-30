import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import { autocompleteServers, runControl } from '../control.js';

export const data = new SlashCommandBuilder()
  .setName('start')
  .setDescription('Start a game server')
  .setContexts(InteractionContextType.Guild)
  .addStringOption((option) =>
    option.setName('server').setDescription('Server id or alias').setRequired(true).setAutocomplete(true),
  );

export const autocomplete = autocompleteServers;

export const help = {
  examples: ['/start mc-survival', '/start 8'],
  notes:
    'Shows a progress embed until the panel reports the server as running. A big modded Minecraft server takes 1-2 minutes to be ready; if it takes longer the embed tells you to check the panel.',
};

export async function execute(interaction) {
  await runControl(interaction, 'start');
}
