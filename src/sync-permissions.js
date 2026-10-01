#!/usr/bin/env node
// Grants the gated commands to the roles each guild has configured.
//
//   node --env-file=.env src/sync-permissions.js [--dry-run]
//
// Why this exists: `default_member_permissions` only takes permission bits, so
// the roles of `commandRoles` / `operatorRoleIds` cannot be expressed in the
// command definition. They are per-guild permission overwrites instead, and
// Discord hides a command from whoever does not get one:
//
//   every gated command is registered with default_member_permissions "0"
//   (npm run deploy) -> only admins see it
//   this script grants, per guild, the roles of config/guilds.json -> they see it
//
// A guild with no roles configured (`operatorRoleIds: []`, commandRoles empty)
// gets an explicit @everyone allow, so "anyone may operate" keeps meaning
// anyone. Run it with --dry-run first: it prints exactly what it would grant.
//
// Order matters after a deploy: run this right away, or the gated commands stay
// hidden for everyone but admins.

import { REST, Routes } from 'discord.js';
import { GATED_COMMANDS, loadCommands } from './registry.js';
import { overwritesFor } from './command-permissions.js';
import { resolveAppId } from './discord-app.js';

const { DISCORD_TOKEN } = process.env;
if (!DISCORD_TOKEN) {
  console.error('DISCORD_TOKEN is required');
  process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');
const rest = new REST().setToken(DISCORD_TOKEN);
const appId = await resolveAppId(rest);

const commands = await loadCommands();
const gated = [...commands.values()].filter((mod) => GATED_COMMANDS.includes(mod.data.name));

const registered = await rest.get(Routes.applicationCommands(appId));
const idByName = new Map(registered.map((cmd) => [cmd.name, cmd.id]));

const missing = gated.filter((mod) => !idByName.has(mod.data.name)).map((mod) => mod.data.name);
if (missing.length) {
  console.warn(
    `not registered yet: ${missing.map((n) => `/${n}`).join(' ')} — run \`npm run deploy\` first; skipped`,
  );
}
if (gated.some((mod) => registered.find((c) => c.name === mod.data.name)?.default_member_permissions !== '0')) {
  console.warn(
    'warning: some gated commands are registered without default_member_permissions "0",\n' +
      '         so Discord still shows them to everyone regardless of these overwrites.',
  );
}

const guilds = await rest.get(Routes.userGuilds());
console.log(`${dryRun ? '[dry-run] ' : ''}${gated.length} gated commands × ${guilds.length} guilds`);

let changed = 0;
for (const guild of guilds) {
  for (const mod of gated) {
    const name = mod.data.name;
    const commandId = idByName.get(name);
    if (!commandId) continue;

    const permissions = overwritesFor(guild.id, name);
    const target =
      permissions.length === 1 && permissions[0].id === String(guild.id)
        ? '@everyone'
        : permissions.map((p) => p.id).join(' + ');

    if (dryRun) {
      console.log(`[dry-run] ${guild.name ?? guild.id}  /${name}  -> allow ${target}`);
      continue;
    }

    await rest.put(Routes.applicationCommandPermissions(appId, guild.id, commandId), {
      body: { permissions },
    });
    console.log(`${guild.name ?? guild.id}  /${name}  -> allow ${target}`);
    changed++;
  }
}

console.log(
  dryRun
    ? 'dry run: nothing was sent to Discord'
    : `ok: ${changed} permission overwrites written`,
);
