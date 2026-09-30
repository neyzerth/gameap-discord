import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import { autocompleteServers, guardOperator, resolveServerOption } from '../control.js';
import { autoStopConfig, localeFor, setAutoStopOverrides } from '../config.js';
import { getState, loadAutoStop, saveAutoStop } from '../state.js';
import { evaluateIdle } from '../autostop.js';
import { autostopStatusEmbed } from '../embeds.js';

export const data = new SlashCommandBuilder()
  .setName('autostop')
  .setDescription('Stop a server automatically after N hours without players')
  .setContexts(InteractionContextType.Guild)
  .addStringOption((option) =>
    option.setName('server').setDescription('Server id or alias').setRequired(true).setAutocomplete(true),
  )
  .addIntegerOption((option) =>
    option
      .setName('hours')
      .setDescription('Hours without players before stopping (0 = turn it off)')
      .setMinValue(0)
      .setMaxValue(168),
  )
  .addIntegerOption((option) =>
    option
      .setName('warn')
      .setDescription('Minutes of warning in the feed before stopping (0 = no warning)')
      .setMinValue(0)
      .setMaxValue(120),
  );

export const autocomplete = autocompleteServers;

export const help = {
  summary: 'auto-shutdown when nobody plays',
  examples: [
    '/autostop mc-survival',
    '/autostop mc-survival hours:2 warn:15',
    '/autostop mc-survival hours:2 warn:0',
    '/autostop mc-survival hours:0',
  ],
  notes:
    'The clock only counts while the server is up with 0 players; if it is off, or the panel cannot tell, the clock resets. Anyone joining resets it, and 10 minutes of grace apply after /start, /stop or /restart. Operators only.',
};

function statusView(serverId, guildId, locale) {
  const cfg = autoStopConfig(serverId);
  const idle = getState().servers[String(serverId)]?.idle;
  const verdict = evaluateIdle(idle, cfg, { nowMs: Date.now() });
  return autostopStatusEmbed(locale, serverId, cfg, {
    idleMs: verdict.idleMs,
    minutesLeft: Number.isFinite(verdict.remainingMs) ? verdict.remainingMs : null,
    guildId,
  });
}

export async function execute(interaction) {
  if (!(await guardOperator(interaction))) return;
  const serverId = await resolveServerOption(interaction);
  if (!serverId) return;

  const locale = localeFor(interaction.guildId);
  const hours = interaction.options.getInteger('hours');
  const warn = interaction.options.getInteger('warn');

  if (hours === null && warn === null) {
    await interaction.reply({ embeds: [statusView(serverId, interaction.guildId, locale)] });
    return;
  }

  // Mismo patrón que /feed: el override vive en data/autostop.json, no en la config versionada.
  const overrides = loadAutoStop();
  if (hours === 0) {
    delete overrides[String(serverId)];
  } else {
    const base = autoStopConfig(serverId) ?? { hours: 2, warnMinutes: 15 };
    overrides[String(serverId)] = {
      hours: hours ?? base.hours,
      warnMinutes: warn ?? base.warnMinutes,
    };
  }
  saveAutoStop(overrides);
  setAutoStopOverrides(overrides);

  await interaction.reply({ embeds: [statusView(serverId, interaction.guildId, locale)] });
}
