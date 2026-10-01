import { guildConfig } from './config.js';

// Role gate, per guild AND per command.
//
//   1. commandRoles.<command>  (non-empty) -> only those roles
//   2. operatorRoleIds         (non-empty) -> only those roles
//   3. neither                             -> everybody may operate
//
// An empty list means "not set" at that level, so `commandRoles: { "rcon": [] }`
// inherits `operatorRoleIds` instead of opening the command to everybody.
//
// `commandRoles.<command>` REPLACES the operator list for that command (it is
// not intersected with it), so a guild can give `/start` to moderators while
// keeping `/rcon` for admins only.
//
// Returns null when the command is unrestricted.
export function requiredRoles(guildId, commandName) {
  if (!guildId) return null;
  const cfg = guildConfig(guildId);

  const perCommand = commandName ? cfg.commandRoles?.[commandName] : null;
  if (Array.isArray(perCommand) && perCommand.length > 0) return perCommand;

  const operators = cfg.operatorRoleIds;
  return Array.isArray(operators) && operators.length > 0 ? operators : null;
}

// Without a command name it answers the broad question ("is this member an
// operator?"); with one, commandRoles for that command applies.
export function isOperator(member, commandName = null) {
  if (!member?.guild?.id) return false;
  const roles = requiredRoles(member.guild.id, commandName);
  if (!roles) return true;
  return member.roles.cache.some((role) => roles.includes(role.id));
}
