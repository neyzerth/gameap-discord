// Single source of truth for the command set: index.js, deploy-commands.js and
// /help all read the same modules, so help can never drift from reality.

import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const COMMANDS_DIR = join(here, 'commands');

// Commands that go through the operator guard: guardOperator() directly
// (`/rcon`, `/feed`, `/autostop`, `/language`) or via runControl()
// (`/start`, `/stop`, `/restart`), both in src/control.js. Two things follow
// from this list: the deploy hides them from non-admins
// (`default_member_permissions: "0"`) and `src/check-permissions.js` reports,
// per guild, the roles its `commandRoles` / `operatorRoleIds` should be granted
// in Discord (the bot cannot write command permissions itself).
//
// src/gating.test.js checks this list against the sources that actually call the
// guard, so a new gated command cannot silently stay visible or un-synced.
export const GATED_COMMANDS = Object.freeze([
  'start',
  'stop',
  'restart',
  'rcon',
  'feed',
  'autostop',
  'language',
]);

export const isGated = (name) => GATED_COMMANDS.includes(name);

// REST body for the command registration. The gated commands are hidden from
// everyone without the Administrator flag (`default_member_permissions: "0"`);
// each guild's roles are granted by hand in Discord and audited with
// `npm run check:permissions`.
export function deployBody(commands) {
  return [...commands.values()].map((mod) => {
    const json = mod.data.toJSON();
    if (isGated(json.name)) json.default_member_permissions = '0';
    return json;
  });
}

export async function loadCommands() {
  const commands = new Map();
  for (const file of readdirSync(COMMANDS_DIR).filter((f) => f.endsWith('.js'))) {
    const mod = await import(pathToFileURL(join(COMMANDS_DIR, file)).href);
    if (mod.data && mod.execute) commands.set(mod.data.name, mod);
  }
  return commands;
}

// "/start <server> [note]" built from the builder's own options.
export function usageOf(mod) {
  const json = mod.data.toJSON();
  const args = (json.options ?? [])
    .map((o) => (o.required ? `<${o.name}>` : `[${o.name}]`))
    .join(' ');
  return `/${json.name}${args ? ` ${args}` : ''}`;
}
