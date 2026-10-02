// Config commands (config/commands.json): the template renderer, the validator
// and the builder. The parts that talk to Discord or RCON are exercised through
// the source checks in gating.test.js — no network in the suite.
import './test-config.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { __setConfig } = await import('./config.js');
const {
  __setCustomCommands, buildData, customCommandsFor, guildCommand, placeholders,
  renderAll, renderTemplate, targetFor, templatesOf, validateDefinition,
} = await import('./custom-commands.js');

const SERVERS = { 9: { alias: 'mod-server', label: 'Mod Server', announce: false } };
const GUILDS = { defaults: {}, guilds: { g1: { servers: ['9'] } } };

const WHITELIST = {
  description: 'Server whitelist',
  server: '9',
  ephemeral: true,
  subcommands: {
    add: {
      description: 'Add a player',
      template: 'whitelistgate add {player}',
      options: [
        {
          name: 'player',
          type: 'string',
          required: true,
          description: 'Player name',
          source: 'players',
          pattern: '^[A-Za-z0-9_]{3,16}$',
        },
      ],
    },
    reload: { description: 'Reload the whitelist', template: 'whitelist reload' },
  },
};

const restore = () => {
  __setCustomCommands(null);
  __setConfig({}, { guilds: {} });
};

test('renderTemplate fills and trims the arguments', () => {
  assert.deepEqual(renderTemplate('mod add {player}', { player: '  Steve ' }), {
    ok: true,
    command: 'mod add Steve',
  });
  assert.deepEqual(renderTemplate('whitelist reload', {}), { ok: true, command: 'whitelist reload' });
});

test('renderTemplate refuses a missing or empty argument', () => {
  const empty = renderTemplate('mod add {player}', { player: '   ' });
  assert.equal(empty.ok, false);
  assert.deepEqual(empty.missing, ['player']);
  assert.equal(renderTemplate('mod add {player}', {}).ok, false);
});

test('renderTemplate refuses line breaks and ";" exactly like /rcon', () => {
  assert.equal(renderTemplate('say {text}', { text: 'a\nb' }).reason, 'rejected');
  assert.equal(renderTemplate('say {text}', { text: 'a\rb' }).reason, 'rejected');
  assert.equal(renderTemplate('say {text}', { text: 'op me;stop' }).reason, 'rejected');
});

test('renderTemplate refuses an over-long command', () => {
  // "say " is 4 characters, so 508 leaves the whole command at the 512 limit.
  assert.equal(renderTemplate('say {text}', { text: 'x'.repeat(509) }).reason, 'toolong');
  assert.equal(renderTemplate('say {text}', { text: 'x'.repeat(508) }).ok, true);
});

test('placeholders lists every template hole', () => {
  assert.deepEqual(placeholders('a {x} b {y} {x}'), ['x', 'y', 'x']);
  assert.deepEqual(placeholders('no holes'), []);
});

test('templatesOf reads one template or a pipeline', () => {
  assert.deepEqual(templatesOf({ template: 'say hi' }), ['say hi']);
  assert.deepEqual(templatesOf({ templates: ['a', 'b'] }), ['a', 'b']);
  assert.deepEqual(templatesOf({}), []);
});

test('renderAll renders a pipeline in order with the same arguments', () => {
  const target = { templates: ['mod add {player}', 'mod reload'] };
  assert.deepEqual(renderAll(target, { player: 'Steve' }), {
    ok: true,
    commands: ['mod add Steve', 'mod reload'],
  });
});

test('renderAll stops at the first template it cannot render', () => {
  const target = { templates: ['mod add {player}', 'mod mark {tag}'] };
  const rendered = renderAll(target, { player: 'Steve' });
  assert.equal(rendered.ok, false);
  assert.deepEqual(rendered.missing, ['tag']);
  assert.deepEqual(rendered.commands, ['mod add Steve'], 'what was rendered so far is kept');
});

test('renderAll sanitizes every template of the pipeline', () => {
  const rendered = renderAll({ templates: ['mod add {player}', 'mod note {note}'] }, { player: 'Steve', note: 'a;b' });
  assert.equal(rendered.ok, false);
  assert.equal(rendered.reason, 'rejected');
});

test('a pipeline definition passes validation and shares its options', () => {
  __setConfig(SERVERS, GUILDS);
  const def = {
    description: 'Add and reload',
    server: '9',
    subcommands: {
      add: {
        description: 'Add a player',
        templates: ['whitelistgate add {player}', 'whitelistgate reload'],
        options: [{ name: 'player', type: 'string', required: true, description: 'Player', source: 'players' }],
      },
    },
  };
  assert.deepEqual(validateDefinition('whitelistgate', def, []), []);

  // A hole that only the second template uses still needs its option.
  const missingOption = structuredClone(def);
  missingOption.subcommands.add.templates = ['whitelistgate add {player}', 'whitelistgate mark {tag}'];
  assert.match(validateDefinition('whitelistgate', missingOption, []).join(' '), /uses \{tag\} but no option/);

  // template and templates are alternatives, never both.
  const both = structuredClone(def);
  both.subcommands.add.template = 'whitelistgate reload';
  assert.match(validateDefinition('whitelistgate', both, []).join(' '), /use template or templates, not both/);

  const empty = structuredClone(def);
  empty.subcommands.add.templates = [];
  assert.match(validateDefinition('whitelistgate', empty, []).join(' '), /template \(or templates\) is required/);

  const notAnArray = structuredClone(def);
  notAnArray.subcommands.add.templates = 'whitelistgate reload';
  assert.match(validateDefinition('whitelistgate', notAnArray, []).join(' '), /templates must be an array/);

  const blank = structuredClone(def);
  blank.subcommands.add.templates = ['whitelistgate add {player}', '  '];
  assert.match(validateDefinition('whitelistgate', blank, []).join(' '), /non-empty string/);

  restore();
});

