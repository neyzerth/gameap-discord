import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_GRACE_HOURS,
  DEFAULT_POLL_MS,
  MAX_CONTENT,
  dueEvents,
  eventKey,
  normalizeEventConfig,
  parseAt,
  pruneSent,
  sentKey,
} from './events.js';

const AT = '2026-10-23T20:00:00-07:00';
const AT_MS = Date.parse(AT);
const CH_A = '111111111111111111';
const CH_B = '222222222222222222';

const config = (overrides = {}) => ({ enabled: true, events: [{ at: AT, channels: [CH_A], content: '🎃' }], ...overrides });

// --- parseAt ---------------------------------------------------------------

test('parseAt: ISO con offset, ISO sin offset, epoch y basura', () => {
  assert.equal(parseAt(AT).getTime(), AT_MS);
  // Sin offset se interpreta en la hora local del contenedor: por eso el doc pide el offset.
  assert.equal(parseAt('2026-10-23T20:00:00').getTime(), new Date('2026-10-23T20:00:00').getTime());
  assert.equal(parseAt(AT_MS).getTime(), AT_MS);
  assert.equal(parseAt(new Date(AT_MS)).getTime(), AT_MS);
  assert.equal(parseAt('mañana'), null);
  assert.equal(parseAt(''), null);
  assert.equal(parseAt(null), null);
  assert.equal(parseAt(new Date('nope')), null);
});

// --- normalizeEventConfig --------------------------------------------------

test('normalizeEventConfig: sin enabled:true la función está apagada', () => {
  assert.equal(normalizeEventConfig(null), null);
  assert.equal(normalizeEventConfig({}), null);
  assert.equal(normalizeEventConfig({ enabled: false, events: [{ at: AT, channels: [CH_A], content: '🎃' }] }), null);
  assert.equal(normalizeEventConfig('{"enabled":true}'), null);
});

test('normalizeEventConfig: defaults de poll y gracia, y los respeta si vienen', () => {
  const cfg = normalizeEventConfig(config());
  assert.equal(cfg.pollMs, DEFAULT_POLL_MS);
  assert.equal(cfg.graceMs, DEFAULT_GRACE_HOURS * 3_600_000);
  assert.deepEqual(cfg.problems, []);

  const custom = normalizeEventConfig(config({ pollMs: 5000, graceHours: 0 }));
  assert.equal(custom.pollMs, 5000);
  assert.equal(custom.graceMs, 0);

  // Un valor absurdo cae al default en vez de romper el tick.
  const junk = normalizeEventConfig(config({ pollMs: -1, graceHours: 'mucho' }));
  assert.equal(junk.pollMs, DEFAULT_POLL_MS);
  assert.equal(junk.graceMs, DEFAULT_GRACE_HOURS * 3_600_000);
});

test('normalizeEventConfig: canales como string, array, duplicados y vacíos', () => {
  const cfg = normalizeEventConfig(
    config({ events: [{ at: AT, channels: [CH_A, CH_A, '  ', CH_B], content: '🎃' }] }),
  );
  assert.deepEqual(cfg.events[0].channels, [CH_A, CH_B]);

  const single = normalizeEventConfig(config({ events: [{ at: AT, channels: CH_A, content: '🎃' }] }));
  assert.deepEqual(single.events[0].channels, [CH_A]);
});

test('normalizeEventConfig: entradas inválidas se descartan y se reportan', () => {
  const cfg = normalizeEventConfig({
    enabled: true,
    events: [
      { at: 'no es fecha', channels: [CH_A], content: '🎃' },
      { at: AT, channels: [], content: '🎃' },
      { at: AT, channels: [CH_A], content: '   ' },
      { at: AT, channels: [CH_A], content: 'x'.repeat(MAX_CONTENT + 1) },
      'basura',
      { at: AT, channels: [CH_B], content: '🎃' },
    ],
  });
  assert.equal(cfg.events.length, 1);
  assert.equal(cfg.events[0].channels[0], CH_B);
  assert.equal(cfg.problems.length, 5);
  assert.match(cfg.problems[0], /events\[0\]\.at/);
  assert.match(cfg.problems[1], /channels/);
  assert.match(cfg.problems[2], /content: empty/);
  assert.match(cfg.problems[3], /over Discord/);
});

test('normalizeEventConfig: sin entradas válidas devuelve null; ordena por hora', () => {
  assert.equal(normalizeEventConfig({ enabled: true, events: [] }), null);
  assert.equal(normalizeEventConfig({ enabled: true }), null);

  const cfg = normalizeEventConfig({
    enabled: true,
    events: [
      { at: '2026-10-31T20:00:00-07:00', channels: [CH_A], content: 'b' },
      { at: AT, channels: [CH_A], content: 'a' },
    ],
  });
  assert.deepEqual(
    cfg.events.map((e) => e.content),
    ['a', 'b'],
  );
  assert.equal(cfg.events[0].atMs, AT_MS);
});

