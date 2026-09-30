import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'gameap-bot-state-'));
process.env.STATE_FILE = join(dir, 'state.json');
process.env.FEEDS_STATE_FILE = join(dir, 'feeds.json');
process.env.AUTOSTOP_FILE = join(dir, 'autostop.json');

const { diff, load, save, loadFeeds, saveFeeds, loadAutoStop, saveAutoStop, getState, recordControl } =
  await import('./state.js');

test('first poll is a silent baseline', () => {
  const result = diff(undefined, ['A', 'B']);
  assert.deepEqual(result, { joins: [], leaves: [], baseline: true });
});

test('detects joins and leaves between two polls', () => {
  const result = diff({ initialized: true, players: ['A', 'B'] }, ['B', 'C']);
  assert.deepEqual(result.joins, ['C']);
  assert.deepEqual(result.leaves, ['A']);
  assert.equal(result.baseline, false);
});

test('no changes means no announcements', () => {
  const result = diff({ initialized: true, players: ['A'] }, ['A']);
  assert.deepEqual(result.joins, []);
  assert.deepEqual(result.leaves, []);
});

test('state round-trips through disk with the expected shape', () => {
  const state = load();
  assert.deepEqual(state.servers, {});
  assert.deepEqual(state.feeds, {});

  state.servers['8'] = { players: ['A'], initialized: true, unknown: false };
  save(state);

  const reloaded = load();
  assert.deepEqual(reloaded.servers['8'].players, ['A']);
  assert.equal(reloaded.servers['8'].initialized, true);
});

test('feed overrides round-trip through disk', () => {
  assert.deepEqual(loadFeeds(), {});
  saveFeeds({ 'g1:8': { on: true, channelId: 'chan' } });
  assert.deepEqual(loadFeeds(), { 'g1:8': { on: true, channelId: 'chan' } });
});

test('autostop overrides round-trip through disk', () => {
  assert.deepEqual(loadAutoStop(), {});
  saveAutoStop({ '8': { hours: 2, warnMinutes: 10 } });
  assert.deepEqual(loadAutoStop(), { '8': { hours: 2, warnMinutes: 10 } });
});

test('getState memoizes: watcher and commands share one object', () => {
  const a = getState();
  const b = getState();
  assert.equal(a, b, 'mismo objeto en memoria');
  // refleja lo que hay en disco (el test anterior guardó el servidor 8)
  assert.deepEqual(a.servers['8'].players, ['A']);
});

test('recordControl stamps the grace marker on the shared state', () => {
  const st = recordControl('8', 'start', 1_700_000_000_000);
  assert.equal(st.lastControlAt, 1_700_000_000_000);
  assert.equal(st.lastControlAction, 'start');
  assert.equal(getState().servers['8'].lastControlAt, 1_700_000_000_000);
  assert.equal(recordControl('nuevo', 'restart', 1).players !== undefined, true);
});
