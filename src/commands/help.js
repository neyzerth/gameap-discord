import { MessageFlags, SlashCommandBuilder, InteractionContextType } from 'discord.js';
import { loadCommands } from '../registry.js';
import { commandEmbed, generalEmbed } from '../help.js';
import { localeFor } from '../config.js';
import { t } from '../i18n/index.js';
import { localizeCommand, localizeOption } from '../i18n/commands.js';

export const data = localizeCommand(
  new SlashCommandBuilder()
    .setName('help')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      localizeOption(option.setName('command').setAutocomplete(true), 'help', 'command'),
    ),
  'help',
);

export const help = {
  examples: ['/help', '/help command:players', '/help command:feed'],
};

export async function autocomplete(interaction) {
  const locale = localeFor(interaction.guildId);
  const focused = interaction.options.getFocused().toLowerCase();
  const commands = await loadCommands();
  const choices = [...commands.entries()]
    .filter(([name]) => name.includes(focused))
    .slice(0, 25)
    .map(([name]) => ({
      name: `/${name} — ${t(locale, `commands.${name}.description`)}`.slice(0, 100),
      value: name,
    }));
  await interaction.respond(choices);
}

export async function execute(interaction) {
  const locale = localeFor(interaction.guildId);
  const requested = interaction.options.getString('command');
  const commands = await loadCommands();

  if (requested) {
    const embed = commandEmbed(commands, requested, locale);
    if (embed) {
      await interaction.reply({ embeds: [embed] });
      return;
    }
    await interaction.reply({
      content: t(locale, 'errors.unknownCommand', { command: requested }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({ embeds: [generalEmbed(commands, interaction.guildId, locale)] });
}
