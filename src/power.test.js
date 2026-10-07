import './test-config.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {
  EMOJI_RE,
  GAME_TEXT_KEYS,
  RCON_MAX_BYTES,
  decidePower,
  formatOutage,
  newPowerState,
  normalizePowerConfig,
  parseUpsStatus,
  rconPipeline,
  tellrawChunks,
} from './power.js';
import { parseListVars, parseVarLine, readUpsVars } from './nut.js';
import { t } from './i18n/index.js';

// --- parseUpsStatus ---------------------------------------------------------

test('ups.status: OL/OB/LB y lo que no se reconoce', () => {
  assert.equal(parseUpsStatus('OL'), 'online');
  assert.equal(parseUpsStatus('OL CHRG'), 'online');
  assert.equal(parseUpsStatus('OB DISCHRG'), 'onBattery');
  assert.equal(parseUpsStatus('OB LB DISCHRG'), 'low');
  assert.equal(parseUpsStatus('ob'), 'onBattery');
  assert.equal(parseUpsStatus('RB'), 'unknown');
  assert.equal(parseUpsStatus('LOW BATTERY'), 'unknown');
  assert.equal(parseUpsStatus(''), 'unknown');
  assert.equal(parseUpsStatus(null), 'unknown');
});

// --- decidePower ------------------------------------------------------------

test('la primera lectura en batería anuncia el corte una sola vez', () => {
  const first = decidePower(null, 'onBattery', 1000);
  assert.deepEqual(first.actions, ['outage']);
  assert.equal(first.state.obSince, 1000);
  assert.equal(first.state.stage1At, 1000);

  const second = decidePower(first.state, 'onBattery', 2000);
  assert.deepEqual(second.actions, []);
  assert.equal(second.state.stage1At, 1000);
});

test('batería baja se anuncia una sola vez', () => {
  const outage = decidePower(null, 'onBattery', 1000);
  const low = decidePower(outage.state, 'low', 2000);
  assert.deepEqual(low.actions, ['low']);
  assert.equal(low.state.stage2At, 2000);
  assert.deepEqual(decidePower(low.state, 'low', 3000).actions, []);
});

test('de en línea a batería baja dispara las dos etapas en orden', () => {
  const r = decidePower(newPowerState(), 'low', 500);
  assert.deepEqual(r.actions, ['outage', 'low']);
});

test('volver la luz reporta duración y si el servidor quedó apagado', () => {
  let st = decidePower(null, 'onBattery', 1000).state;
  st = decidePower(st, 'low', 2000).state;
  st.stoppedAt = 2500;

  const back = decidePower(st, 'online', 3_700_000);
  assert.deepEqual(back.actions, ['restored']);
  assert.equal(back.durationMs, 3_699_000);
  assert.equal(back.stopped, true);
  assert.equal(back.state.obSince, null, 'el episodio queda cerrado');
  assert.equal(back.state.stoppedAt, null);
});

test('un estado ilegible no anuncia nada ni toca el estado', () => {
  const st = decidePower(null, 'low', 1000).state;
  const r = decidePower(st, 'unknown', 2000);
  assert.deepEqual(r.actions, []);
  assert.equal(r.state.obSince, 1000);
  assert.equal(r.state.stage1At, 1000);
  assert.equal(r.state.stage2At, 1000);
});

test('en línea sin corte previo no anuncia nada (primer arranque)', () => {
  assert.deepEqual(decidePower(null, 'online', 1000).actions, []);
  assert.deepEqual(decidePower(newPowerState(), 'online', 1000).actions, []);
});

test('si el bot reinicia en pleno corte, el regreso sí se anuncia', () => {
  const persisted = { status: 'low', obSince: 1000, stage1At: 1000, stage2At: 1000, stoppedAt: 1500 };
  const r = decidePower(persisted, 'online', 61_000);
  assert.deepEqual(r.actions, ['restored']);
  assert.equal(r.durationMs, 60_000);
  assert.equal(r.stopped, true);
});

// --- normalizePowerConfig ---------------------------------------------------

