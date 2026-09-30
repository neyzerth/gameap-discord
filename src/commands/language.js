// /language: el idioma del bot en este Discord (por guild, no por usuario).
//
// El override vive en data/locale.json —igual que /feed y /autostop— para que la
// config del repo no se toque. 'auto' borra el override y vuelve a la config.

import { SlashCommandBuilder, InteractionContextType, MessageFlags } from 'discord.js';
import { guardOperator } from '../control.js';
import { localeFor, localeSource, setLocaleOverrides } from '../config.js';
import { loadLocales, saveLocales } from '../state.js';
import { languageEmbed } from '../embeds.js';
import { canonicalTag, isSupported, supportedTags, t } from '../i18n/index.js';
import { localizeCommand, localizeOption } from '../i18n/commands.js';

export const AUTO = 'auto';

export const data = localizeCommand(
  new SlashCommandBuilder()
    .setName('language')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      localizeOption(option.setName('locale').setAutocomplete(true), 'language', 'locale'),
    ),
  'language',
);

export const help = {
  examples: ['/language', '/language locale:es-MX', '/language locale:auto'],
};

const choices = () => [...supportedTags(), AUTO];

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused().toLowerCase();
  await interaction.respond(
    choices()
      .filter((tag) => tag.toLowerCase().includes(focused))
      .map((tag) => ({ name: tag, value: tag })),
  );
}

export async function execute(interaction) {
  if (!(await guardOperator(interaction))) return;

  const guildId = interaction.guildId;
  const locale = localeFor(guildId);
  const requested = interaction.options.getString('locale');

  // Sin argumento: solo muestra el idioma efectivo y de dónde sale.
  if (requested === null) {
    await interaction.reply({ embeds: [languageEmbed(locale, localeFor(guildId), localeSource(guildId))] });
    return;
  }

  const clear = requested.toLowerCase() === AUTO;
  if (!clear && !isSupported(requested)) {
    await interaction.reply({
      content: t(locale, 'errors.unknownLocale', {
        locale: requested,
        available: choices().join(', '),
      }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const overrides = loadLocales();
  if (clear) delete overrides[String(guildId)];
  else overrides[String(guildId)] = canonicalTag(requested);
  saveLocales(overrides);
  setLocaleOverrides(overrides);

  // Ya con el override aplicado: la respuesta llega en el idioma nuevo.
  const effective = localeFor(guildId);
  await interaction.reply({
    embeds: [languageEmbed(effective, effective, localeSource(guildId))],
  });
}
