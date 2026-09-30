import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BLIND_RESET_MS,
  accumulateIdle,
  evaluateIdle,
  formatDuration,
  newIdle,
  resolveAutoStop,
} from './autostop.js';

const MIN = 60_000;
const HOUR = 3_600_000;
const SERVERS = { '8': { autoStop: { hours: 2, warnMinutes: 15 } }, '2': {} };

// --- resolveAutoStop -------------------------------------------------------

test('el override de Discord gana sobre la config', () => {
  const cfg = resolveAutoStop('8', { servers: SERVERS, overrides: { '8': { hours: 1, warnMinutes: 5 } } });
  assert.deepEqual(cfg, { hours: 1, warnMinutes: 5, graceMinutes: 10, source: 'override' });
});

test('sin override se usa config/servers.json', () => {
  const cfg = resolveAutoStop('8', { servers: SERVERS, overrides: {} });
  assert.equal(cfg.hours, 2);
  assert.equal(cfg.warnMinutes, 15);
  assert.equal(cfg.source, 'config');
});

test('sin override ni config queda desactivado', () => {
  assert.equal(resolveAutoStop('2', { servers: SERVERS, overrides: {} }), null);
  assert.equal(resolveAutoStop('99', { servers: SERVERS, overrides: {} }), null);
});

test('hours <= 0 desactiva y los valores se acotan', () => {
  assert.equal(resolveAutoStop('8', { servers: SERVERS, overrides: { '8': { hours: 0 } } }), null);
  const cfg = resolveAutoStop('8', { servers: SERVERS, overrides: { '8': { hours: 500, warnMinutes: 999 } } });
  assert.equal(cfg.hours, 168);
  assert.equal(cfg.warnMinutes, 120);
});

test('warn 0 desactiva el aviso previo pero no el apagado', () => {
  const cfg = resolveAutoStop('8', { servers: SERVERS, overrides: { '8': { hours: 2, warnMinutes: 0 } } });
  assert.equal(cfg.warnMinutes, 0);
  // dentro de la ventana de aviso (10 min antes del umbral) no anuncia nada...
  assert.equal(evaluateIdle({ ...newIdle(), idleMs: 2 * HOUR - 10 * MIN }, cfg, { nowMs: 1e12 }).action, 'none');
  // ...pero al llegar al umbral sí apaga
  assert.equal(evaluateIdle({ ...newIdle(), idleMs: 2 * HOUR }, cfg, { nowMs: 1e12 }).action, 'stop');
});

// --- accumulateIdle --------------------------------------------------------

test('suma solo con evidencia: sondeo OK y 0 jugadores', () => {
  const a = accumulateIdle(newIdle(), { ok: true, players: [], active: true, deltaMs: 20_000 });
  assert.equal(a.idleMs, 20_000);
  const b = accumulateIdle(a, { ok: true, players: [], active: true, deltaMs: 20_000 });
  assert.equal(b.idleMs, 40_000);
});

test('idleSince se fija en el primer tick de inactividad', () => {
  const a = accumulateIdle(newIdle(), { ok: true, players: [], active: true, deltaMs: 20_000, nowMs: 1_000_000 });
  assert.equal(a.idleSince, 980_000);
});

test('si entra alguien se reinicia todo', () => {
  const prev = { ...newIdle(), idleMs: 5 * MIN, warnedAt: 123, idleSince: 1 };
  const a = accumulateIdle(prev, { ok: true, players: ['neyzer'], active: true, deltaMs: 20_000 });
  assert.deepEqual(a, newIdle());
});

test('servidor apagado (processActive false) no acumula credito', () => {
  const prev = { ...newIdle(), idleMs: 30 * MIN };
  const a = accumulateIdle(prev, { ok: false, players: null, active: false, deltaMs: 20_000 });
  assert.equal(a.idleMs, 0);
  assert.equal(a.idleSince, null);
});

test('sondeo fallido con panel activo congela y luego reinicia si queda ciego', () => {
  const frozen = accumulateIdle({ ...newIdle(), idleMs: 10 * MIN }, { ok: false, players: null, active: true, deltaMs: MIN });
  assert.equal(frozen.idleMs, 10 * MIN);
  assert.equal(frozen.blindMs, MIN);

  const tooBlind = accumulateIdle({ ...frozen, blindMs: BLIND_RESET_MS }, { ok: false, players: null, active: true, deltaMs: MIN });
  assert.equal(tooBlind.idleMs, 0);
});

test('un sondeo OK vuelve a poner blindMs en 0', () => {
  const a = accumulateIdle({ ...newIdle(), idleMs: 5 * MIN, blindMs: 30 * MIN }, { ok: true, players: [], active: true, deltaMs: MIN });
  assert.equal(a.blindMs, 0);
});

