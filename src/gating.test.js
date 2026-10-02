// Keeps `GATED_COMMANDS` honest: the list in registry.js must match exactly the
// commands whose source goes through guardOperator(), and the registration body
// must hide those (and only those) from non-admins.
import './test-config.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { COMMANDS_DIR, GATED_COMMANDS, isGated, loadCommands, deployBody } = await import('./registry.js');

const files = readdirSync(COMMANDS_DIR).filter((f) => f.endsWith('.js'));

// start/stop/restart do not mention guardOperator: they call runControl(), which
// guards inside src/control.js. Both routes count as gated.
const GATE_CALL = /\b(guardOperator|runControl)\s*\(/;

const gatedBySource = new Set();
for (const file of files) {
  const source = readFileSync(join(COMMANDS_DIR, file), 'utf8');
  if (!GATE_CALL.test(source)) continue;
  const mod = await import(pathToFileURL(join(COMMANDS_DIR, file)).href);
  gatedBySource.add(mod.data.name);
}

test('GATED_COMMANDS matches the commands that use guardOperator', () => {
  assert.deepEqual([...gatedBySource].sort(), [...GATED_COMMANDS].sort());
});

test('every gated name is a real command', async () => {
  const commands = await loadCommands();
  for (const name of GATED_COMMANDS) assert.ok(commands.has(name), `/${name} is not a loaded command`);
});

test('the registration body hides the gated commands from non-admins', async () => {
  const body = deployBody(await loadCommands());
  for (const cmd of body) {
    if (isGated(cmd.name)) {
      assert.equal(cmd.default_member_permissions, '0', `/${cmd.name} must be registered hidden`);
    } else {
      assert.equal(cmd.default_member_permissions, undefined, `/${cmd.name} must stay visible`);
    }
  }
});

test('the information commands are never gated', () => {
  for (const name of ['servers', 'status', 'players', 'help']) assert.equal(isGated(name), false);
});

// Config commands are RCON by definition, so they must never grow a path that
// skips the operator gate, the template renderer or the panel call.
test('config commands always pass through the gate, the renderer and the panel', () => {
  const source = readFileSync(join(COMMANDS_DIR, '..', 'custom-commands.js'), 'utf8');
  assert.match(source, /guardOperator\(interaction, name\)/, 'the executor must gate on the command name');
  assert.match(source, /renderAll\(target, values\)/, 'the command must be rendered, never raw');
  assert.match(source, /renderTemplate\(template, values\)/, 'every template of a pipeline is sanitized');
  assert.match(source, /rconCommand\(serverId, command\)/, 'only the rendered command reaches RCON');
});

test('config commands are registered per guild, never globally', () => {
  const source = readFileSync(join(COMMANDS_DIR, '..', 'custom-commands.js'), 'utf8');
  assert.match(source, /Routes\.applicationGuildCommands\(appId, guildId\)/);
  assert.ok(
    !source.includes('Routes.applicationCommands('),
    'config commands must not be registered globally: they are guild-scoped',
  );
});
