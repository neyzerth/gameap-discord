// Pure part of the Discord-side visibility of the gated commands.
//
// The commands are registered with `default_member_permissions: "0"` (see
// src/deploy-commands.js), which means Discord shows them only to members with
// the Administrator flag — and the bot itself opens them to whoever the guild
// allows through `commandRoles` / `operatorRoleIds`. Those roles reach Discord
// as per-guild permission overwrites, and this is the only place where a role
// id can be expressed: `default_member_permissions` only takes permission bits.
//
// `src/sync-permissions.js` PUTs the result; nothing here touches the network.

import { requiredRoles } from './permissions.js';

// ApplicationCommandPermissionType.ROLE
export const ROLE = 1;

// Overwrites a guild needs for one gated command. An unrestricted command (no
// roles configured) allows @everyone, whose id in this API is the guild id.
export function overwritesFor(guildId, commandName) {
  const roles = requiredRoles(guildId, commandName);
  const ids = roles ?? [String(guildId)];
  return ids.map((id) => ({ id: String(id), type: ROLE, permission: true }));
}