// --- evaluateIdle ---------------------------------------------------------

const CFG = { hours: 2, warnMinutes: 15, graceMinutes: 10 };

test('apagado cuando la inactividad alcanza el umbral', () => {
  const r = evaluateIdle({ idleMs: 2 * HOUR }, CFG, { nowMs: 1e12, lastControlMs: null });
  assert.equal(r.action, 'stop');
  assert.equal(r.remainingMs, 0);
});

test('aviso cuando falta menos que warnMinutes', () => {
  const r = evaluateIdle({ idleMs: HOUR + 50 * MIN, warnedAt: null }, CFG, { nowMs: 1e12, lastControlMs: null });
  assert.equal(r.action, 'warn');
  assert.equal(r.remainingMs, 10 * MIN);
});

test('no avisa dos veces en el mismo ciclo ni cuando warn es 0', () => {
  assert.equal(evaluateIdle({ idleMs: HOUR + 50 * MIN, warnedAt: 1 }, CFG, { nowMs: 1e12 }).action, 'none');
  assert.equal(evaluateIdle({ idleMs: HOUR + 50 * MIN, warnedAt: null }, { ...CFG, warnMinutes: 0 }, { nowMs: 1e12 }).action, 'none');
});

test('no dispara dentro de la gracia tras un control manual', () => {
  const r = evaluateIdle({ idleMs: 2 * HOUR }, CFG, { nowMs: 1e12, lastControlMs: 1e12 - MIN });
  assert.equal(r.action, 'none');
  const later = evaluateIdle({ idleMs: 2 * HOUR }, CFG, { nowMs: 1e12, lastControlMs: 1e12 - 11 * MIN });
  assert.equal(later.action, 'stop');
});

test('desactivado sin config o con hours 0, y sin inactividad no hace nada', () => {
  assert.equal(evaluateIdle({ idleMs: 9 * HOUR }, null, { nowMs: 1e12 }).action, 'none');
  assert.equal(evaluateIdle({ idleMs: 9 * HOUR }, { ...CFG, hours: 0 }, { nowMs: 1e12 }).action, 'none');
  assert.equal(evaluateIdle(newIdle(), CFG, { nowMs: 1e12 }).action, 'none');
});

// --- formatDuration -------------------------------------------------------

test('formatDuration', () => {
  assert.equal(formatDuration(0), '0m');
  assert.equal(formatDuration(3 * HOUR + 5 * MIN), '3h 05m');
  assert.equal(formatDuration(42 * MIN), '42m');
  assert.equal(formatDuration(2 * HOUR), '2h 00m');
});

// --- contrato del comando y de los embeds ---------------------------------

test('/autostop expone server, hours y warn (solo en guild)', async () => {
  const mod = await import('./commands/autostop.js');
  const json = mod.data.toJSON();

  assert.deepEqual(json.options.map((o) => o.name), ['server', 'hours', 'warn']);
  assert.equal(json.options[0].autocomplete, true);
  assert.equal(json.options[1].min_value, 0);
  assert.equal(json.options[1].max_value, 168);
  assert.equal(json.options[2].max_value, 120);
  assert.deepEqual(json.contexts, [0], 'solo en servidores de Discord');
  assert.ok(mod.help.examples.length >= 3);
  assert.ok(/hours:0/.test(mod.help.notes + mod.help.examples.join(' ')));
});

test('los embeds de auto-stop se construyen con el texto esperado', async () => {
  const { autostopWarningEmbed, autoStopEmbed, autostopStatusEmbed } = await import('./embeds.js');

  const warn = autostopWarningEmbed('8', HOUR + 50 * MIN, 10, { hours: 2, warnMinutes: 15 }).toJSON();
  assert.match(warn.description, /stopping in \*\*10m\*\*/);
  assert.match(warn.footer.text, /hours:0 to disable/);

  const stopped = autoStopEmbed('8', 2 * HOUR).toJSON();
  assert.match(stopped.description, /Stopped after \*\*2h 00m\*\*/);
  assert.match(stopped.footer.text, /\/start/);

  const dry = autoStopEmbed('8', 2 * HOUR, { dryRun: true }).toJSON();
  assert.match(dry.footer.text, /DRY RUN/);

  const off = autostopStatusEmbed('8', null).toJSON();
  assert.match(off.description, /Disabled/);

  const on = autostopStatusEmbed('8', { hours: 2, warnMinutes: 15, source: 'override' }, { idleMs: HOUR, minutesLeft: HOUR }).toJSON();
  assert.match(on.description, /with no players/);
  assert.ok(on.fields.some((f) => f.name === 'Stops in'));
});
