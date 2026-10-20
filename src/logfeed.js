// Player events from the server log.
//
// The feed used to ask the panel for `rcon/players` every cycle. On Minecraft
// that costs a `list` command, and the server writes two lines per connection
// into its own log ("Thread RCON Client ... started" / "shutting down"). On a
// normal day those lines were ~75% of the console the panel shows, burying the
// real events.
//
// The log the server already writes is enough: it says who joined and who left,
// costs no RCON traffic and keeps working when the query is slow.
//
// Format (vanilla and NeoForge/Forge):
//   [20Oct2026 11:35:56.482] [Server thread/INFO] [net.minecraft.server.MinecraftServer/]: alice joined the game
//   [20Oct2026 12:41:56.507] [Server thread/INFO] [net.minecraft.server.MinecraftServer/]: alice left the game

import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs';

// Player names are [A-Za-z0-9_]{3,16}; anchored at the end so chat lines that
// happen to contain the phrase never count as events.
const JOIN = /([A-Za-z0-9_]{1,16}) joined the game\s*$/;
const LEAVE = /([A-Za-z0-9_]{1,16}) left the game\s*$/;
// Every successful start ends with this line. Anything before it belongs to a
// previous run, and its players cannot be trusted (they were disconnected when
// that run ended).
const RUN_START = /Done \([0-9.]+s\)! For help/;

export function parsePlayerEvent(line) {
  const join = JOIN.exec(line);
  if (join) return { type: 'join', name: join[1] };
  const leave = LEAVE.exec(line);
  if (leave) return { type: 'leave', name: leave[1] };
  return null;
}

// Players online according to the log of the current run (the text after the
// last "Done (...)" line). Pure: the same text always yields the same list.
export function playersSinceRunStart(text) {
  const lines = text.split('\n');
  let start = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (RUN_START.test(lines[i])) start = i + 1;
  }

  const players = new Set();
  for (let i = start; i < lines.length; i += 1) {
    const event = parsePlayerEvent(lines[i]);
    if (!event) continue;
    if (event.type === 'join') players.add(event.name);
    else players.delete(event.name);
  }
  return [...players];
}

// Incremental reader for one `latest.log`.
//
// - The first read (or the first read after the file is replaced or truncated,
//   which is what a server restart looks like) re-reads the whole file and
//   baselines from its last run start.
// - After that it only reads the bytes appended since the previous read, keeping
//   a partial last line for the next one (writes can split a line).
export function createLogSource(path) {
  let offset = 0;
  let ino = null;
  let primed = false;
  let carry = '';
  let players = new Set();

  const baseline = () => {
    const text = readFileSync(path, 'utf8');
    players = new Set(playersSinceRunStart(text));
    offset = Buffer.byteLength(text, 'utf8');
    carry = '';
    ino = statSync(path).ino;
    primed = true;
    return [...players];
  };

  const apply = (text) => {
    for (const line of text.split('\n')) {
      const event = parsePlayerEvent(line);
      if (!event) continue;
      if (event.type === 'join') players.add(event.name);
      else players.delete(event.name);
    }
  };

  return {
    read() {
      const info = statSync(path); // throws ENOENT: the caller marks the server unknown
      if (!primed || info.ino !== ino || info.size < offset) return baseline();
      if (info.size === offset) return [...players];

      const length = info.size - offset;
      const buffer = Buffer.allocUnsafe(length);
      const fd = openSync(path, 'r');
      try {
        readSync(fd, buffer, 0, length, offset);
      } finally {
        closeSync(fd);
      }
      offset = info.size;

      const text = carry + buffer.toString('utf8');
      const lastNewline = text.lastIndexOf('\n');
      carry = lastNewline === -1 ? text : text.slice(lastNewline + 1);
      if (lastNewline !== -1) apply(text.slice(0, lastNewline));
      return [...players];
    },
  };
}
