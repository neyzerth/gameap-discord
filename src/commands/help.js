import { MessageFlags, SlashCommandBuilder, InteractionContextType } from 'discord.js';
import { loadCommands } from '../registry.js';
import { commandEmbed, generalEmbed } from '../help.js';

export const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('How to use the bot: every command, examples and tips')
  .setContexts(InteractionContextType.Guild)
  .addStringOption((option) =>
    option
      .setName('command')
      .setDescription('Get details and examples for one specific command')
      .setAutocomplete(true),
  );

export const help = {
  examples: ['/help', '/help command:players', '/help command:feed'],
  notes: 'The command list is generated from the live commands, so it is always up to date.',
};

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused().toLowerCase();
  const commands = await loadCommands();
  const choices = [...commands.entries()]
    .filter(([name]) => name.includes(focused))
    .slice(0, 25)
    .map(([name, mod]) => ({
      name: `/${name} — ${mod.data.toJSON().description}`.slice(0, 100),
      value: name,
    }));
  await interaction.respond(choices);
}

export async function execute(interaction) {
  const requested = interaction.options.getString('command');
  const commands = await loadCommands();

  if (requested) {
    const embed = commandEmbed(commands, requested);
    if (embed) {
      await interaction.reply({ embeds: [embed] });
      return;
    }
    await interaction.reply({
      content: `I do not know a command called \`${requested}\`. Try \`/help\`.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({ embeds: [generalEmbed(commands, interaction.guildId)] });
}
