// Pure translation core: no filesystem, no module state, so the rules below can be
// tested on their own. `index.js` is the thin layer that loads the catalogs.
//
// Conventions
//   - Locale tags are BCP-47 ('en', 'es-MX') and looked up case-insensitively.
//   - Catalogs are nested objects; a key is a dot path ('embeds.status.running').
//   - `en` is the base language and the only catalog that defines keys: the others
//     translate it and must have exactly the same keys (`missing()` reports gaps).

export const BASE_LOCALE = 'en';

export function normalize(tag) {
  return String(tag ?? '').trim().replace(/_/g, '-').toLowerCase();
}

// 'es-mx' -> 'es-MX': the form used when talking to users and to Discord.
export function canonicalTag(tag) {
  try {
    return Intl.getCanonicalLocales(normalize(tag))[0] ?? String(tag ?? '');
  } catch {
    return String(tag ?? '');
  }
}

// Lookup order for a tag: the exact tag first, then the bare language, so a
// region variant without its own file (es-AR) still lands on the language one.
//   'es-MX' -> ['es-mx', 'es']
export function tagChain(locale) {
  const tag = normalize(locale);
  if (!tag) return [];
  const language = tag.split('-')[0];
  return tag === language ? [tag] : [tag, language];
}

function get(catalog, key) {
  return key
    .split('.')
    .reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), catalog);
}

// {name} -> params.name. A param that was not passed stays visible ('{name}') on
// purpose: a typo in a catalog should be loud instead of silently eating data.
export function interpolate(template, params = {}) {
  return String(template).replace(/\{(\w+)\}/g, (match, name) =>
    params[name] === undefined || params[name] === null ? match : String(params[name]),
  );
}

// Cardinal plural form ('one'/'other', plus 'few'/'many' where the language uses
// them) straight from Intl, with a two-form fallback for odd tags.
export function pluralForm(locale, count) {
  const value = Number(count) || 0;
  try {
    return new Intl.PluralRules(canonicalTag(locale), { type: 'cardinal' }).select(value);
  } catch {
    return value === 1 ? 'one' : 'other';
  }
}

// Every dot path that points at a string, in catalog order.
export function leafKeys(object, prefix = '') {
  if (object === null || typeof object !== 'object') return [];
  return Object.entries(object).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value !== null && typeof value === 'object' ? leafKeys(value, path) : [path];
  });
}

export function createTranslator(catalogs, { base = BASE_LOCALE, onMissing = () => {} } = {}) {
  const baseTag = normalize(base);
  const baseCatalog = catalogs[baseTag] ?? {};

  // Unknown locale, or a language without a catalog: fall back to the base. A
  // region variant with no file of its own (es-AR, es-419) is served by the
  // catalog of its language (es-MX) instead of dropping to English.
  const resolve = (locale) => {
    const chain = tagChain(locale);
    for (const tag of chain) if (catalogs[tag]) return tag;
    const language = normalize(locale).split('-')[0];
    if (language) {
      return Object.keys(catalogs).find((tag) => tag.startsWith(`${language}-`)) ?? null;
    }
    return null;
  };

  function lookup(locale, key) {
    const tag = resolve(locale);
    if (!tag) return undefined;
    const value = get(catalogs[tag], key);
    return typeof value === 'string' ? value : undefined;
  }

  function t(locale, key, params = {}) {
    const value = lookup(locale, key) ?? lookup(baseTag, key);
    if (value === undefined) {
      onMissing({ locale: normalize(locale), key });
      return `⟨${key}⟩`;
    }
    return interpolate(value, params);
  }

  function plural(locale, key, count, params = {}) {
    const form = pluralForm(locale, count);
    for (const candidate of [`${key}_${form}`, `${key}_other`, key]) {
      const value = lookup(locale, candidate) ?? lookup(baseTag, candidate);
      if (value !== undefined) return interpolate(value, { count, ...params });
    }
    onMissing({ locale: normalize(locale), key: `${key}_${form}` });
    return `⟨${key}⟩`;
  }

  // Keys of the base language that this catalog does not translate.
  function missing(locale) {
    const tag = resolve(locale);
    if (!tag) return leafKeys(baseCatalog);
    const present = new Set(leafKeys(catalogs[tag]));
    return leafKeys(baseCatalog).filter((key) => !present.has(key));
  }

  // Keys that exist here but not in the base language: keys are defined once,
  // in the base catalog, so these are typos.
  function extra(locale) {
    const tag = resolve(locale);
    if (!tag) return [];
    const known = new Set(leafKeys(baseCatalog));
    return leafKeys(catalogs[tag]).filter((key) => !known.has(key));
  }

  return {
    t,
    plural,
    missing,
    extra,
    resolve,
    locales: Object.keys(catalogs),
    base: baseTag,
  };
}
