import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import { autocompleteServers, runControl } from '../control.js';

export const data = new SlashCommandBuilder()
  .setName('restart')
  .setDescription('Restart a game server (asks for confirmation when players are online)')
  .setContexts(InteractionContextType.Guild)
  .addStringOption((option) =>
    option.setName('server').setDescription('Server id or alias').setRequired(true).setAutocomplete(true),
  );

export const autocomplete = autocompleteServers;

export const help = {
  examples: ['/restart mc-survival', '/restart 8'],
  notes:
    'Same confirmation as `/stop`. The embed follows the process until it comes back up (a modded Minecraft server can take 1-2 minutes).',
};

export async function execute(interaction) {
  await runControl(interaction, 'restart');
}
