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

// Allowed ids in an API permissions array: `permission` false is an explicit
// deny, not an allow.
export function allowsIds(actual = []) {
  return (Array.isArray(actual) ? actual : [])
    .filter((p) => p?.permission)
    .map((p) => String(p.id));
}

// Discord stores the app-level entry (the "Manage" screen for the whole app)
// under the application id, and it applies to every command, so it is merged
// with the command's own entry.
export function actualFor(rows, appId, commandId) {
  const list = Array.isArray(rows) ? rows : [];
  const entry = (id) =>
    list.find((row) => String(row?.id) === String(id))?.permissions ?? [];
  return [...entry(appId), ...entry(commandId)];
}

// What a guild should allow for a command vs what Discord reports for it.
//
// A top-level @everyone allow is a legitimate way to make the command visible to
// the whole guild — that is what the "Manage" screen does by default — and then
// the roles are enforced by the bot, not by Discord. It counts as ok, flagged
// with `everyone: true` so the report can say so.
export function compare(guildId, commandName, actual = []) {
  const want = overwritesFor(guildId, commandName).map((p) => String(p.id));
  const have = allowsIds(actual);
  const everyone = have.includes(String(guildId));
  const extra = have.filter((id) => !want.includes(id) && id !== String(guildId));
  const missing = want.filter((id) => !have.includes(id) && !everyone);
  return { ok: extra.length === 0 && (everyone || missing.length === 0), want, have, everyone, missing, extra };
}
