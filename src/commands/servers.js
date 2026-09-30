import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import { listServers } from '../gameap.js';
import { canUseServer, localeFor } from '../config.js';
import { serversEmbed } from '../embeds.js';

export const data = new SlashCommandBuilder()
  .setName('servers')
  .setDescription('List every game server with its current state')
  .setContexts(InteractionContextType.Guild);

export const help = {
  examples: ['/servers'],
  notes:
    '🟢 running, ⚪ stopped, ❓ no answer from the panel (server record disabled or the daemon is not reporting). Use `/status <server>` for one server in detail.',
};

export async function execute(interaction) {
  await interaction.deferReply();
  const { data: servers } = await listServers();
  const visible = servers.filter((s) => canUseServer(interaction.guildId, s.id));
  await interaction.editReply({ embeds: [serversEmbed(localeFor(interaction.guildId), visible)] });
}
