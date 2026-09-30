import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCommands, usageOf, COMMANDS_DIR } from './registry.js';
import { CATEGORIES, commandEmbed, generalEmbed } from './help.js';

const commands = await loadCommands();

test('every command has help text and is listed in a category', () => {
  const listed = new Set(CATEGORIES.flatMap((c) => c.names));
  for (const [name, mod] of commands) {
    const help = mod.help;
    assert.ok(help, `/${name} is missing its help export in ${COMMANDS_DIR}`);
    assert.ok(
      (help.examples?.length ?? 0) > 0 || help.notes,
      `/${name} needs at least one example or a note`,
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
  const embed = generalEmbed(commands, '1541489406920360017').toJSON();
  const text = [embed.description, ...embed.fields.map((f) => `${f.name}\n${f.value}`)].join('\n');
  for (const name of commands.keys()) {
    assert.ok(text.includes(`/${name}`), `general help does not mention /${name}`);
  }
  assert.ok(text.includes('Join/leave feed'));
  assert.ok(text.includes('/help command:start'));
});

test('per-command help builds for all commands and rejects unknown ones', () => {
  for (const name of commands.keys()) {
    const embed = commandEmbed(commands, name).toJSON();
    assert.equal(embed.title, `/${name}`);
    assert.ok(embed.fields.some((f) => f.name === 'Usage'), `/${name} help has no usage field`);
  }
  assert.equal(commandEmbed(commands, 'does-not-exist'), null);
});

test('help command exposes an autocompleted command option', () => {
  const json = commands.get('help').data.toJSON();
  const option = json.options.find((o) => o.name === 'command');
  assert.ok(option, '/help must have a command option');
  assert.equal(option.required ?? false, false);
  assert.equal(option.autocomplete, true);
});
