import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import { autocompleteServers, runControl } from '../control.js';

export const data = new SlashCommandBuilder()
  .setName('stop')
  .setDescription('Stop a game server (asks for confirmation when players are online)')
  .setContexts(InteractionContextType.Guild)
  .addStringOption((option) =>
    option.setName('server').setDescription('Server id or alias').setRequired(true).setAutocomplete(true),
  );

export const autocomplete = autocompleteServers;

export const help = {
  examples: ['/stop ludopatia', '/stop 8'],
  notes:
    'If somebody is playing, the bot shows the online players and waits for a Confirm/Cancel button (60 seconds) before stopping. Use it as a "save everyone first" guard, or `/rcon ludopatia say server restarts in 1 min` before.',
};

export async function execute(interaction) {
  await runControl(interaction, 'stop');
}
