import { SlashCommandBuilder, InteractionContextType, MessageFlags } from 'discord.js';
import { rconCommand } from '../gameap.js';
import { autocompleteServers, guardOperator, resolveServerOption } from '../control.js';

const MAX_LEN = 1800;

export const data = new SlashCommandBuilder()
  .setName('rcon')
  .setDescription('Send a raw RCON command to a server (say, whitelist list, ...)')
  .setContexts(InteractionContextType.Guild)
  .addStringOption((option) =>
    option.setName('server').setDescription('Server id or alias').setRequired(true).setAutocomplete(true),
  )
  .addStringOption((option) =>
    option.setName('command').setDescription('RCON command, e.g. say hello').setRequired(true),
  );

export const autocomplete = autocompleteServers;

export const help = {
  summary: 'operators only',
  examples: [
    '/rcon mc-survival say Server restarts in 5 minutes',
    '/rcon mc-survival list',
    '/rcon mc-survival whitelist list',
  ],
  notes:
    'Anything the server console accepts, with your own risk: it is not validated. Line breaks and ";" are rejected on purpose. Very long output is cut at 1800 characters.',
};

export async function execute(interaction) {
  if (!(await guardOperator(interaction))) return;
  const serverId = await resolveServerOption(interaction);
  if (!serverId) return;

  const command = interaction.options.getString('command').trim();
  if (!command || /[\n\r;]/.test(command)) {
    await interaction.reply({
      content: 'Command rejected: line breaks and ";" are not allowed.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply();

  try {
    const { output } = await rconCommand(serverId, command);
    const text = String(output ?? '').trim();
    await interaction.editReply(
      text
        ? `\`\`\`\n${text.slice(0, MAX_LEN)}\n\`\`\``
        : 'RCON command sent (no output).',
    );
  } catch (err) {
    await interaction.editReply(`RCON failed: ${err.status ?? ''} ${err.message}`.trim());
  }
}
