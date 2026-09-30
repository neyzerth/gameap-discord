import './test-config.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCommands, usageOf, COMMANDS_DIR } from './registry.js';
import { CATEGORIES, commandEmbed, generalEmbed } from './help.js';
import { has, supportedTags, t } from './i18n/index.js';

const commands = await loadCommands();

test('every command has help text and is listed in a category', () => {
  const listed = new Set(CATEGORIES.flatMap((c) => c.names));
  for (const [name, mod] of commands) {
    const help = mod.help;
    assert.ok(help, `/${name} is missing its help export in ${COMMANDS_DIR}`);
    assert.ok(
      (help.examples?.length ?? 0) > 0 || has('en', `commands.${name}.notes`),
      `/${name} needs at least one example or a note (commands.${name}.notes in the catalog)`,
    );
    assert.ok(listed.has(name), `/${name} is not in any CATEGORIES entry of help.js`);
  }
});

test('usage strings are built from the command options', () => {
  assert.equal(usageOf(commands.get('servers')), '/servers');
  assert.equal(usageOf(commands.get('start')), '/start <server>');
  assert.equal(usageOf(commands.get('rcon')), '/rcon <server> <command>');
  assert.equal(usageOf(commands.get('feed')), '/feed <server> <state>');
  assert.equal(usageOf(commands.get('help')), '/help [command]');
});

test('general help lists every command and the feed section', () => {
  const embed = generalEmbed(commands, '345678901234567890', 'en').toJSON();
  const text = [embed.description, ...embed.fields.map((f) => `${f.name}\n${f.value}`)].join('\n');
  for (const name of commands.keys()) {
    assert.ok(text.includes(`/${name}`), `general help does not mention /${name}`);
  }
  assert.ok(text.includes('Join/leave feed'));
  assert.ok(text.includes('/help command:start'));
});

test('per-command help builds for all commands and rejects unknown ones', () => {
  for (const name of commands.keys()) {
    const embed = commandEmbed(commands, name, 'en').toJSON();
    assert.equal(embed.title, `/${name}`);
    assert.ok(embed.fields.some((f) => f.name === 'Usage'), `/${name} help has no usage field`);
  }
  assert.equal(commandEmbed(commands, 'does-not-exist', 'en'), null);
});

test('the same help comes out in Spanish, labels included', () => {
  const general = generalEmbed(commands, '345678901234567890', 'es-MX').toJSON();
  const text = [general.description, ...general.fields.map((f) => `${f.name}\n${f.value}`)].join('\n');
  assert.equal(general.title, 'Bot de GameAP — ayuda');
  assert.ok(text.includes('Feed de entradas y salidas'), 'the feed section is not translated');
  assert.ok(text.includes('Encender y apagar servidores'), 'the category blurb is not translated');

  const perCommand = commandEmbed(commands, 'start', 'es-MX').toJSON();
  assert.equal(perCommand.description, t('es-MX', 'commands.start.description'));
  assert.ok(perCommand.fields.some((f) => f.name === 'Uso'), 'field names are not translated');
  assert.ok(perCommand.fields.some((f) => f.name === 'Bueno saberlo'), 'the notes field is not translated');
});

test('command metadata carries Discord localizations for every translated language', () => {
  for (const name of commands.keys()) {
    const json = commands.get(name).data.toJSON();
    assert.equal(json.description, t('en', `commands.${name}.description`), `/${name} base description`);
    const localizations = json.description_localizations ?? {};
    for (const tag of supportedTags().filter((t) => t !== 'en')) {
      assert.ok(localizations['es-419'], `/${name} has no description localization for ${tag}`);
    }
    for (const option of json.options ?? []) {
      assert.ok(
        option.description_localizations?.['es-419'],
        `/${name} ${option.name} has no description localization`,
      );
    }
  }
});

test('help command exposes an autocompleted command option', () => {
  const json = commands.get('help').data.toJSON();
  const option = json.options.find((o) => o.name === 'command');
  assert.ok(option, '/help must have a command option');
  assert.equal(option.required ?? false, false);
  assert.equal(option.autocomplete, true);
});
