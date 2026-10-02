// The Discord-side visibility of the gated commands: which permission
// overwrites each guild gets, from its commandRoles / operatorRoleIds.
import './test-config.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { __setConfig } = await import('./config.js');
const { overwritesFor, compare, ROLE } = await import('./command-permissions.js');

const SERVERS = { 8: { alias: 'mc-survival' } };

const restore = () => __setConfig(SERVERS, { defaults: {}, guilds: {} });

test('a command with its own roles grants exactly those roles', () => {
  __setConfig(SERVERS, {
    defaults: {},
    guilds: { g1: { operatorRoleIds: ['role-op'], commandRoles: { rcon: ['role-admin'] } } },
  });
  assert.deepEqual(overwritesFor('g1', 'rcon'), [{ id: 'role-admin', type: ROLE, permission: true }]);
  restore();
});

test('a command without commandRoles grants the guild operator roles', () => {
  __setConfig(SERVERS, {
    defaults: {},
    guilds: { g1: { operatorRoleIds: ['role-op', 'role-op2'], commandRoles: { rcon: ['role-admin'] } } },
  });
  assert.deepEqual(overwritesFor('g1', 'start'), [
    { id: 'role-op', type: ROLE, permission: true },
    { id: 'role-op2', type: ROLE, permission: true },
  ]);
  restore();
});

test('an unrestricted command allows @everyone, whose id is the guild id', () => {
  restore();
  assert.deepEqual(overwritesFor('g1', 'rcon'), [{ id: 'g1', type: ROLE, permission: true }]);
});

test('an empty list inherits instead of allowing everyone', () => {
  __setConfig(SERVERS, {
    defaults: {},
    guilds: { g1: { operatorRoleIds: ['role-op'], commandRoles: { rcon: [] } } },
  });
  assert.deepEqual(overwritesFor('g1', 'rcon'), [{ id: 'role-op', type: ROLE, permission: true }]);
  restore();
});

test('numeric ids are sent as strings', () => {
  __setConfig(SERVERS, { defaults: {}, guilds: { 42: { operatorRoleIds: [123] } } });
  assert.deepEqual(overwritesFor(42, 'start'), [{ id: '123', type: ROLE, permission: true }]);
  restore();
});

test('defaults apply to a guild with no block of its own', () => {
  __setConfig(SERVERS, { defaults: { commandRoles: { rcon: ['role-default'] } }, guilds: { g9: {} } });
  assert.deepEqual(overwritesFor('g9', 'rcon'), [{ id: 'role-default', type: ROLE, permission: true }]);
  restore();
});

test('compare is ok when Discord already allows exactly the configured roles', () => {
  __setConfig(SERVERS, { defaults: {}, guilds: { g1: { operatorRoleIds: ['role-op'] } } });
  const verdict = compare('g1', 'start', [{ id: 'role-op', type: ROLE, permission: true }]);
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.missing, []);
  assert.deepEqual(verdict.extra, []);
  restore();
});

test('compare reports the missing grants the guild admin has to add', () => {
  restore(); // g1 is unrestricted: it needs @everyone, whose id is the guild id
  const verdict = compare('g1', 'start', []);
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.want, ['g1']);
  assert.deepEqual(verdict.missing, ['g1']);
});

test('compare flags grants that the config does not ask for', () => {
  __setConfig(SERVERS, { defaults: {}, guilds: { g1: { operatorRoleIds: ['role-op'] } } });
  const verdict = compare('g1', 'start', [
    { id: 'role-op', type: ROLE, permission: true },
    { id: 'role-extra', type: ROLE, permission: true },
  ]);
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.extra, ['role-extra']);
  assert.deepEqual(verdict.missing, []);
  restore();
});

test('an explicit deny is not an allow', () => {
  __setConfig(SERVERS, { defaults: {}, guilds: { g1: { operatorRoleIds: ['role-op'] } } });
  const verdict = compare('g1', 'start', [{ id: 'role-op', type: ROLE, permission: false }]);
  assert.equal(verdict.have.length, 0);
  assert.deepEqual(verdict.missing, ['role-op']);
  restore();
});
