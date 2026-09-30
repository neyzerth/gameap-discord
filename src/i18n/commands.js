// Helpers so a command module declares *which* text it needs and never carries
// the text itself. The base language always comes from the catalog (en.json):
// one place to edit, and the tests can fail when a key nobody wrote is asked for.
//
// Command *names* stay canonical (English) on purpose: what you type has to work
// the same in every guild, so only descriptions and options are localized.

import { BASE_LOCALE, localizationsFor, t } from './index.js';

export const commandKey = (name, ...path) => ['commands', name, ...path].join('.');

export function localizeCommand(builder, name) {
  return withDescription(builder, commandKey(name, 'description'));
}

export function localizeOption(option, name, optionName) {
  return withDescription(option, commandKey(name, 'options', optionName));
}

function withDescription(builder, key) {
  return builder
    .setDescription(t(BASE_LOCALE, key))
    .setDescriptionLocalizations(localizationsFor(key));
}
