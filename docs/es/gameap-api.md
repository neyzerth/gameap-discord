[English](../gameap-api.md) · **Español**

# La API de GameAP que usa el bot

Todo el tráfico va por HTTP contra el panel. El bot **no** habla con el daemon ni con los puertos
de juego, y **no** abre ningún puerto: usa `GAMEAP_API_URL` (por defecto `http://127.0.0.1:8025`).

## Autenticación

El panel acepta el PAT en la cabecera `Authorization`, con el esquema `Bearer`:

```bash
curl -s http://127.0.0.1:8025/api/servers \
  -H "Authorization: Bearer $GAMEAP_TOKEN"
```

- El PAT se genera en el panel: **Perfil → API tokens** (Personal Access Tokens), eligiendo las
  abilities de la tabla de abajo.
- `src/gameap.js` toma el token de `GAMEAP_TOKEN` y **nunca** lo loguea (los logs solo muestran
  mensajes y códigos de estado).
- Token inválido/expirado → el panel responde 401/403 y el bot propaga el mensaje del panel.

## Abilities necesarias

| Ability | Para qué |
|---|---|
| `server:list` | `/servers` |
| `server:start` | `/start` |
| `server:stop` | `/stop` |
| `server:restart` | `/restart` |
| `server:rcon-players` | `/players`, `/status`, watcher |
| `server:rcon-console` | `/rcon` |

Si falta una ability, el comando correspondiente falla con el error del panel (403).

## Endpoints

| Método y ruta | Devuelve | Lo usa |
|---|---|---|
| `GET /api/servers?page=1&per_page=50` | `{ data: [ { id, name, game_id, server_ip, server_port, ... } ] }` | `/servers` |
| `GET /api/servers/{id}/status` | `{ processActive: boolean, ... }` | `/status`, `/players`, control, watcher |
| `POST /api/servers/{id}/start` | `{ task_id }` | `/start` |
| `POST /api/servers/{id}/stop` | `{ task_id }` | `/stop` |
| `POST /api/servers/{id}/restart` | `{ task_id }` | `/restart` |
| `GET /api/servers/{id}/rcon/features` | `{ rcon, playersManage, playersList, playersKick, playersBan }` | `/status`, `/players`, watcher |
| `GET /api/servers/{id}/rcon/players` | `[ { id, name, score, ping, ip } ]` | `/players`, `/status`, watcher |
| `POST /api/servers/{id}/rcon` con `{ "command": "list" }` | `{ output: "..." }` | `/rcon` |

El `task_id` de start/stop/restart es el de la tarea del daemon: el bot lo muestra en el pie del
embed (`Daemon task #123`) y sigue el estado por `status` hasta 120 s.

## Por qué no hay webhooks

GameAP v4 no expone webhooks (0 coincidencias en el código del panel). Los eventos del plugin WASM
cubren `SERVER_POST_START`, `SERVER_POST_STOP`, `SERVER_POST_RESTART`, tareas del daemon, nodos y
usuarios, pero **no** hay evento de entrada/salida de jugadores. Por eso la detección de
entradas/salidas vive en el bot, con polling de `rcon/players` (ver [feed.md](feed.md)).

Si algún día aparece un webhook de jugadores, el punto de entrada a cambiar es el ciclo de
`src/watcher.js`: la lógica de diff/fan-out ya está separada en `src/state.js` y `src/embeds.js`.

## Manejo de errores en el cliente

`src/gameap.js` centraliza todo:

- `AbortSignal.timeout(15000)` → si el panel no contesta en 15 s, la promesa rechaza.
- La respuesta se parsea como JSON; si no es JSON, se devuelve `{ raw: texto }`.
- `!res.ok` → `Error` con `.status` (código HTTP) y el mensaje del panel
  (`error` o `message` del cuerpo, si existen). Ese `.status` se muestra en los embeds de error
  (`RCON failed: 422 ...`) y en los logs (`no player data (500) ...`).
- El watcher trata cualquier fallo como `unknown` (silencio) y consulta `status` solo para
  distinguir "está apagado" de "el panel/RCON falló".

## Cómo probar la API a mano

```bash
# estado y jugadores
curl -s http://127.0.0.1:8025/api/servers/8/status  -H "Authorization: Bearer $GAMEAP_TOKEN"
curl -s http://127.0.0.1:8025/api/servers/8/rcon/players -H "Authorization: Bearer $GAMEAP_TOKEN"

# un comando RCON (equivalente a /rcon mc-survival list)
curl -s -X POST http://127.0.0.1:8025/api/servers/8/rcon \
  -H "Authorization: Bearer $GAMEAP_TOKEN" -H 'Content-Type: application/json' \
  -d '{"command":"list"}'
```

Referencias: documentación oficial <https://docs.gameap.com/> y la especificación OpenAPI del
panel (`openapi.yaml` en `/srv/gameap`).
