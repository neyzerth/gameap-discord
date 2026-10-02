// Pure part of the Discord-side visibility of the gated commands.
//
// The commands are registered with `default_member_permissions: "0"` (see
// src/deploy-commands.js), which means Discord shows them only to members with
// the Administrator flag — and the bot itself opens them to whoever the guild
// allows through `commandRoles` / `operatorRoleIds`. Those roles reach Discord
// as per-guild permission overwrites, and this is the only place where a role
// id can be expressed: `default_member_permissions` only takes permission bits.
//
// `src/check-permissions.js` compares the result against what Discord reports;
// nothing here touches the network — and nothing can write these from a bot:
// the API answers 403 "Bots cannot use this endpoint" (it wants a user token
// with the `applications.commands.permissions.update` scope), so the grants are
// made in the client by a guild admin. See docs/operations.md.

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

// What a guild should allow for a command vs what Discord reports for it.
// `actual` is the API's own array: [{ id, type, permission }], where `permission`
// false means explicitly denied (not an allow).
export function compare(guildId, commandName, actual = []) {
  const want = overwritesFor(guildId, commandName).map((p) => String(p.id));
  const have = (Array.isArray(actual) ? actual : [])
    .filter((p) => p?.permission)
    .map((p) => String(p.id));
  const missing = want.filter((id) => !have.includes(id));
  const extra = have.filter((id) => !want.includes(id));
  return { ok: missing.length === 0 && extra.length === 0, want, have, missing, extra };
}
