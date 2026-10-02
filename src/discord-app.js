// The application id is resolved from the token (authoritative) instead of
// trusting DISCORD_APP_ID, which is easy to confuse with the guild id.
// Shared by src/deploy-commands.js and src/check-permissions.js.

import { Routes } from 'discord.js';

export async function resolveAppId(rest, env = process.env) {
  let appId = env.DISCORD_APP_ID;
  try {
    const me = await rest.get(Routes.currentApplication());
    if (appId && appId !== me.id) {
      console.warn(`DISCORD_APP_ID (${appId}) does not match the token's application; using ${me.id}`);
    }
    appId = me.id;
  } catch (err) {
    console.warn(`could not resolve the application id from the token (${err.message}); using DISCORD_APP_ID`);
  }
  if (!appId) throw new Error('no application id available');
  return appId;
}
