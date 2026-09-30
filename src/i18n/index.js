// The bot's translation API.
//
// Adding a language is: drop `locales/<tag>.json` with the same keys as `en.json`
// (the tests fail if one is missing) and, when you also want Discord to localize
// the command metadata, add the tag to `discord-locales.js`.
//
// Everything the user reads in Discord goes through `t()` / `plural()`; console
// logs stay in English on purpose (they are for the operator, not the player).

import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_LOCALE, canonicalTag, createTranslator, normalize } from './core.js';
import { discordLocaleOf } from './discord-locales.js';
import { log } from '../logger.js';

const LOCALES_DIR = fileURLToPath(new URL('./locales/', import.meta.url));

function loadCatalogs(dir) {
  const catalogs = {};
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    catalogs[normalize(basename(file, '.json'))] = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  }
  if (!catalogs[BASE_LOCALE]) {
    throw new Error(`the base catalog ${BASE_LOCALE}.json is missing from ${dir}`);
  }
  return catalogs;
}

export const CATALOGS = loadCatalogs(LOCALES_DIR);

// Lowercase tags, as used for lookups ('en', 'es-mx').
export const SUPPORTED = Object.keys(CATALOGS);

// Tags to show a user ('en', 'es-MX').
export const supportedTags = () => SUPPORTED.map(canonicalTag);

// A missing key is a bug in the catalogs, so it is loud (once per key) and the
// placeholder is visible instead of an empty embed.
const warned = new Set();
function warnMissing({ locale, key }) {
  const id = `${locale}:${key}`;
  if (warned.has(id)) return;
  warned.add(id);
  log.warn(`missing translation: '${key}' is not defined for '${locale}' nor for '${BASE_LOCALE}'`);
}

const translator = createTranslator(CATALOGS, { base: BASE_LOCALE, onMissing: warnMissing });

export const t = translator.t;
export const plural = translator.plural;
export const missingKeys = translator.missing;
export const extraKeys = translator.extra;

// ¿Está definida esta clave? Para textos opcionales (una nota de /help que solo
// algunos comandos tienen): sin esto, t() avisaría de una clave que no existe.
export const has = translator.has;

export function isSupported(locale) {
  return translator.resolve(locale) !== null;
}

// The catalog a tag will actually read from ('es-AR' -> 'es-mx' -> 'es' -> base).
export function resolveTag(locale) {
  return translator.resolve(locale);
}

// `{ 'es-419': 'texto' }` for setNameLocalizations/setDescriptionLocalizations:
// every supported language Discord can localize, base language excluded because
// it is the command's own default text.
export function localizationsFor(key) {
  const out = {};
  for (const tag of SUPPORTED) {
    const discordLocale = discordLocaleOf(tag);
    if (discordLocale) out[discordLocale] = t(tag, key);
  }
  return out;
}

export { BASE_LOCALE, canonicalTag, normalize };
