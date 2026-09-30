// Closing guards for the translation layer: keys that are asked for but do not
// exist, and user-facing text that sneaked back into the code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_LOCALE, has, missingKeys, extraKeys, SUPPORTED } from './index.js';

const SRC = fileURLToPath(new URL('..', import.meta.url));

function jsFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return entry === 'locales' ? [] : jsFiles(path);
    }
    return entry.endsWith('.js') && !entry.endsWith('.test.js') ? [path] : [];
  });
}

const FILES = jsFiles(SRC);
const SOURCES = FILES.map((path) => ({ path, code: readFileSync(path, 'utf8') }));

test('the source tree is scanned (the guards below are not vacuous)', () => {
  assert.ok(FILES.length >= 15, `only ${FILES.length} source files found`);
  assert.ok(FILES.some((p) => p.endsWith('embeds.js')));
});

test('every catalog key asked for literally in the code exists in the base catalog', () => {
  const pattern = /(\bt\(|\bhas\(|\bplural\()\s*[^,)]*,\s*['"`]([a-zA-Z0-9_.]+)['"`]/g;
  const asked = new Map(); // clave -> ¿viene de plural()?
  for (const { code } of SOURCES) {
    for (const [, fn, key] of code.matchAll(pattern)) asked.set(key, fn === 'plural(');
  }
  assert.ok(asked.size >= 30, `only ${asked.size} literal keys found: is the pattern still matching?`);

  // plural() pide la raíz: el texto vive en <clave>_one / <clave>_other.
  const unknown = [...asked.entries()]
    .filter(([key, isPlural]) => !has(BASE_LOCALE, isPlural ? `${key}_other` : key))
    .map(([key]) => key)
    .sort();
  assert.deepEqual(unknown, [], 'the code asks for keys that en.json does not define');
});

test('every supported language translates every key, with no leftovers', () => {
  for (const tag of SUPPORTED) {
    if (tag === BASE_LOCALE) continue;
    assert.deepEqual(missingKeys(tag), [], `${tag} does not translate every key of the base catalog`);
    assert.deepEqual(extraKeys(tag), [], `${tag} defines keys the base catalog does not have`);
  }
});

test('user-facing strings live in the catalogs, not in the modules', () => {
  // Frases que solo deben existir en src/i18n/locales/*.json: si alguna vuelve al
  // código, se cuela sin traducir.
  const sentinels = [
    'No servers available.',
    'No players online.',
    'Stops in',
    'Online now:',
    'DRY RUN — nothing was stopped',
    'Stops the server after',
    'This will affect them',
    'You are not allowed to use this command',
    'Command failed:',
  ];
  for (const { path, code } of SOURCES) {
    for (const sentinel of sentinels) {
      assert.ok(
        !code.includes(sentinel),
        `${path} contains "${sentinel}": that text belongs in the catalogs`,
      );
    }
  }
});
