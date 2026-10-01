import './test-config.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { __setConfig } = await import('./config.js');
const { isOperator, requiredRoles } = await import('./permissions.js');

const SERVERS = { 8: { alias: 'mc-survival', announce: true } };

function fakeMember(roleIds, guildId = 'g1') {
  return {
    guild: { id: guildId },
    roles: { cache: { some: (fn) => roleIds.map((id) => ({ id })).some(fn) } },
  };
}

const withGuilds = (guilds, defaults = {}) => __setConfig(SERVERS, { defaults, guilds });
const restore = () => __setConfig(SERVERS, { defaults: {}, guilds: {} });

test('nothing configured: every command is open', () => {
  restore();
  assert.equal(requiredRoles('g1', 'rcon'), null);
  assert.equal(isOperator(fakeMember([])), true);
  assert.equal(isOperator(fakeMember([], 'unknown-guild'), 'rcon'), true);
});

test('operatorRoleIds gates the command it is asked about', () => {
  withGuilds({ g1: { operatorRoleIds: ['role-op'] } });
  assert.equal(isOperator(fakeMember([]), 'rcon'), false);
  assert.equal(isOperator(fakeMember(['role-op']), 'rcon'), true);
  assert.equal(isOperator(fakeMember(['role-other']), 'rcon'), false);
  restore();
});

test('commandRoles gives one command its own roles, the rest keeps operatorRoleIds', () => {
  withGuilds({ g1: { operatorRoleIds: ['role-op'], commandRoles: { rcon: ['role-admin'] } } });

  // /rcon: only the admin role, the operator role is not enough
  assert.deepEqual(requiredRoles('g1', 'rcon'), ['role-admin']);
  assert.equal(isOperator(fakeMember(['role-op']), 'rcon'), false);
  assert.equal(isOperator(fakeMember(['role-admin']), 'rcon'), true);

  // anything else still follows operatorRoleIds
  assert.deepEqual(requiredRoles('g1', 'start'), ['role-op']);
  assert.equal(isOperator(fakeMember(['role-op']), 'start'), true);
  assert.equal(isOperator(fakeMember(['role-admin']), 'start'), false);
  restore();
});

test('commandRoles can widen a command beyond the operator list', () => {
  withGuilds({ g1: { operatorRoleIds: ['role-admin'], commandRoles: { start: ['role-mod'] } } });
  assert.equal(isOperator(fakeMember(['role-mod']), 'start'), true);
  assert.equal(isOperator(fakeMember(['role-mod']), 'stop'), false);
  assert.equal(isOperator(fakeMember(['role-admin']), 'stop'), true);
  restore();
});

test('an empty list means "not set" and inherits, it never opens the command', () => {
  withGuilds({ g1: { operatorRoleIds: ['role-op'], commandRoles: { rcon: [] } } });
  assert.deepEqual(requiredRoles('g1', 'rcon'), ['role-op']);
  assert.equal(isOperator(fakeMember([]), 'rcon'), false);
  restore();
});

test('a command without a name uses the operator list', () => {
  withGuilds({ g1: { operatorRoleIds: ['role-op'], commandRoles: { rcon: ['role-admin'] } } });
  assert.equal(isOperator(fakeMember(['role-op'])), true);
  assert.equal(isOperator(fakeMember([])), false);
  restore();
});

test('defaults are inherited by guilds that do not declare the field', () => {
  __setConfig(SERVERS, {
    defaults: { operatorRoleIds: ['role-default'], commandRoles: { rcon: ['role-admin'] } },
    guilds: { g1: {}, g2: { commandRoles: { rcon: ['role-g2'] } } },
  });

  assert.deepEqual(requiredRoles('g1', 'rcon'), ['role-admin']);
  assert.deepEqual(requiredRoles('g1', 'start'), ['role-default']);
  assert.deepEqual(requiredRoles('g2', 'rcon'), ['role-g2'], 'the guild list replaces the default one for that command');
  assert.deepEqual(requiredRoles('g2', 'start'), ['role-default']);
  restore();
});

test('a member outside a guild is never an operator', () => {
  restore();
  assert.equal(isOperator(null, 'start'), false);
  assert.equal(isOperator({ roles: { cache: { some: () => false } } }, 'start'), false);
});

function fakeAdmin(roleIds, { guildId = 'g1', admin = true } = {}) {
  return {
    guild: { id: guildId },
    roles: { cache: { some: (fn) => roleIds.map((id) => ({ id })).some(fn) } },
    permissions: admin === null ? undefined : { has: () => admin },
  };
}

test('the Administrator flag opens every gated command by default', () => {
  withGuilds({ g1: { operatorRoleIds: ['role-op'], commandRoles: { rcon: ['role-admin'] } } });
  assert.equal(isOperator(fakeAdmin([]), 'rcon'), true);
  assert.equal(isOperator(fakeAdmin([], { admin: false }), 'rcon'), false);
  restore();
});

test('adminBypass false makes the roles mandatory again, even for admins', () => {
  withGuilds({ g1: { operatorRoleIds: ['role-op'], adminBypass: false } });
  assert.equal(isOperator(fakeAdmin([]), 'start'), false);
  assert.equal(isOperator(fakeAdmin(['role-op'], { admin: true }), 'start'), true);
  restore();
});

test('a member without the permissions field never bypasses the gate', () => {
  withGuilds({ g1: { operatorRoleIds: ['role-op'] } });
  assert.equal(isOperator(fakeAdmin([], { admin: null }), 'start'), false);
  restore();
});
