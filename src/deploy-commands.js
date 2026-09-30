#!/usr/bin/env node
// Registers the slash commands with Discord.
//   node --env-file=.env src/deploy-commands.js            -> global (works in every guild)
//   node --env-file=.env src/deploy-commands.js --guild ID -> instant, single guild
//
// The application id is resolved from the token (authoritative) instead of
// trusting DISCORD_APP_ID, which is easy to confuse with the guild id.

import { REST, Routes } from 'discord.js';
import { loadCommands } from './registry.js';

const { DISCORD_TOKEN } = process.env;
if (!DISCORD_TOKEN) {
  console.error('DISCORD_TOKEN is required');
  process.exit(1);
}

const commands = await loadCommands();
const body = [...commands.values()].map((mod) => mod.data.toJSON());

const rest = new REST().setToken(DISCORD_TOKEN);

let appId = process.env.DISCORD_APP_ID;
try {
  const me = await rest.get(Routes.currentApplication());
  if (appId && appId !== me.id) {
    console.warn(`DISCORD_APP_ID (${appId}) does not match the token's application; using ${me.id}`);
  }
  appId = me.id;
} catch (err) {
  console.warn(`could not resolve the application id from the token (${err.message}); using DISCORD_APP_ID`);
}
if (!appId) {
  console.error('no application id available');
  process.exit(1);
}

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
