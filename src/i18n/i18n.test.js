import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalTag, createTranslator, interpolate, leafKeys, normalize, pluralForm, tagChain,
} from './core.js';
import {
  CATALOGS, SUPPORTED, extraKeys, isSupported, missingKeys, plural, resolveTag, t,
} from './index.js';
import { discordLocaleOf } from './discord-locales.js';

// Fixture catalogs: the rules are tested without touching the real translations.
const FIXTURES = {
  en: {
    greeting: 'hello {name}',
    players_one: '1 player',
    players_other: '{count} players',
    baseOnly: 'base only',
    nested: { deep: { value: 'deep value' } },
  },
  'es-mx': {
    greeting: 'hola {name}',
    players_one: '1 jugador',
    players_other: '{count} jugadores',
    nested: { deep: { value: 'valor profundo' } },
  },
};

const fixture = createTranslator(FIXTURES);

test('tags are normalized and canonicalized', () => {
  assert.equal(normalize('  ES_mx '), 'es-mx');
  assert.equal(canonicalTag('es-mx'), 'es-MX');
  assert.equal(canonicalTag('en'), 'en');
});

test('the lookup chain is the exact tag, then the language', () => {
  assert.deepEqual(tagChain('es-MX'), ['es-mx', 'es']);
  assert.deepEqual(tagChain('en'), ['en']);
  assert.deepEqual(tagChain(''), []);
});

test('interpolation replaces known params and keeps unknown ones visible', () => {
  assert.equal(interpolate('hello {name}', { name: 'alice' }), 'hello alice');
  assert.equal(interpolate('hello {name}', {}), 'hello {name}');
  assert.equal(interpolate('{count} players', { count: 3 }), '3 players');
});

test('plural forms come from Intl, including languages with more than two', () => {
  assert.equal(pluralForm('en', 1), 'one');
  assert.equal(pluralForm('en', 3), 'other');
  assert.equal(pluralForm('es-MX', 1), 'one');
  assert.equal(pluralForm('pl', 2), 'few');
  assert.equal(pluralForm('pl', 5), 'many');
});

test('translates in the requested language, including inside nested keys', () => {
  assert.equal(fixture.t('es-MX', 'greeting', { name: 'alice' }), 'hola alice');
  assert.equal(fixture.t('en', 'nested.deep.value'), 'deep value');
  assert.equal(fixture.t('es-MX', 'nested.deep.value'), 'valor profundo');
});

test('unknown locales and untranslated keys fall back to the base language', () => {
  assert.equal(fixture.t('de', 'greeting', { name: 'x' }), 'hello x');
  assert.equal(fixture.t('es-MX', 'baseOnly'), 'base only');
  // A region variant still resolves through its language file.
  assert.equal(fixture.t('es-AR', 'greeting', { name: 'x' }), 'hola x');
  assert.equal(fixture.resolve('es-AR'), 'es-mx');
  // ...including the code Discord uses for Latin American Spanish.
  assert.equal(fixture.resolve('es-419'), 'es-mx');
  assert.equal(fixture.t('es-419', 'greeting', { name: 'x' }), 'hola x');
  // A language we have no catalog for never borrows another one.
  assert.equal(fixture.resolve('de-AT'), null);
  assert.equal(fixture.resolve('de'), null);
  // Base language variants land on the base catalog.
  assert.equal(fixture.resolve('en-GB'), 'en');
});

test('a key that exists nowhere is loud instead of silently empty', () => {
  const seen = [];
  const loud = createTranslator(FIXTURES, { onMissing: (info) => seen.push(info) });
  assert.equal(loud.t('es-MX', 'nope.missing'), '⟨nope.missing⟩');
  assert.deepEqual(seen, [{ locale: 'es-mx', key: 'nope.missing' }]);
  assert.equal(loud.plural('es-MX', 'nope.players', 2), '⟨nope.players⟩');
});

test('plural picks the right form and injects the count', () => {
  assert.equal(fixture.plural('en', 'players', 1), '1 player');
  assert.equal(fixture.plural('es-MX', 'players', 1), '1 jugador');
  assert.equal(fixture.plural('es-MX', 'players', 4), '4 jugadores');
});

test('missing() and extra() describe how complete a catalog is', () => {
  assert.deepEqual(fixture.missing('es-MX'), ['baseOnly']);
  assert.deepEqual(fixture.extra('es-MX'), []);
  const withTypos = createTranslator({ en: { a: 'a' }, 'es-mx': { b: 'b' } });
  assert.deepEqual(withTypos.missing('es-MX'), ['a']);
  assert.deepEqual(withTypos.extra('es-MX'), ['b']);
});

test('leafKeys walks nested catalogs into dot paths', () => {
  assert.deepEqual(leafKeys({ a: '1', b: { c: '2', d: { e: '3' } } }), ['a', 'b.c', 'b.d.e']);
});

test('the real catalogs are discovered and complete', () => {
  assert.ok(SUPPORTED.includes('en'), 'the base language is not loaded');
  assert.ok(SUPPORTED.includes('es-mx'), 'the Mexican Spanish catalog is not loaded');
  assert.deepEqual(missingKeys('es-MX'), [], 'es-MX is missing keys defined in en.json');
  assert.deepEqual(extraKeys('es-MX'), [], 'es-MX defines keys that en.json does not have');
});

test('supported locales are recognized, unsupported ones are not', () => {
  assert.equal(isSupported('es-MX'), true);
  assert.equal(isSupported('ES_mx'), true);
  assert.equal(isSupported('de'), false);
  assert.equal(resolveTag('es-MX'), 'es-mx');
});

test('every translated value is non-empty and has no placeholder leftovers', () => {
  for (const tag of SUPPORTED) {
    const walk = (node, path = '') => {
      for (const [key, value] of Object.entries(node)) {
        const full = path ? `${path}.${key}` : key;
        if (value !== null && typeof value === 'object') {
          walk(value, full);
          continue;
        }
        assert.equal(typeof value, 'string', `${tag}:${full} is not a string`);
        assert.ok(value.trim().length > 0, `${tag}:${full} is empty`);
        const unbalanced = (value.match(/\{/g) ?? []).length !== (value.match(/\}/g) ?? []).length;
        assert.equal(unbalanced, false, `${tag}:${full} has unbalanced { } placeholders`);
      }
    };
    walk(CATALOGS[tag]);
  }
});

test('es-MX actually translates the base text', () => {
  const spanish = t('es-MX', 'errors.commandFailed', { message: 'boom' });
  assert.ok(spanish.includes('boom'));
  assert.notEqual(spanish, t('en', 'errors.commandFailed', { message: 'boom' }));
});

test('Discord locale codes are mapped, and the base language is not sent', () => {
  assert.equal(discordLocaleOf('es-MX'), 'es-419');
  assert.equal(discordLocaleOf('es-mx'), 'es-419');
  assert.equal(discordLocaleOf('en'), null);
});
