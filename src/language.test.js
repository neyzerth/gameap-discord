import './test-config.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { localeFor, localeSource, setLocaleOverrides } from './config.js';
import { has, supportedTags, t } from './i18n/index.js';
import { AUTO, autocomplete, data, execute } from './commands/language.js';
import { CATEGORIES } from './help.js';

// El override de /language se guarda en un archivo aparte (data/), nunca en la
// config versionada. Aquí se apunta a uno de prueba que se borra al final.
const FILE = `./data/test-locale-${process.pid}.json`;
process.env.LOCALES_STATE_FILE = FILE;

const GUILD = 'g-language-test';

function fakeInteraction({ locale = null, focused = '', guildId = GUILD } = {}) {
  const replies = [];
  return {
    replies,
    interaction: {
      guildId,
      member: { guild: { id: guildId }, roles: { cache: { some: () => false } } },
      options: {
        getString: (name) => (name === 'locale' ? locale : null),
        getFocused: () => focused,
      },
      reply: async (payload) => {
        replies.push(payload);
      },
      respond: async (choices) => {
        replies.push({ choices });
      },
    },
  };
}

test('/language is a guild command with a localized locale option', () => {
  const json = data.toJSON();
  assert.equal(json.name, 'language');
  assert.deepEqual(json.contexts, [0], 'only in Discord guilds');
  assert.equal(json.description, t('en', 'commands.language.description'));
  assert.equal(json.description_localizations['es-419'], t('es-MX', 'commands.language.description'));
  const option = json.options.find((o) => o.name === 'locale');
  assert.ok(option, '/language must have a locale option');
  assert.equal(option.required ?? false, false, 'sin argumento solo muestra el idioma actual');
  assert.equal(option.autocomplete, true);
  assert.ok(option.description_localizations['es-419'], 'the option description is not localized');
  assert.ok(
    CATEGORIES.some((c) => c.names.includes('language')),
    '/language is missing from the /help categories',
  );
});

test('the autocomplete offers the supported languages and auto', async () => {
  const all = fakeInteraction();
  await autocomplete(all.interaction);
  const offered = all.replies[0].choices.map((c) => c.value);
  for (const tag of supportedTags()) assert.ok(offered.includes(tag), `${tag} is not offered`);
  assert.ok(offered.includes(AUTO), 'a way to go back to the configured language is not offered');

  const one = fakeInteraction({ focused: 'es' });
  await autocomplete(one.interaction);
  assert.deepEqual(one.replies[0].choices.map((c) => c.value), ['es-MX']);
});

test('/language without arguments reports the language and where it comes from', async () => {
  setLocaleOverrides({});
  const { interaction, replies } = fakeInteraction();
  await execute(interaction);

  const embed = replies[0].embeds[0].toJSON();
  assert.equal(embed.title, t('en', 'embeds.language.title'));
  assert.deepEqual(embed.fields[0], { name: t('en', 'embeds.language.current'), value: '**en**', inline: true });
  assert.equal(embed.fields[1].value, t('en', 'embeds.language.sources.base'));
  assert.match(embed.fields[2].value, /`es-MX`/, 'the available languages are not listed');
});

test('/language locale:es-MX switches this guild and writes the override', async () => {
  setLocaleOverrides({});
  const { interaction, replies } = fakeInteraction({ locale: 'es-MX' });
  await execute(interaction);

  assert.equal(localeFor(GUILD), 'es-MX');
  assert.equal(localeSource(GUILD), 'override');

  // La respuesta ya sale en el idioma nuevo.
  const embed = replies[0].embeds[0].toJSON();
  assert.equal(embed.title, 'Idioma');
  assert.deepEqual(embed.fields[0], { name: 'Idioma actual', value: '**es-MX**', inline: true });
  assert.equal(embed.fields[1].value, t('es-MX', 'embeds.language.sources.override'));

  const { loadLocales } = await import('./state.js');
  assert.deepEqual(loadLocales(), { [GUILD]: 'es-MX' }, 'the override was not persisted');
});

test('/language locale:auto drops the choice and goes back to the configured language', async () => {
  const { interaction, replies } = fakeInteraction({ locale: AUTO });
  await execute(interaction);

  assert.equal(localeSource(GUILD), 'base');
  const { loadLocales } = await import('./state.js');
  assert.deepEqual(loadLocales(), {}, 'the override was not removed');
  assert.equal(replies[0].embeds[0].toJSON().title, t(localeFor(GUILD), 'embeds.language.title'));
});

test('an unknown language is refused without changing anything', async () => {
  setLocaleOverrides({});
  const { interaction, replies } = fakeInteraction({ locale: 'klingon' });
  await execute(interaction);

  assert.match(replies[0].content, /klingon/);
  assert.match(replies[0].content, /es-MX/, 'the error does not list what is available');
  const { loadLocales } = await import('./state.js');
  assert.deepEqual(loadLocales(), {});
  assert.equal(localeFor(GUILD), 'en');
});

test('every language has a label for every source in the catalog', () => {
  for (const tag of supportedTags()) {
    for (const source of ['override', 'guild', 'defaults', 'env', 'base']) {
      assert.ok(has(tag, `embeds.language.sources.${source}`), `${tag} is missing the ${source} label`);
    }
  }
});

test.after(() => {
  setLocaleOverrides({});
  delete process.env.LOCALES_STATE_FILE;
  rmSync(FILE, { force: true });
});
