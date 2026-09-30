import { SlashCommandBuilder, InteractionContextType, MessageFlags } from 'discord.js';
import { rconCommand } from '../gameap.js';
import { autocompleteServers, guardOperator, resolveServerOption } from '../control.js';
import { localeFor } from '../config.js';
import { t } from '../i18n/index.js';
import { localizeCommand, localizeOption } from '../i18n/commands.js';

const MAX_LEN = 1800;

export const data = localizeCommand(
  new SlashCommandBuilder()
    .setName('rcon')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      localizeOption(
        option.setName('server').setRequired(true).setAutocomplete(true),
        'rcon',
        'server',
      ),
    )
    .addStringOption((option) =>
      localizeOption(option.setName('command').setRequired(true), 'rcon', 'command'),
    ),
  'rcon',
);

export const autocomplete = autocompleteServers;

export const help = {
  examples: [
    '/rcon mc-survival say Server restarts in 5 minutes',
    '/rcon mc-survival list',
    '/rcon mc-survival whitelist list',
  ],
};

export async function execute(interaction) {
  if (!(await guardOperator(interaction))) return;
  const serverId = await resolveServerOption(interaction);
  if (!serverId) return;

  const locale = localeFor(interaction.guildId);
  const command = interaction.options.getString('command').trim();
  if (!command || /[\n\r;]/.test(command)) {
    await interaction.reply({
      content: t(locale, 'errors.rconRejected'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply();

  try {
    const { output } = await rconCommand(serverId, command);
    const text = String(output ?? '').trim();
    await interaction.editReply(text ? `\`\`\`\n${text.slice(0, MAX_LEN)}\n\`\`\`` : t(locale, 'errors.rconSent'));
  } catch (err) {
    await interaction.editReply(
      t(locale, 'errors.rconFailed', { message: `${err.status ?? ''} ${err.message}`.trim() }),
    );
  }
}
