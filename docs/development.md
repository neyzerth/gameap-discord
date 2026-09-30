**English** · [Español](es/development.md)

# Development

## Requirements

- Node **>=22** (uses ESM, global `fetch`, `--env-file`, and `node --test`).
- `npm install` once in `/opt/gameap-discord-bot`.

```bash
npm test                  # 19 tests, no network or Discord
npm run deploy            # registers the global commands (needs .env)
npm start                 # run the bot outside Docker (needs .env in the environment)
docker compose up -d --build
```

## Code map

```
src/
  index.js           discord.js client, interaction router, guildCreate, shutdown
  registry.js        loads src/commands/*.js + usageOf() for help
  config.js          multi-guild resolution (alias, visibility, feed, overrides)
  permissions.js     isOperator() based on operatorRoleIds
  gameap.js          panel HTTP client (15 s timeout)
  watcher.js         polling cycle and announce decision
  autostop.js        pure idle clock (resolveAutoStop, accumulateIdle, evaluateIdle)
  state.js           persistence (state.json, feeds.json, autostop.json) and pure diff()
  embeds.js          status/control/confirm embeds, auto-stop notices, and fan-out
  help.js            general and per-command help, generated from live commands
  logger.js          leveled logging
  commands/          10 commands: help.js, servers.js, status.js, players.js, start.js,
                     stop.js, restart.js, rcon.js, feed.js, autostop.js
  *.test.js          state, config, autostop and help (44 cases)
docs/                this documentation
```

Golden rule: **no Discord logic inside `gameap.js`**, and no state-display logic inside
commands. Commands are thin: guard → resolve → call → embed.

## Adding a command (5 steps)

1. Create `src/commands/myCommand.js`:

```js
import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import { autocompleteServers, guardOperator, resolveServerOption } from '../control.js';
import { serverStatus } from '../gameap.js';
import { statusEmbed } from '../embeds.js';

export const data = new SlashCommandBuilder()
  .setName('myCommand')
  .setDescription('What it does, in one line (English)')
  .setContexts(InteractionContextType.Guild)
  .addStringOption((option) =>
    option.setName('server').setDescription('Server id or alias').setRequired(true).setAutocomplete(true),
  );

export const autocomplete = autocompleteServers;

export const help = {
  examples: ['/myCommand mc-survival'],
  notes: 'Anything a friend should know before using it.',
};

export async function execute(interaction) {
  if (!(await guardOperator(interaction))) return;      // only operators
  const serverId = await resolveServerOption(interaction);
  if (!serverId) return;

  await interaction.deferReply();
  const status = await serverStatus(serverId).catch(() => null);
  await interaction.editReply({ embeds: [statusEmbed(serverId, status, null, null)] });
}
```

2. Add it to a category in `CATEGORIES` in `src/help.js` (for the general help).
3. `npm test` — the help test fails if you forgot `help` or the category.
4. `npm run deploy` to register it on Discord (global).
5. `docker compose up -d --build` so the bot loads it (`loaded N commands`).

Conventions:

- One command per file; export `data`, `execute`, `help` and, when applicable, `autocomplete`.
- User-facing text **in English** (your server's friends use it); docs are bilingual — English first
  in `docs/`, Spanish mirror in `docs/es/`, with the root `README.md` / `README.es.md` pair.
- User errors with `MessageFlags.Ephemeral` when they're only for the invoker; result embeds are public.
- Information commands don't use `guardOperator`; control commands do.
- Commands use `setContexts(InteractionContextType.Guild)`: no DMs.

## Tests

`node --test src/*.test.js` (no network, no Discord):

| File | What it covers |
|---|---|
| `state.test.js` | `diff()` (joins/leaves/baseline), `state.json` and `feeds.json` round-trip |
| `config.test.js` | alias resolution, per-guild visibility, `feedTarget` precedence, `pollTargets` |
| `help.test.js` | that **all** commands have help and a category, `usageOf()` per command, that embeds build, and `/help` autocomplete |
| `autostop.test.js` | config resolution, clock accumulation/reset/freeze, warn/stop, duration format, `/autostop` contract and its embeds |

Tests inject config with `__setConfig()` (they don't touch the filesystem) and write to temporary
paths via `STATE_FILE`/`FEEDS_STATE_FILE`.

## Testing the feed without real players

Trick used to verify the whole chain (it works because the watcher compares against
`data/state.json`):

```bash
python3 - <<'PY'
import json
p = '/opt/gameap-discord-bot/data/state.json'
s = json.load(open(p))
s['servers'].setdefault('8', {})['players'] = ['alice']   # "someone was inside"
json.dump(s, open(p, 'w'), indent=2)
PY
docker restart gameap-bot          # starts quiet and, on the first poll, sees "left"
docker logs --tail 5 gameap-bot
```

With the real list empty, the bot publishes `🔴 left: alice` in the subscribed channels — that
verifies in one shot: the watcher, `feedTarget()`, channel permissions, and the embed format.
Delete the message afterwards if the channel is production.

**Two traps when testing auto-stop** (learned the hard way; read them before touching `state.json`):

1. **Injecting `idleMs` with `docker restart` doesn't work**: on SIGTERM the process **saves its
   in-memory state** and overwrites your edit. You have to `docker stop gameap-bot` → edit
   `state.json` → `docker start gameap-bot`.
2. **`AUTOSTOP_DRY_RUN=true` in `.env` doesn't apply with `docker restart`/`start`**: container
   variables are fixed when the container is **created**. After editing `.env` you have to
   `docker compose up -d --force-recreate`, and verify with
   `docker exec gameap-bot printenv AUTOSTOP_DRY_RUN` (empty = normal mode, **really stops**).

## Verifying command registration

```bash
# globals (forwards the bot token)
curl -s "https://discord.com/api/v10/applications/<APP_ID>/commands" -H "Authorization: Bot ***" \
  | python3 -c "import sys,json;print([c['name'] for c in json.load(sys.stdin)])"

# per guild (must be empty if you use global registration)
curl -s "https://discord.com/api/v10/applications/<APP_ID>/guilds/<GUILD_ID>/commands" -H "Authorization: Bot ***"
```

## Ideas for later (out of scope today)

- `/kick` and `/ban` using `rconFeatures().playersManage/playersKick/playersBan` (already read, not used).
- Direct link to the panel console in the footer of control embeds.
- Container healthcheck (for example, write a timestamp in `data/state.json` and check it).
- Automatic per-guild registration in `guildCreate` (today it only logs the new guild and asks
  you to edit `config/guilds.json`).
- i18n of texts into Spanish per guild, if your server's friends ask for it.
- Feed metrics (notices sent, failures) on a local endpoint.