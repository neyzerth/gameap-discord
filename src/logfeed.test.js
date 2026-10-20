import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createLogSource, parsePlayerEvent, playersSinceRunStart } from './logfeed.js';

const line = (ts, name, what) =>
  `[${ts}] [Server thread/INFO] [net.minecraft.server.MinecraftServer/]: ${name} ${what} the game`;

test('parsePlayerEvent reads joins and leaves', () => {
  assert.deepEqual(parsePlayerEvent(line('20Oct2026 11:35:56.482', 'ChosArt', 'joined')), {
    type: 'join',
    name: 'ChosArt',
  });
  assert.deepEqual(parsePlayerEvent(line('20Oct2026 12:41:56.507', 'YoyiGamer12', 'left')), {
    type: 'leave',
    name: 'YoyiGamer12',
  });
});

test('parsePlayerEvent ignores everything else, including RCON noise and chat', () => {
  const noise = [
    '[20Oct2026 12:56:33.891] [RCON Listener #2/INFO] [net.minecraft.server.rcon.thread.GenericThread/]: Thread RCON Client /10.0.5.2 started',
    '[20Oct2026 12:56:33.892] [RCON Client /10.0.5.2 #893/INFO] [net.minecraft.server.rcon.thread.RconClient/]: Thread RCON Client /10.0.5.2 shutting down',
    '<alice> bob joined the game yesterday',
    '[20Oct2026 08:00:21.549] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer/]: Done (1.424s)! For help, type "help"',
    '',
  ];
  for (const entry of noise) assert.equal(parsePlayerEvent(entry), null, entry);
});

test('playersSinceRunStart only trusts the current run', () => {
  const text = [
    // Previous run: alice was online when it ended; she must not count.
    line('19Oct2026 10:00:00.000', 'alice', 'joined'),
    line('19Oct2026 10:10:00.000', 'bob', 'joined'),
    line('19Oct2026 10:20:00.000', 'bob', 'left'),
    // New run
    '[20Oct2026 08:00:21.549] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer/]: Done (1.424s)! For help, type "help"',
    line('20Oct2026 11:35:56.482', 'carol', 'joined'),
    line('20Oct2026 11:36:56.482', 'dave', 'joined'),
    line('20Oct2026 11:37:56.482', 'carol', 'left'),
  ].join('\n');

  assert.deepEqual(playersSinceRunStart(text), ['dave']);
});

test('playersSinceRunStart tolerates a run that has not finished starting', () => {
  const text = [
    line('19Oct2026 10:00:00.000', 'alice', 'joined'),
    '[20Oct2026 08:00:00.100] [main/INFO] [cpw.mods.modlauncher.Launcher/MODLAUNCHER]: ModLauncher running',
  ].join('\n');
  assert.deepEqual(playersSinceRunStart(text), ['alice']);
});

test('createLogSource baselines once and then follows the file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'logfeed-'));
  const file = join(dir, 'latest.log');
  try {
    writeFileSync(
      file,
      [
        '[20Oct2026 08:00:21.549] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer/]: Done (1.424s)! For help, type "help"',
        line('20Oct2026 11:35:56.482', 'alice', 'joined'),
      ].join('\n') + '\n',
    );

    const source = createLogSource(file);
    assert.deepEqual(source.read(), ['alice']);

    appendFileSync(file, line('20Oct2026 11:40:00.000', 'bob', 'joined') + '\n');
    assert.deepEqual(source.read().sort(), ['alice', 'bob']);

    appendFileSync(file, line('20Oct2026 11:41:00.000', 'alice', 'left') + '\n');
    assert.deepEqual(source.read(), ['bob']);

    // Nothing new: same answer, no duplicate events.
    assert.deepEqual(source.read(), ['bob']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createLogSource keeps a partial line for the next read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'logfeed-'));
  const file = join(dir, 'latest.log');
  try {
    writeFileSync(file, line('20Oct2026 11:35:56.482', 'alice', 'joined') + '\n');
    const source = createLogSource(file);
    assert.deepEqual(source.read(), ['alice']);

    // A write can land in the middle of a line: the name is not complete yet.
    const pending = line('20Oct2026 11:40:00.000', 'bob', 'joined');
    appendFileSync(file, pending.slice(0, 30));
    assert.deepEqual(source.read(), ['alice']);

    appendFileSync(file, pending.slice(30) + '\n');
    assert.deepEqual(source.read().sort(), ['alice', 'bob']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createLogSource re-baselines when the server restarts (file replaced)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'logfeed-'));
  const file = join(dir, 'latest.log');
  try {
    writeFileSync(
      file,
      [
        line('20Oct2026 09:00:00.000', 'alice', 'joined'),
        line('20Oct2026 09:10:00.000', 'bob', 'joined'),
      ].join('\n') + '\n',
    );
    const source = createLogSource(file);
    assert.deepEqual(source.read().sort(), ['alice', 'bob']);

    // Restart: the old log is rotated away and latest.log starts empty.
    writeFileSync(file, '');
    assert.deepEqual(source.read(), []);

    appendFileSync(file, line('20Oct2026 10:00:00.000', 'carol', 'joined') + '\n');
    assert.deepEqual(source.read(), ['carol']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createLogSource throws when the log is gone, so the caller can mark it unknown', () => {
  const dir = mkdtempSync(join(tmpdir(), 'logfeed-'));
  try {
    const source = createLogSource(join(dir, 'missing.log'));
    assert.throws(() => source.read(), /ENOENT/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
