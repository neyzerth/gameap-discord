import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  __setConfig, guildConfig, resolveServer, canUseServer, feedTarget, isAnnounceOn, pollTargets, setOverrides,
  setAutoStopOverrides, autoStopConfig,
} = await import('./config.js');
const { isOperator } = await import('./permissions.js');

const SERVERS = {
  8: { alias: 'mc-survival', label: 'MC Survival', announce: true },
  2: { alias: 'oceanblock', label: 'OceanBlock' },
};

const GUILDS = {
  defaults: { operatorRoleIds: [], feedChannelId: null, servers: null },
  guilds: {
    g1: { feedChannelId: 'chan-default', feeds: { 8: 'chan-eight' }, servers: ['8'] },
    g2: { operatorRoleIds: ['role-op'] },
  },
};

__setConfig(SERVERS, GUILDS);
setOverrides({});

test('unknown guild falls back to defaults', () => {
  const cfg = guildConfig('nope');
  assert.deepEqual(cfg.operatorRoleIds, []);
  assert.equal(cfg.feedChannelId, null);
  assert.equal(cfg.servers, null);
});

test('guild config wins over defaults', () => {
  assert.equal(guildConfig('g1').feedChannelId, 'chan-default');
  assert.deepEqual(guildConfig('g2').operatorRoleIds, ['role-op']);
});

test('server resolution accepts id and alias', () => {
  assert.equal(resolveServer('mc-survival'), '8');
  assert.equal(resolveServer('8'), '8');
  assert.equal(resolveServer('MC-SURVIVAL'), '8');
  assert.equal(resolveServer('nope'), null);
});

test('server allowlist per guild', () => {
  assert.equal(canUseServer('g1', '8'), true);
  assert.equal(canUseServer('g1', '2'), false);
  assert.equal(canUseServer('g2', '2'), true); // defaults: all servers
});

test('feed target resolution: per-server channel, then guild channel, then none', () => {
  assert.equal(feedTarget('g1', '8'), 'chan-eight'); // feeds[8] wins over feedChannelId
  assert.equal(feedTarget('g2', '8'), null); // no announce target in g2
  assert.equal(isAnnounceOn('g1', '2'), false);
});

test('runtime /feed override can enable another server and pick a channel', () => {
  setOverrides({ 'g2:2': { on: true, channelId: 'chan-x' } });
  assert.equal(feedTarget('g2', '2'), 'chan-x');

  setOverrides({ 'g1:8': { on: false } });
  assert.equal(feedTarget('g1', '8'), null);

  setOverrides({});
});

test('poll targets are the servers flagged with announce', () => {
  setAutoStopOverrides({});
  assert.deepEqual(pollTargets(), ['8']);
});

test('poll targets include servers with autoStop even without announce', () => {
  __setConfig(
    { 8: { announce: true }, 2: { alias: 'oceanblock', autoStop: { hours: 2 } }, 4: {} },
    GUILDS,
  );
  setAutoStopOverrides({});
  assert.deepEqual(pollTargets().sort(), ['2', '8']);
});

test('poll targets follow an override that enables autostop', () => {
  __setConfig({ 8: { announce: true }, 2: {}, 4: {} }, GUILDS);
  setAutoStopOverrides({ 4: { hours: 1 } });
  assert.deepEqual(pollTargets().sort(), ['4', '8']);
  setAutoStopOverrides({});
  __setConfig(SERVERS, GUILDS);
});

test('autoStopConfig resolves override over config and normalises values', () => {
  __setConfig({ 8: { announce: true, autoStop: { hours: 2, warnMinutes: 15 } }, 2: {} }, GUILDS);
  setAutoStopOverrides({});

  assert.deepEqual(autoStopConfig('8'), { hours: 2, warnMinutes: 15, graceMinutes: 10, source: 'config' });
  assert.equal(autoStopConfig('2'), null);

  setAutoStopOverrides({ 8: { hours: '3', warnMinutes: '5' } });
  assert.deepEqual(autoStopConfig('8'), { hours: 3, warnMinutes: 5, graceMinutes: 10, source: 'override' });

  setAutoStopOverrides({ 8: { hours: 0 } });
  assert.equal(autoStopConfig('8'), null, 'hours 0 desactiva aunque la config lo active');

  setAutoStopOverrides({});
  __setConfig(SERVERS, GUILDS);
});

function fakeMember(roleIds) {
  return {
    guild: { id: 'g1' },
    roles: { cache: { some: (fn) => roleIds.map((id) => ({ id })).some(fn) } },
  };
}

test('empty operatorRoleIds means everyone may operate', () => {
  assert.equal(isOperator(fakeMember([])), true);
  assert.equal(isOperator(fakeMember(['anything'])), true);
});

test('with operatorRoleIds set, the role is required', () => {
  __setConfig(SERVERS, { defaults: {}, guilds: { g1: { operatorRoleIds: ['role-op'] } } });
  assert.equal(isOperator(fakeMember([])), false);
  assert.equal(isOperator(fakeMember(['role-op'])), true);
  __setConfig(SERVERS, GUILDS);
});
