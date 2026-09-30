# GameAP Discord bot

Bot de Discord para controlar los game servers del panel GameAP (encender, apagar,
reiniciar, ver jugadores por RCON) y anunciar en un canal aparte cuándo entra y
cuándo sale cada jugador.

Todo pasa por la **API HTTP del panel** con un PAT (API key). El bot nunca habla RCON
directo: el panel le pide al daemon que ejecute el RCON, por eso no hay que abrir
puertos de juego ni tocar UFW.

## Comandos

| Comando | Qué hace |
|---|---|
| `/servers` | Lista los servidores con su estado |
| `/status <server>` | Detalle: estado, jugadores, soporte RCON |
| `/start <server>` | Enciende (embed de progreso hasta que quede online) |
| `/stop <server>` | Apaga (pide confirmación con botones si hay jugadores) |
| `/restart <server>` | Reinicia (misma confirmación) |
| `/players <server>` | Jugadores en línea ahora |
| `/rcon <server> <command>` | Comando RCON crudo (`say hola`, `whitelist list`) |
| `/feed <server> on\|off` | Suscribe este canal al feed de entradas/salidas |
| `/autostop <server> [hours] [warn]` | Apaga el servidor solo si nadie juega N horas (por defecto 2 h; `hours:0` lo desactiva) |
| `/help [command]` | Guía general (o detalle + ejemplos de un comando) |

`<server>` acepta el id del panel o el alias de `config/servers.json`
(ej. `/start ludopatia`).

Todo el texto de `/help` se genera desde los comandos cargados (`src/registry.js` + `src/help.js`),
así que al añadir un comando nuevo solo hay que darle su `export const help = { examples, notes }`
y meterlo en una categoría de `src/help.js`; un test (`src/help.test.js`) falla si te olvidas.

## Documentación

La documentación completa (arquitectura, comandos, configuración, feed, API de GameAP, operación y
guía de desarrollo) está en [`docs/`](docs/README.md) — con diagramas Mermaid, que se renderizan en
GitHub/GitLab y en VS Code, no en Discord.

| Doc | Tema |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Piezas, flujos y por qué de cada decisión |
| [docs/commands.md](docs/commands.md) | Los 10 comandos y sus errores |
| [docs/configuration.md](docs/configuration.md) | `.env`, los 5 JSON y la precedencia del feed |
| [docs/feed.md](docs/feed.md) | Watcher y reglas anti-spam |
| [docs/autostop.md](docs/autostop.md) | Auto-apagado por inactividad (`/autostop`) y modo dry-run |
| [docs/gameap-api.md](docs/gameap-api.md) | Endpoints y abilities del PAT |
| [docs/operations.md](docs/operations.md) | Desplegar, rotar credenciales, troubleshooting |
| [docs/development.md](docs/development.md) | Código, tests y cómo añadir un comando |

## Archivos

```
compose.yaml / Dockerfile      contenedor (network_mode: host)
.env                           secretos (DISCORD_TOKEN, GAMEAP_TOKEN) — chmod 600
config/servers.json            catálogo: alias, label, emoji, announce, autoStop
config/guilds.json             por guild: canal de feed, roles operadores, servidores visibles
data/state.json                estado del watcher (jugadores conocidos + reloj de inactividad)
data/feeds.json                overrides de /feed (no toca la config versionada)
data/autostop.json             overrides de /autostop (por servidor)
src/                           código (gameap.js, watcher.js, autostop.js, control.js, config.js, commands/)
```

## Operación

```bash
cd /opt/dockge/stacks/gameap-bot
docker compose up -d --build      # levantar / actualizar
docker logs -f gameap-bot         # ver qué hace
docker compose restart            # recargar config/servers.json y config/guilds.json
docker compose down               # parar
```

Registrar los comandos en Discord (solo hace falta al añadir o cambiar comandos):

```bash
node --env-file=.env src/deploy-commands.js                        # global (recomendado)
node --env-file=.env src/deploy-commands.js --guild <GUILD_ID>      # instantáneo en un guild
```

**No registres los dos a la vez**: tener el mismo comando global *y* por guild hace que Discord muestre
duplicados en algunos clientes. Este bot usa **global** como única fuente (el registro por guild ya se
vació en ambos guilds). Si alguna vez registras por guild, borra el global con
`PUT /applications/{app_id}/commands` con cuerpo `[]`, y viceversa.

Si el cliente sigue mostrando comandos duplicados o viejos: `Ctrl+R` en Discord (cachea la lista) y revisa
*Developer Portal → Installation* — el **user install** debe estar desactivado (este bot es solo de guild,
sus comandos usan `setContexts(Guild)`).

Tests:

```bash
npm test
```

### Rotar el PAT de GameAP

1. Panel → *Profile → API tokens* → revocar el token viejo y crear uno nuevo con
   `server:list, server:start, server:stop, server:restart, server:rcon-players, server:rcon-console`.
2. Actualizar `GAMEAP_TOKEN` en `.env`.
3. `docker compose up -d` (recrea el contenedor con el nuevo valor).

### Reiniciar el estado (re-baseline)

Si el feed muestra cosas raras o se cambió de servidores:

```bash
rm data/state.json && docker compose restart
```

El primer ciclo tras arrancar **nunca** anuncia: sólo guarda quién está dentro.

## Escalar a más servidores, canales o guilds

1. **Otro servidor en el mismo Discord**: añadir `"announce": true` en `config/servers.json`
   (o `/feed <server> on` en el canal que quieras).
2. **Otro canal para otro servidor**: en `config/guilds.json`, dentro del guild,
   `"feeds": { "<serverId>": "<channelId>" }`.
3. **Otro Discord (otros amigos)**: invitar el bot, y añadir su bloque en
   `config/guilds.json` con su `feedChannelId` y (si quieren limitar) `servers: ["8"]`.
   Si no se añade nada, aplican los `defaults` (todos los servidores, sin feed).
4. **Restringir quién puede operar**: poner los roles en `operatorRoleIds`.
   Con `[]` (estado actual) cualquiera puede; con roles, sólo quien los tenga.

## Comportamiento del feed (anti-spam)

- Poll cada `POLL_INTERVAL_MS` (20 s por defecto) a `/api/servers/{id}/rcon/players`.
- Si el servidor está apagado o RCON falla: se marca `unknown` y **no** se anuncian
  salidas falsas; al volver, re-baseline silencioso.
- Cada canal suscrito arranca en silencio (no anuncia la lista actual como si todos
  acabaran de entrar).
- Cambio de nick ⇒ aparece como `left` + `joined` (limitación del comando `list` de Minecraft).

## Detalles verificados

- Estado del server: `GET /api/servers/{id}/status` → `{ "processActive": bool }`.
- Lista: `GET /api/servers` ya trae `online` y `process_active` por servidor.
- RCON: `GET /api/servers/{id}/rcon/features` → `{rcon, playersList, playersKick, playersBan}`;
  jugadores en `GET /api/servers/{id}/rcon/players`; comando crudo `POST /api/servers/{id}/rcon`.
- El panel bloquea IPs privadas en algunos flujos, pero RCON lo ejecuta el daemon del host,
  por eso funciona con `172.24.0.10:55xx` sin abrir nada.
