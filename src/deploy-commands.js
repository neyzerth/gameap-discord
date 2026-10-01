#!/usr/bin/env node
// Registers the slash commands with Discord.
//   node --env-file=.env src/deploy-commands.js            -> global (works in every guild)
//   node --env-file=.env src/deploy-commands.js --guild ID -> instant, single guild
//
// The gated commands (registry.js GATED_COMMANDS) are registered with
// `default_member_permissions: "0"`: Discord hides them from every member
// without the Administrator flag, and `npm run sync:permissions` grants each
// guild the roles its config says. Until that sync runs, only admins see them.

import { REST, Routes } from 'discord.js';
import { deployBody, loadCommands } from './registry.js';
import { resolveAppId } from './discord-app.js';

const { DISCORD_TOKEN } = process.env;
if (!DISCORD_TOKEN) {
  console.error('DISCORD_TOKEN is required');
  process.exit(1);
}

const commands = await loadCommands();
const body = deployBody(commands);

const rest = new REST().setToken(DISCORD_TOKEN);
const appId = await resolveAppId(rest);

const guildArgIndex = process.argv.indexOf('--guild');
// No DISCORD_GUILD_ID fallback on purpose: that variable is a convenience for other
// tooling, and silently registering per-guild while globals exist is what produces
// duplicated commands in the client. Guild registration must be explicit.
const guildId = guildArgIndex > -1 ? process.argv[guildArgIndex + 1] : null;

if (guildId) {
  console.warn(
    'note: guild registration replaces that guild\'s command set. Do not keep both a global and a guild\n' +
      '      registration of the same commands: Discord clients can then show each command twice.',
  );
}

const route = guildId
  ? Routes.applicationGuildCommands(appId, guildId)
  : Routes.applicationCommands(appId);

const result = await rest.put(route, { body });
console.log(
  `Registered ${result.length} commands ${guildId ? `in guild ${guildId}` : 'globally'}: ${result
    .map((c) => `/${c.name}`)
    .join(' ')}`,
);
if (result.some((c) => c.default_member_permissions === '0')) {
  console.log(
    'Gated commands are hidden from every non-admin until each guild gets its roles:\n' +
      '  npm run sync:permissions',
  );
}
