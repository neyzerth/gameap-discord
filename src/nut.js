// Minimal read-only NUT (Network UPS Tools) client.
//
// upsd serves the UPS variables over a plain-text protocol on 127.0.0.1:3493 and
// answers reads WITHOUT credentials: only the commands (INSTCMD/SET) require a
// login. That is all this bot needs — "are we on battery?" — so there is no
// password here, no root and no `upsc` subprocess.
//
//   printf 'LIST VAR myups\n' | nc 127.0.0.1 3493
//   BEGIN LIST VAR myups
//   VAR myups ups.status "OB DISCHRG"
//   END LIST VAR myups

import net from 'node:net';

export const DEFAULT_NUT = { host: '127.0.0.1', port: 3493, timeoutMs: 3000 };

// 'VAR myups ups.status "OB DISCHRG"' -> { ups, name, value }
const RE_VAR = /^VAR\s+(\S+)\s+(\S+)\s+"?([^"]*)"?\s*$/;

export function parseVarLine(line) {
  const match = RE_VAR.exec(String(line ?? '').trim());
  if (!match) return null;
  const [, ups, name, value] = match;
  return { ups, name, value: value.trim() };
}

// Whole LIST VAR reply -> { 'ups.status': 'OB DISCHRG', 'battery.charge': '100' }
export function parseListVars(text) {
  const vars = {};
  for (const line of String(text ?? '').split('\n')) {
    const parsed = parseVarLine(line);
    if (parsed) vars[parsed.name] = parsed.value;
  }
  return vars;
}

const isEnd = (text) => /^END LIST VAR\b/m.test(text);
const errorLine = (text) => String(text ?? '').split('\n').find((line) => line.startsWith('ERR')) ?? null;

// Reads `names` (default: ups.status) from `ups`. Never throws: a broken, slow or
// missing upsd is reported as { ok: false }, because a failed read must never be
// mistaken for "the mains are gone".
export function readUpsVars(names, options = {}) {
  const { ups, host, port, timeoutMs } = { ...DEFAULT_NUT, ...options };
  const wanted = Array.isArray(names) && names.length ? names : ['ups.status'];

  return new Promise((resolve) => {
    if (!ups) {
      resolve({ ok: false, error: 'no ups name configured' });
      return;
    }

    const socket = net.createConnection({ host, port });
    let buffer = '';
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    const succeed = (text) => {
      const all = parseListVars(text);
      if (!Object.keys(all).length) {
        finish({ ok: false, error: 'empty reply' });
        return;
      }
      const vars = {};
      for (const name of wanted) {
        if (name in all) vars[name] = all[name];
      }
      finish({ ok: true, vars, status: all['ups.status'] ?? null });
    };

    socket.setTimeout(Number(timeoutMs) || DEFAULT_NUT.timeoutMs);
    socket.on('timeout', () => finish({ ok: false, error: 'timeout' }));
    socket.on('error', (err) => finish({ ok: false, error: err.code ?? err.message }));
    socket.on('connect', () => socket.write(`LIST VAR ${ups}\n`));

    socket.on('data', (chunk) => {
      buffer += String(chunk);
      const failure = errorLine(buffer);
      if (failure) {
        finish({ ok: false, error: failure.trim() });
        return;
      }
      if (isEnd(buffer)) succeed(buffer);
    });

    // upsd closes the connection after the reply; if the END marker never made it
    // into the buffer, salvage whatever arrived before giving up.
    socket.on('end', () => {
      if (!settled) succeed(buffer);
    });
    socket.on('close', () => {
      if (!settled) finish({ ok: false, error: 'connection closed' });
    });
  });
}
