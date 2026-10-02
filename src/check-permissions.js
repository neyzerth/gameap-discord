#!/usr/bin/env node
// Read-only report: does each guild see the gated commands it should?
//
//   node --env-file=.env src/check-permissions.js
//
// Why it only reads: the bot cannot write these permissions. The endpoint
//
//   PUT /applications/{app}/guilds/{guild}/commands/{cmd}/permissions
//
// answers 403 {"message":"Bots cannot use this endpoint","code":20001} — it wants
// a user token with the `applications.commands.permissions.update` scope. So the
// grants are made in the client, per guild, by an admin:
//
//   Server Settings -> Integrations -> <the app> -> Manage
//   (one entry at the top applies to every command; each command can be unsynced
//    for finer control)
//
// Reads work with the bot token, so this script reports, guild by guild and
// command by command, what config/guilds.json asks for against what Discord
// reports, and exits non-zero on drift.

import { REST, Routes } from 'discord.js';
import { GATED_COMMANDS, loadCommands } from './registry.js';
import { compare } from './command-permissions.js';
import { resolveAppId } from './discord-app.js';

const { DISCORD_TOKEN } = process.env;
if (!DISCORD_TOKEN) {
  console.error('DISCORD_TOKEN is required');
  process.exit(1);
}

const rest = new REST().setToken(DISCORD_TOKEN);
const appId = await resolveAppId(rest);

const commands = await loadCommands();
const gated = [...commands.values()]
  .filter((mod) => GATED_COMMANDS.includes(mod.data.name))
  .map((mod) => mod.data.name);

const registered = await rest.get(Routes.applicationCommands(appId));
const byName = new Map(registered.map((cmd) => [cmd.name, cmd]));

const guilds = await rest.get(Routes.userGuilds());
console.log(`${gated.length} gated commands × ${guilds.length} guilds\n`);

let problems = 0;

for (const guild of guilds) {
  const label = guild.name ?? guild.id;
  const rows = await rest
    .get(Routes.guildApplicationCommandsPermissions(appId, guild.id))
    .catch(() => []);
  const actual = new Map(rows.map((row) => [row.id, row.permissions]));

  for (const name of gated) {
    const cmd = byName.get(name);
    const where = `${label}  /${name}`;

    if (!cmd) {
      console.log(`?? ${where}  not registered — run npm run deploy`);
      problems++;
      continue;
    }
    if (cmd.default_member_permissions !== '0') {
      console.log(`!! ${where}  registered visible to everyone (no default_member_permissions "0")`);
      problems++;
      continue;
    }

    const verdict = compare(guild.id, name, actual.get(cmd.id) ?? []);
    const name_ = (id) => (id === String(guild.id) ? '@everyone' : id);

    if (verdict.ok) {
      console.log(`ok ${where}  allow ${verdict.want.map(name_).join(', ') || '(nobody)'}`);
      continue;
    }

    problems++;
    const details = [];
    if (verdict.missing.length) details.push(`missing ${verdict.missing.map(name_).join(', ')}`);
    if (verdict.extra.length) details.push(`also allowed ${verdict.extra.map(name_).join(', ')}`);
    console.log(`-- ${where}  ${details.join(' · ')}`);
  }
}

if (problems) {
  console.log(
    `\n${problems} row(s) need attention:\n` +
      '  grant the missing roles in Server Settings -> Integrations -> the app -> Manage\n' +
      '  (Discord only accepts these writes from a user token, not from the bot)',
  );
} else {
  console.log('\nok: every gated command matches the config');
}
process.exit(problems ? 1 : 0);