// --- keys ------------------------------------------------------------------

test('las llaves son estables y una por canal', () => {
  const cfg = normalizeEventConfig(config({ events: [{ at: AT, channels: [CH_A, CH_B], content: '🎃' }] }));
  const event = cfg.events[0];
  assert.equal(event.key, eventKey({ at: event.at, content: '🎃' }));
  assert.equal(event.key, eventKey({ at: new Date(AT_MS), content: '🎃' }));
  assert.notEqual(sentKey(event, CH_A), sentKey(event, CH_B));
  assert.ok(sentKey(event, CH_A).startsWith(event.key));
});

// --- dueEvents -------------------------------------------------------------

test('dueEvents: antes de la hora no manda nada', () => {
  const cfg = normalizeEventConfig(config());
  const { due, expired } = dueEvents(cfg, AT_MS - 1000, []);
  assert.deepEqual(due, []);
  assert.deepEqual(expired, []);
});

test('dueEvents: a la hora exacta y dentro de la gracia sí manda', () => {
  const cfg = normalizeEventConfig(config());
  assert.equal(dueEvents(cfg, AT_MS, []).due.length, 1);
  assert.equal(dueEvents(cfg, AT_MS + 6 * 3_600_000, []).due.length, 1);
  assert.equal(dueEvents(cfg, AT_MS + cfg.graceMs, []).due.length, 1);
});

test('dueEvents: fuera de la gracia se reporta como perdido, no se manda', () => {
  const cfg = normalizeEventConfig(config());
  const { due, expired } = dueEvents(cfg, AT_MS + cfg.graceMs + 1, []);
  assert.deepEqual(due, []);
  assert.equal(expired.length, 1);
  assert.equal(expired[0].event.content, '🎃');
  assert.ok(expired[0].lateMs > cfg.graceMs);

  // graceHours: 0 → solo la hora exacta cuenta.
  const strict = normalizeEventConfig(config({ graceHours: 0 }));
  assert.equal(dueEvents(strict, AT_MS, []).due.length, 1);
  assert.equal(dueEvents(strict, AT_MS + 1, []).expired.length, 1);
});

test('dueEvents: lo ya marcado no se repite, y el marcado es por canal', () => {
  const cfg = normalizeEventConfig(config({ events: [{ at: AT, channels: [CH_A, CH_B], content: '🎃' }] }));
  const event = cfg.events[0];

  const first = dueEvents(cfg, AT_MS + 1000, [sentKey(event, CH_A)]);
  assert.deepEqual(
    first.due.map((d) => d.channelId),
    [CH_B],
  );

  const second = dueEvents(cfg, AT_MS + 1000, [sentKey(event, CH_A), sentKey(event, CH_B)]);
  assert.deepEqual(second.due, []);
  assert.deepEqual(second.expired, []);
});

test('dueEvents: varios eventos salen en orden cronológico', () => {
  const later = '2026-10-31T20:00:00-07:00';
  // Gracia amplia a propósito: si no, el de octubre ya estaría fuera de la ventana.
  const cfg = normalizeEventConfig({
    enabled: true,
    graceHours: 200,
    events: [
      { at: later, channels: [CH_A], content: 'segundo' },
      { at: AT, channels: [CH_A], content: 'primero' },
    ],
  });
  const { due } = dueEvents(cfg, Date.parse(later) + 1000, []);
  assert.deepEqual(
    due.map((d) => d.event.content),
    ['primero', 'segundo'],
  );
});

// --- pruneSent -------------------------------------------------------------

test('pruneSent: suelta llaves viejas y conserva las recientes y las rotas', () => {
  const day = 24 * 3_600_000;
  const now = Date.parse('2026-12-01T00:00:00Z');
  const old = sentKey({ at: new Date(now - 90 * day), content: 'x' }, CH_A);
  const recent = sentKey({ at: new Date(now - 2 * day), content: 'x' }, CH_B);
  const future = sentKey({ at: new Date(now + 5 * day), content: 'x' }, CH_A);
  const junk = 'llave-sin-fecha';

  const kept = pruneSent([old, recent, future, junk], now);
  assert.deepEqual(kept, [recent, future, junk]);
  assert.deepEqual(pruneSent(null, now), []);
  assert.deepEqual(pruneSent([], now), []);
});
