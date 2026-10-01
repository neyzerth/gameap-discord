import './test-config.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  __setConfig, guildConfig, resolveServer, canUseServer, feedTarget, isAnnounceOn, pollTargets, setOverrides,
  setAutoStopOverrides, autoStopConfig, localeFor, localeSource, setLocaleOverrides,
} = await import('./config.js');
const { t } = await import('./i18n/index.js');

const SERVERS = {
  8: { alias: 'mc-survival', label: 'MC Survival', announce: true },
  2: { alias: 'oceanblock', label: 'OceanBlock' },
};

const GUILDS = {
  defaults: { operatorRoleIds: [], feedChannelId: null, servers: null, locale: 'en' },
  guilds: {
    g1: { feedChannelId: 'chan-default', feeds: { 8: 'chan-eight' }, servers: ['8'], locale: 'es-MX' },
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

test('locale resolution: /language override > guild > defaults > base', () => {
  setLocaleOverrides({});
  assert.equal(localeFor('g1'), 'es-MX'); // the guild sets its own language
  assert.equal(localeSource('g1'), 'guild');
  assert.equal(localeFor('g2'), 'en'); // no guild value: falls back to defaults
  assert.equal(localeSource('g2'), 'defaults');

  setLocaleOverrides({ g1: 'en' }); // what /language would write
  assert.equal(localeFor('g1'), 'en');
  assert.equal(localeSource('g1'), 'override');
  setLocaleOverrides({});
});

test('an unsupported locale is skipped, never half-served', () => {
  setLocaleOverrides({ g1: 'de', g2: 'klingon' });
  assert.equal(localeFor('g1'), 'es-MX', 'the override is ignored, the guild value applies');

  __setConfig(SERVERS, { defaults: {}, guilds: { g2: {} } });
  assert.equal(localeFor('g2'), 'en', 'no locale anywhere: base language');
  assert.equal(localeSource('g2'), 'base');

  __setConfig(SERVERS, GUILDS);
  setLocaleOverrides({});
});

test('locale tags are tolerated in any case or separator, region variants resolve', () => {
  setLocaleOverrides({ g1: 'es_mx' });
  assert.equal(localeFor('g1'), 'es-MX');

  setLocaleOverrides({ g1: 'es-AR' });
  assert.equal(localeFor('g1'), 'es-AR', 'the tag the user asked for is kept');
  assert.equal(t(localeFor('g1'), 'errors.commandFailed', { message: 'boom' }), 'El comando falló: boom');

  setLocaleOverrides({});
});

test('DEFAULT_LOCALE is the last resort before the base language', () => {
  const before = process.env.DEFAULT_LOCALE;
  process.env.DEFAULT_LOCALE = 'es-MX';
  __setConfig(SERVERS, { defaults: {}, guilds: { g2: {} } });

  assert.equal(localeFor('g2'), 'es-MX');
  assert.equal(localeSource('g2'), 'env');

  if (before === undefined) delete process.env.DEFAULT_LOCALE;
  else process.env.DEFAULT_LOCALE = before;
  __setConfig(SERVERS, GUILDS);
});
