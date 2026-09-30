import { guildConfig } from './config.js';

// operatorRoleIds: []  -> everybody may operate (current setup: trusted friends)
// operatorRoleIds: [id] -> the member must have one of those roles
export function isOperator(member) {
  const guildId = member?.guild?.id;
  if (!guildId) return false;
  const roles = guildConfig(guildId).operatorRoleIds ?? [];
  if (!Array.isArray(roles) || roles.length === 0) return true;
  return member.roles.cache.some((role) => roles.includes(role.id));
}