test('sin enabled: true (o incompleta) la función queda apagada', () => {
  assert.equal(normalizePowerConfig(null), null);
  assert.equal(normalizePowerConfig({ enabled: false, nut: { ups: 'u' }, servers: ['1'] }), null);
  assert.equal(normalizePowerConfig({ enabled: true }), null);
  assert.equal(normalizePowerConfig({ enabled: true, servers: ['1'] }), null);
  assert.equal(normalizePowerConfig({ enabled: true, nut: { ups: 'u' }, servers: [] }), null);
});

test('los valores se normalizan y se acotan', () => {
  const cfg = normalizePowerConfig({
    enabled: true,
    nut: { ups: 'myups' },
    servers: [9],
    pollMs: 999_999,
    stopDelayMs: -5,
  });
  assert.deepEqual(cfg.nut, { host: '127.0.0.1', port: 3493, ups: 'myups', timeoutMs: 3000 });
  assert.equal(cfg.pollMs, 60_000);
  assert.equal(cfg.stopDelayMs, 0);
  assert.deepEqual(cfg.servers, ['9']);
  assert.equal(cfg.notifyEveryoneOnLowBattery, true);
  assert.equal(cfg.lowBatteryMention, '@everyone');
  assert.equal(cfg.stopServersOnLowBattery, true);
  assert.equal(cfg.dryRun, false);
});

test('POWER_DRY_RUN y los interruptores se respetan', () => {
  const cfg = normalizePowerConfig(
    {
      enabled: true,
      nut: { ups: 'u' },
      servers: ['1'],
      notifyEveryoneOnLowBattery: false,
      stopServersOnLowBattery: false,
    },
    { POWER_DRY_RUN: 'true' },
  );
  assert.equal(cfg.dryRun, true);
  assert.equal(cfg.notifyEveryoneOnLowBattery, false);
  assert.equal(cfg.stopServersOnLowBattery, false);
});

// --- rconPipeline -----------------------------------------------------------

const chatLines = (lines) => lines.filter((line) => line.startsWith('tellraw @a '));
const chatText = (lines) =>
  chatLines(lines)
    .flatMap((line) => JSON.parse(line.replace('tellraw @a ', '')).map((c) => c.text))
    .join(' ');

