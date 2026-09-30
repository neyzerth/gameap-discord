**English** · [Español](es/gameap-api.md)

# The GameAP API the bot uses

All traffic goes over HTTP to the panel. The bot does **not** talk to the daemon or to the game
ports, and it **does not** open any port: it uses `GAMEAP_API_URL` (by default `http://127.0.0.1:8025`).

## Authentication

The panel accepts the PAT in the `Authorization` header, with the `Bearer` scheme:

```bash
curl -s http://127.0.0.1:8025/api/servers \
  -H "Authorization: Bearer ***"
```

- The PAT is generated in the panel: **Profile → API tokens** (Personal Access Tokens), choosing the
  abilities from the table below.
- `src/gameap.js` takes the token from `GAMEAP_TOKEN` and **never** logs it (the logs only show
  messages and status codes).
- Invalid/expired token → the panel answers 401/403 and the bot relays the panel's message.

## Required PAT abilities

| Ability | Used for |
|---|---|
| `server:list` | `/servers` |
| `server:start` | `/start` |
| `server:stop` | `/stop` |
| `server:restart` | `/restart` |
| `server:rcon-players` | `/players`, `/status`, watcher |
| `server:rcon-console` | `/rcon` |

If an ability is missing, the corresponding command fails with the panel's error (403).

## Endpoints

| Method and route | Returns | Used by |
|---|---|---|
| `GET /api/servers?page=1&per_page=50` | `{ data: [ { id, name, game_id, server_ip, server_port, ... } ] }` | `/servers` |
| `GET /api/servers/{id}/status` | `{ processActive: boolean, ... }` | `/status`, `/players`, control, watcher |
| `POST /api/servers/{id}/start` | `{ task_id }` | `/start` |
| `POST /api/servers/{id}/stop` | `{ task_id }` | `/stop` |
| `POST /api/servers/{id}/restart` | `{ task_id }` | `/restart` |
| `GET /api/servers/{id}/rcon/features` | `{ rcon, playersManage, playersList, playersKick, playersBan }` | `/status`, `/players`, watcher |
| `GET /api/servers/{id}/rcon/players` | `[ { id, name, score, ping, ip } ]` | `/players`, `/status`, watcher |
| `POST /api/servers/{id}/rcon` with `{ "command": "list" }` | `{ output: "..." }` | `/rcon` |

The `task_id` of start/stop/restart is the daemon task id: the bot shows it in the footer of the
embed (`Daemon task #123`) and follows the state via `status` for up to 120 s.

## Why there are no webhooks

GameAP v4 does not expose webhooks (0 matches in the panel code). The WASM plugin events
cover `SERVER_POST_START`, `SERVER_POST_STOP`, `SERVER_POST_RESTART`, daemon tasks, nodes and
users, but there is **no** player join/leave event. That is why join/leave detection lives in
the bot, with polling of `rcon/players` (see [feed.md](feed.md)).

If a player webhook ever appears, the entry point to change is the `src/watcher.js` loop: the
diff/fan-out logic is already separated into `src/state.js` and `src/embeds.js`.

## Error handling in the client

`src/gameap.js` centralizes everything:

- `AbortSignal.timeout(15000)` → if the panel does not answer within 15 s, the promise rejects.
- The response is parsed as JSON; if it is not JSON, `{ raw: text }` is returned.
- `!res.ok` → `Error` with `.status` (HTTP code) and the panel's message
  (`error` or `message` from the body, if they exist). That `.status` is shown in the error embeds
  (`RCON failed: 422 ...`) and in the logs (`no player data (500) ...`).
- The watcher treats any failure as `unknown` (silent) and only queries `status` to
  distinguish "it is stopped" from "the panel/RCON failed".

## How to test the API by hand

```bash
# status and players
curl -s http://127.0.0.1:8025/api/servers/8/status  -H "Authorization: Bearer ***"
curl -s http://127.0.0.1:8025/api/servers/8/rcon/players -H "Authorization: Bearer ***"

# an RCON command (equivalent to /rcon mc-survival list)
curl -s -X POST http://127.0.0.1:8025/api/servers/8/rcon \
  -H "Authorization: Bearer ***" -H 'Content-Type: application/json' \
  -d '{"command":"list"}'
```

References: official documentation <https://docs.gameap.com/> and the panel's OpenAPI
specification (`openapi.yaml` in `/srv/gameap`).