test('a usable definition passes validation', () => {
  __setConfig(SERVERS, GUILDS);
  assert.deepEqual(validateDefinition('whitelist', WHITELIST, ['rcon']), []);
  restore();
});

test('validation catches what Discord would reject with an opaque error', () => {
  __setConfig(SERVERS, GUILDS);
  const cases = [
    [{ ...WHITELIST, description: '' }, 'description is required'],
    [{ ...WHITELIST, description: 'x'.repeat(101) }, 'longer than 100'],
    [{ ...WHITELIST, server: '404' }, 'not in config/servers.json'],
    [
      { description: 'x', template: 'mod {ghost}' },
      'template uses {ghost} but no option is named that way',
    ],
    [
      {
        description: 'x',
        template: 'mod {a}',
        options: [
          { name: 'b', type: 'string', description: 'b', required: true },
        ],
      },
      'is never used by the template',
    ],
    [
      {
        description: 'x',
        template: 'mod {a} {b}',
        options: [
          { name: 'a', type: 'string', description: 'a' },
          { name: 'b', type: 'string', description: 'b', required: true },
        ],
      },
      'is required but comes after an optional option',
    ],
    [
      {
        description: 'x',
        template: 'mod {n}',
        options: [{ name: 'n', type: 'integer', description: 'n', source: 'players' }],
      },
      'source "players" only works with type string',
    ],
    [
      {
        description: 'x',
        template: 'mod {n}',
        options: [{ name: 'n', type: 'number', description: 'n' }],
      },
      'type must be one of string, integer, boolean',
    ],
    [{ description: 'x', template: 'mod {n};stop', options: [{ name: 'n', type: 'string', description: 'n' }] }, 'line breaks'],
  ];

  for (const [def, expected] of cases) {
    const problems = validateDefinition('probe', def, []);
    assert.ok(
      problems.some((p) => p.includes(expected)),
      `expected "${expected}" in: ${problems.join(' | ')}`,
    );
  }
  restore();
});

test('a config command may not shadow a built-in command', () => {
  __setConfig(SERVERS, GUILDS);
  assert.match(validateDefinition('rcon', WHITELIST, ['rcon']).join(' '), /collides/);
  assert.match(validateDefinition('Bad Name', WHITELIST, []).join(' '), /must match/);
  restore();
});

test('buildData nests subcommands and marks player options for autocomplete', () => {
  __setConfig(SERVERS, GUILDS);
  const json = buildData('whitelist', WHITELIST);
  assert.equal(json.name, 'whitelist');
  assert.equal(json.default_member_permissions, undefined, 'visible unless hidden');
  assert.deepEqual(json.options.map((o) => o.name), ['add', 'reload']);
  const [add] = json.options;
  assert.equal(add.type, 1, 'subcommand type');
  assert.equal(add.options[0].autocomplete, true);
  assert.equal(add.options[0].required, true);
  restore();
});

test('buildData honours hidden: true', () => {
  __setConfig(SERVERS, GUILDS);
  const json = buildData('whitelist', { ...WHITELIST, hidden: true });
  assert.equal(json.default_member_permissions, '0');
  restore();
});

test('targetFor resolves the subcommand that was used', () => {
  const interaction = { options: { getSubcommand: () => 'add' } };
  assert.equal(targetFor(WHITELIST, interaction), WHITELIST.subcommands.add);
  assert.equal(targetFor(WHITELIST, { options: { getSubcommand: () => 'nope' } }), null);
  const flat = { description: 'x', template: 'say hi' };
  assert.equal(targetFor(flat, interaction), flat);
});

test('guildCommand only answers for a guild that defines the command', () => {
  __setConfig(SERVERS, GUILDS);
  __setCustomCommands({ guilds: { g1: { whitelist: WHITELIST } } });

  assert.equal(customCommandsFor('g2').whitelist, undefined);
  assert.equal(guildCommand('g2', 'whitelist'), null);

  const command = guildCommand('g1', 'whitelist', ['rcon']);
  assert.equal(command.data.name, 'whitelist');
  assert.equal(typeof command.execute, 'function');
  assert.equal(guildCommand('g1', 'whitelist', ['rcon']), command, 'cached, not rebuilt');
  restore();
});

test('an unusable definition is skipped instead of breaking the bot', () => {
  __setConfig(SERVERS, GUILDS);
  __setCustomCommands({ guilds: { g1: { broken: { description: '', template: '' } } } });

  assert.equal(guildCommand('g1', 'broken'), null);
  assert.equal(guildCommand('g1', 'not-configured'), null);
  restore();
});