test('el pipeline del juego lleva title, el chat y el save-all al final', () => {
  const lines = rconPipeline('es-MX', 'outage');
  assert.equal(lines[0], 'title @a times 10 100 20');
  assert.match(lines[1], /^title @a title \{/);
  assert.match(lines[2], /^title @a subtitle \{/);
  assert.equal(lines.at(-1), 'save-all flush');

  // Los componentes deben ser JSON válido o el server rechaza el comando.
  JSON.parse(lines[1].replace('title @a title ', ''));
  JSON.parse(lines[2].replace('title @a subtitle ', ''));
  for (const line of chatLines(lines)) JSON.parse(line.replace('tellraw @a ', ''));

  const said = chatText(lines);
  assert.match(said, /Se fue la luz en la casa\./);
  assert.match(said, /guarda lo que estés haciendo/);
  // Cada línea del chat corta en fin de oración, no a media frase.
  for (const line of chatLines(lines)) {
    const chunk = JSON.parse(line.replace('tellraw @a ', '')).map((c) => c.text).join(' ');
    assert.match(chunk, /[.:;!?]$/, `corte a media oración: ${chunk}`);
  }
  assert.deepEqual(rconPipeline('es-MX', 'restored'), []);
});

test('la etapa 2 avisa que se apaga en segundos', () => {
  const lines = rconPipeline('es-MX', 'low');
  assert.match(lines[1], /Batería baja/);
  assert.match(chatText(lines), /se apagará en unos segundos/);
  assert.equal(lines.at(-1), 'save-all flush');
});

// El panel rechaza comandos de más de 127 caracteres: este test es el que impide
// volver a mandar un tellraw demasiado largo (pasó en la prueba real del 2026-10-06).
test('ninguna línea del pipeline pasa del límite del panel (127 bytes)', () => {
  for (const locale of ['en', 'es-MX']) {
    for (const stage of ['outage', 'low']) {
      for (const line of rconPipeline(locale, stage)) {
        const bytes = Buffer.byteLength(line, 'utf8');
        assert.ok(bytes <= RCON_MAX_BYTES, `${locale}/${stage}: ${bytes} bytes → ${line.slice(0, 60)}`);
      }
    }
  }
});

test('un aviso largo se parte en varios tellraw sin perder palabras ni estilo', () => {
  const long = 'palabra '.repeat(80).trim();
  const lines = tellrawChunks([
    { text: long, color: 'gold', bold: true },
    { text: 'final del aviso', color: 'yellow' },
  ]);

  assert.ok(lines.length > 1, 'debe partirse en varias líneas');
  for (const line of lines) {
    assert.ok(Buffer.byteLength(line, 'utf8') <= RCON_MAX_BYTES, line);
    JSON.parse(line.replace('tellraw @a ', ''));
  }

  const words = chatText(lines).split(/\s+/);
  assert.equal(words.length, 83); // 80 + "final del aviso"
  assert.equal(words[0], 'palabra');
  assert.equal(words.slice(-3).join(' '), 'final del aviso');

  const first = JSON.parse(lines[0].replace('tellraw @a ', ''));
  assert.equal(first[0].color, 'gold');
  assert.equal(first[0].bold, true);
});

test('los textos del juego no llevan emoji (Minecraft los pinta como tofu)', () => {
  for (const locale of ['en', 'es-MX']) {
    for (const key of GAME_TEXT_KEYS) {
      assert.equal(EMOJI_RE.test(t(locale, key)), false, `${locale} · ${key}`);
    }
  }
});

// --- formatOutage -----------------------------------------------------------

test('formatOutage', () => {
  assert.equal(formatOutage(0), '0s');
  assert.equal(formatOutage(45_000), '45s');
  assert.equal(formatOutage(90_000), '1m');
  assert.equal(formatOutage(3_600_000), '1h 00m');
  assert.equal(formatOutage(7_500_000), '2h 05m');
});

// --- NUT --------------------------------------------------------------------

test('parseVarLine y parseListVars', () => {
  const reply =
    'BEGIN LIST VAR myups\n' +
    'VAR myups ups.status "OB DISCHRG"\n' +
    'VAR myups battery.charge "87"\n' +
    'END LIST VAR myups\n';
  assert.deepEqual(parseListVars(reply), { 'ups.status': 'OB DISCHRG', 'battery.charge': '87' });
  assert.deepEqual(parseVarLine('VAR u ups.load "12"'), { ups: 'u', name: 'ups.load', value: '12' });
  assert.equal(parseVarLine('BEGIN LIST VAR u'), null);
});

test('readUpsVars filtra lo pedido (servidor NUT falso)', async () => {
  const server = net.createServer((socket) => {
    socket.on('data', () => {
      socket.write(
        'BEGIN LIST VAR myups\n' +
          'VAR myups ups.status "OL"\n' +
          'VAR myups battery.charge "100"\n' +
          'VAR myups battery.runtime "3600"\n' +
          'VAR myups ups.load "12"\n' +
          'END LIST VAR myups\n',
      );
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const res = await readUpsVars(['ups.status', 'battery.charge'], {
      ups: 'myups',
      host: '127.0.0.1',
      port,
      timeoutMs: 2000,
    });
    assert.equal(res.ok, true);
    assert.equal(res.status, 'OL');
    assert.deepEqual(res.vars, { 'ups.status': 'OL', 'battery.charge': '100' });
  } finally {
    server.close();
  }
});

test('readUpsVars: un ERR de upsd es un fallo, no un dato', async () => {
  const server = net.createServer((socket) => {
    socket.on('data', () => socket.write('ERR UNKNOWN-UPS\n'));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const res = await readUpsVars(['ups.status'], { ups: 'nope', host: '127.0.0.1', port, timeoutMs: 2000 });
    assert.equal(res.ok, false);
    assert.match(res.error, /UNKNOWN-UPS/);
  } finally {
    server.close();
  }
});

test('readUpsVars: sin respuesta ni nombre de UPS nunca lanza', async () => {
  assert.equal((await readUpsVars(['ups.status'], { ups: '' })).ok, false);

  const silent = net.createServer(() => {});
  await new Promise((resolve) => silent.listen(0, '127.0.0.1', resolve));
  const { port } = silent.address();
  try {
    const res = await readUpsVars(['ups.status'], { ups: 'myups', host: '127.0.0.1', port, timeoutMs: 300 });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'timeout');
  } finally {
    silent.close();
  }
});

// --- embeds -----------------------------------------------------------------

test('los embeds de energía salen en el idioma del guild', async () => {
  const { powerLowEmbed, powerMessage, powerOutageEmbed, powerRestoredEmbed } = await import('./embeds.js');

  const outage = powerOutageEmbed('es-MX', { label: 'MC Server', charge: '87', runtime: '2h 05m' }).toJSON();
  assert.equal(outage.title, '⚡ Se fue la luz');
  assert.match(outage.description, /\*\*MC Server\*\*/);
  assert.deepEqual(outage.fields.map((f) => f.value), ['87%', '2h 05m']);

  const unknown = powerOutageEmbed('es-MX', { label: 'MC Server' }).toJSON();
  assert.deepEqual(unknown.fields.map((f) => f.value), ['—', '—']);

  assert.match(powerLowEmbed('es-MX', { label: 'MC Server' }).toJSON().title, /Batería baja/);
  assert.equal(powerOutageEmbed('en', { label: 'MC Server' }).toJSON().title, '⚡ Mains power lost');

  const back = powerRestoredEmbed('es-MX', { duration: '1h 30m', alias: 'mc-survival' }).toJSON();
  assert.match(back.description, /Corte de \*\*1h 30m\*\*/);
  assert.doesNotMatch(back.description, /\/start/);

  const stopped = powerRestoredEmbed('es-MX', { duration: '1h 30m', alias: 'mc-survival', stopped: true }).toJSON();
  assert.match(stopped.description, /\/start mc-survival/);
});

test('el ping es opt-in y va con allowedMentions explícito', async () => {
  const { powerLowEmbed, powerMessage } = await import('./embeds.js');
  const embed = powerLowEmbed('es-MX', { label: 'MC Server' });

  const quiet = powerMessage(embed);
  assert.equal(quiet.content, undefined);
  assert.deepEqual(quiet.allowedMentions, { parse: [] });

  const loud = powerMessage(embed, { mention: '@everyone' });
  assert.equal(loud.content, '@everyone');
  assert.deepEqual(loud.allowedMentions.parse, ['everyone', 'roles', 'users']);
  assert.equal(loud.embeds.length, 1);
});

// --- config (muta la config inyectada: deja este test al final) --------------

test('powerChannel respeta la allowlist y cae al canal del feed', async () => {
  const config = await import('./config.js');
  config.__setConfig(
    { '9': { alias: 'mc-survival' } },
    {
      defaults: {},
      guilds: {
        111: { servers: ['9'], feedChannelId: 'the-feed' },
        333: { servers: ['8'], feedChannelId: 'other-feed' },
      },
    },
  );

  config.__setPowerConfig({ enabled: true, channels: { 111: 'explicit' } });
  assert.equal(config.powerChannel('111', '9'), 'explicit');

  config.__setPowerConfig({ enabled: true, channels: {} });
  assert.equal(config.powerChannel('111', '9'), 'the-feed');
  assert.equal(config.powerChannel('333', '9'), null, 'guild que no ve el server');

  config.__setPowerConfig({ enabled: true, nut: { ups: 'myups' }, servers: ['9'] });
  assert.equal(config.powerConfig().nut.ups, 'myups');

  config.__setPowerConfig(null);
  assert.equal(config.powerConfig(), null, 'sin archivo el vigilante no arranca');
});
