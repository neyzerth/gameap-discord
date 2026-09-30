import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import { listServers } from '../gameap.js';
import { canUseServer, localeFor } from '../config.js';
import { serversEmbed } from '../embeds.js';
import { localizeCommand } from '../i18n/commands.js';

export const data = localizeCommand(
  new SlashCommandBuilder().setName('servers').setContexts(InteractionContextType.Guild),
  'servers',
);

// Los ejemplos son líneas de comando (no se traducen); la prosa vive en el catálogo.
export const help = {
  examples: ['/servers'],
};

export async function execute(interaction) {
  await interaction.deferReply();
  const { data: servers } = await listServers();
  const visible = servers.filter((s) => canUseServer(interaction.guildId, s.id));
  await interaction.editReply({ embeds: [serversEmbed(localeFor(interaction.guildId), visible)] });
}
