// Single source of truth for the command set: index.js, deploy-commands.js and
// /help all read the same modules, so help can never drift from reality.

import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const COMMANDS_DIR = join(here, 'commands');

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
