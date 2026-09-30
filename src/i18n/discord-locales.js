// Discord keeps its own list of locales (discord.js `Locale`) and 'es-MX' is not
// in it: Latin American Spanish is 'es-419'. Command *names* stay canonical
// (English) on purpose — what you type must work the same in every guild — so
// only descriptions and options are localized.
//
// Adding a language for the command metadata = one line here. The text itself
// always comes from ./locales/*.json.

import { canonicalTag } from './core.js';

export const DISCORD_LOCALES = {
  'es-MX': 'es-419',
};

export function discordLocaleOf(locale) {
  return DISCORD_LOCALES[canonicalTag(locale)] ?? null;
}
