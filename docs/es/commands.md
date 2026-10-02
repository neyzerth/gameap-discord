[English](../commands.md) · **Español**

# Comandos

Los 11 comandos se registran **globalmente** (una sola fuente, ver
[architecture.md](architecture.md#decisiones-de-diseño-y-sus-motivos)) y funcionan en cualquier
guild donde esté el bot. Todos declaran `setContexts(Guild)`: no funcionan por DM.

```mermaid
flowchart LR
  I["interacción<br/>/comando"] --> G1{"¿puede ejecutarlo?<br/>commandRoles / operatorRoleIds"}
  G1 -- no --> E1["efímero: You are not allowed"]
  G1 -- sí --> G2{"¿existe el server?<br/>alias o id"}
  G2 -- no --> E2["efímero: Unknown server"]
  G2 -- sí --> G3{"¿permitido en este guild?<br/>servers[]"}
  G3 -- no --> E3["efímero: not available in this Discord server"]
  G3 -- sí --> RUN["ejecutar<br/>panel + embed"]
```

## Resumen

| Comando | Opciones | ¿Quién? | Respuesta | Por debajo |
|---|---|---|---|---|
| `/servers` | — | todos | pública | `GET /api/servers` |
| `/status <server>` | server | todos | pública | `GET /status` + `/rcon/features` + `/rcon/players` |
| `/players <server>` | server | todos | pública | `GET /status` + `/rcon/players` |
| `/start <server>` | server | operadores | pública (progreso) | `POST /start` |
| `/stop <server>` | server | operadores | pública (confirmación) | `POST /stop` |
| `/restart <server>` | server | operadores | pública (confirmación) | `POST /restart` |
| `/rcon <server> <command>` | server, command | operadores | pública | `POST /rcon` |
| `/feed <server> <state>` | server, on\|off | operadores | pública | estado local (`data/feeds.json`) |
| `/autostop <server> [hours] [warn]` | server, hours, warn | operadores | pública | estado local (`data/autostop.json`) + `POST /stop` cuando toca |
| `/language [locale]` | locale | operadores | pública | estado local (`data/locale.json`) |
| `/help [command]` | command | todos | pública | comandos cargados en memoria |

`<server>` acepta el **id** del panel (`8`) o el **alias** de `config/servers.json`
(`mc-survival`); la comparación ignora mayúsculas. En los comandos con `autocomplete`, el desplegable
solo ofrece los servidores **visibles en ese guild**.

Diferencia práctica: **los comandos de información no piden permiso** (cualquiera del server puede
mirar), y los de control/servidor sí pasan por `guardOperator()` — con el nombre del comando, así
que cada uno puede tener sus propios roles.

## Quién puede usar qué

Los comandos con guard llaman a `guardOperator(interaction, interaction.commandName)` y
`src/permissions.js` resuelve los roles **para ese comando**:

1. `commandRoles.<comando>` del guild (lista no vacía) → solo esos roles.
2. `operatorRoleIds` del guild (lista no vacía) → solo esos roles.
3. ninguno de los dos → **todos** (el setup actual: amigos de confianza).

Una lista vacía significa "no definido" y hereda el siguiente nivel, así que `"rcon": []` **no** es
"todos". `commandRoles.<comando>` **reemplaza** la lista de operadores para ese comando (no se
intersecta con ella): un guild puede dejar que los moderadores usen `/start` y `/stop` mientras
`/rcon` queda solo para administradores. Las listas **no** se acumulan: enumera todos los comandos
que ese grupo necesita — lo que no esté listado cae en `operatorRoleIds`.

```json
"commandRoles": { "start": ["<id rol mod>"], "stop": ["<id rol mod>"], "rcon": ["<id rol admin>"] }
```

Quien tenga el flag **Administrator** de Discord pasa todo chequeo (útil para el dueño del server).
Con `"adminBypass": false` en ese guild los roles vuelven a ser obligatorios, admins incluidos.

En el cliente, los comandos con guard solo se **muestran** a quien puede ejecutarlos: se registran
ocultos (`default_member_permissions: "0"`) y cada guild da los roles de su config en
*Server Settings → Integrations → la app → Manage*; `npm run check:permissions` audita el desfase.
Detalle y la auditoría: [operations.md](operations.md).

Referencia de campos, herencia desde `defaults` y ejemplo completo:
[configuration.md](configuration.md#configguildsjson).

## Información

### `/servers`

Lista todos los servidores **visibles en ese guild** con su estado.

- 🟢 `online` · ⚪ `offline` · ❓ sin respuesta del panel.
- Muestra alias/etiqueta del `servers.json` (no el nombre crudo del panel), id, juego e IP:puerto.
- Un servidor "apagado" en el panel se marca offline; uno deshabilitado puede no responder y sale ❓.

### `/status <server>`

Un servidor en detalle: estado, número de jugadores, quién está en línea y si el RCON está
configurado. Consulta la lista de jugadores **solo si** el servidor está activo y el juego soporta
listarlos, por eso funciona igual con Minecraft y con GMod.

Detalle de implementación: si `features.rcon === false`, el embed lleva el pie
*"RCON is not configured for this server"*.

### `/players <server>`

Lista de jugadores por RCON. Responde con un mensaje claro en vez de un error cuando:

| Situación | Lo que verás |
|---|---|
| Servidor apagado | `RCON unavailable: the server is stopped.` |
| El juego no soporta listar jugadores | `This game does not support listing players over RCON.` |
| RCON falló (daemon caído, puerto, etc.) | `RCON error: <status> <mensaje>` |

## Control

`/start`, `/stop` y `/restart` comparten `runControl()` en `src/control.js`:

1. **Guard de operador** → si no, respuesta efímera *"You are not allowed to use this command."*
2. **Resolución del servidor** (alias/id + visibilidad en el guild).
3. `deferReply()` para no perder la interacción (límite de 3 s de Discord).
4. **Atajo de estado ya alcanzado**: `/start` de algo que ya corre dice *"It was already running."*;
   `/stop` de algo apagado dice *"It was already stopped."* (no manda la orden al daemon).
5. **Confirmación con botones** (solo `stop` y `restart`): si hay jugadores, embed naranja que
   muestra el conteo y la lista (p. ej. **`2` jugadores están en línea:**, en el idioma del
   guild) con botones `Yes, stop` / `Cancel`, 60 s de espera, y **solo el autor** puede
   pulsarlos.
   Si nadie confirma (o se agota el tiempo) → *Cancelled*.
6. **Envío de la tarea** al panel y **seguimiento** cada 4 s hasta 120 s editando el embed con el
   tiempo transcurrido. El pie muestra `Daemon task #<id>` cuando el panel lo devuelve.

```mermaid
stateDiagram-v2
  [*] --> Pending: se envía la orden al panel
  Pending --> Online: processActive = true
  Pending --> Offline: processActive = false
  Online --> Offline: stop
  Offline --> Online: start
  Online --> Online: restart
  note right of Pending
    seguimiento cada 4 s, máximo 120 s
    si no llega: Still working, revisar el panel
  end note
```

Para `/restart` el bot considera terminado el proceso cuando **vio el servidor caerse** y luego
volver: así no confunde la reactivación con el estado viejo.

## `/rcon <server> <command>`

Pasa tu comando tal cual al RCON del servidor. Es potente y sin validación (más allá de rechazar
saltos de línea y `;`), por eso es de operadores — y por eso es el comando que más se beneficia de
tener sus propios `commandRoles.rcon` (un grupo más chico que el resto de los comandos de control).

- Ejemplos: `/rcon mc-survival say Server restarts in 5 minutes`, `/rcon mc-survival list`,
  `/rcon mc-survival whitelist list`.
- La salida va en un bloque de código y se corta a **1800 caracteres**.
- Si el comando no produce salida: *"RCON command sent (no output)."*

## `/feed <server> on|off`

Suscribe **el canal donde lo ejecutas** (no todo el servidor) al feed de entradas/salidas de ese
game server. Guarda el override en `data/feeds.json` y lo aplica en memoria sin reiniciar.

- `on` → activa y apunta al canal actual.
- `off` → silencia ese servidor en ese guild.
- Una suscripción nueva arranca **silenciosa**: el primer aviso llega con el siguiente join/leave
  real, no con la gente que ya estaba dentro (ver [feed.md](feed.md)).

## `/autostop <server> [hours] [warn]`

Apaga el servidor automáticamente si nadie juega durante X horas. Detalle completo en
[autostop.md](autostop.md).

- Sin `hours` ni `warn` → muestra el estado (ajuste activo, de dónde sale, inactividad acumulada,
  cuánto falta y en qué canal se avisará).
- `hours:2` activa/ajusta el umbral; `warn:10` cambia los minutos de aviso; `warn:0` = sin aviso.
- `hours:0` lo desactiva (borra el override y vuelve a lo que diga `config/servers.json`).
- Es **por servidor**, no por Discord: el ajuste vale para todos los guilds que vean ese servidor.
- Solo operadores.

## `/language`

Muestra o cambia el idioma que usa el bot **en este servidor de Discord** (por guild, no por
usuario). Solo operadores (`guardOperator()`).

- Sin `locale` → muestra el idioma efectivo actual.
- `locale:en` / `locale:es-MX` → fija el override del guild.
- `locale:auto` → borra el override y vuelve al idioma configurado.
- El parámetro `locale` tiene **autocompletado** con los valores ofrecidos: `en`, `es-MX`, `auto`.
- El override vive en `data/locale.json` (el mismo patrón que `/feed` y `/autostop`, así no se
  toca `config/guilds.json`) y se aplica en memoria sin reiniciar.

El idioma efectivo se resuelve **una vez por guild**: override de `/language` →
`config/guilds.json` de ese guild → `config/guilds.json` (defaults) → `DEFAULT_LOCALE`
(entorno) → inglés (idioma base del bot). Un valor sin catálogo se ignora, y una variante
regional (`es-AR`, `es-419`) la sirve el catálogo de su idioma (`es-MX`).

El embed de respuesta muestra:

| Campo | Significado |
|---|---|
| `Idioma actual` | El idioma efectivo en este momento |
| `Ajuste desde` | De dónde sale: `/language` (Discord) \| `config/guilds.json` (este guild) \| `config/guilds.json` (defaults) \| `DEFAULT_LOCALE` (entorno) \| idioma base del bot |
| `Disponibles` | Las etiquetas de idioma que conoce el bot |

Por ejemplo (en el idioma que está usando el guild):

```
Idioma actual: es-MX
Ajuste desde:  /language (Discord)
Disponibles:   en, es-MX
Footer:        Usa `/language locale:es-MX` para cambiarlo, o `locale:auto` para volver al idioma configurado.
```

El idioma es **por guild**: cada servidor de Discord donde esté el bot puede tener el suyo, y
todo lo que el bot escribe en Discord — embeds, avisos, ayuda, errores efímeros, botones —
sigue ese idioma; los nombres de los comandos quedan en inglés. Detalles en [i18n.md](i18n.md).

## `/help [command]`

- `/help` → guía general: los comandos por categoría, los servidores disponibles **en ese guild**
  y cómo funciona el feed.
- `/help command:<nombre>` → ficha con **Usage** (autogenerado de las opciones), **Options**,
  **Examples** y **Good to know** — los nombres de los campos siguen el idioma del guild (en
  español: `Uso`, `Opciones`, `Ejemplos`, `Bueno saberlo`).
- El parámetro `command` tiene **autocompletado** que filtra los nombres disponibles.

La ayuda no está escrita a mano: `src/help.js` la construye desde los comandos cargados por
`src/registry.js`. Al agregar un comando, basta con exportar
`export const help = { examples: [...], notes: '...' }` y meterlo en una categoría de
`CATEGORIES`; si te olvidas, **falla el test** `src/help.test.js`.

## Errores que puede devolver cualquier comando

| Mensaje | Causa |
|---|---|
| `You are not allowed to use this command.` | El guild restringe ese comando (`commandRoles[<comando>]` u `operatorRoleIds`) y no tienes ninguno de esos roles |
| `Unknown server: <valor>` | El alias/id no está en `config/servers.json` |
| `That server is not available in this Discord server.` | El guild tiene `servers: [...]` y ese id no está en la lista |
| `Command failed: <mensaje>` | Excepción no controlada (lo añade el router de `index.js`), efímero |
| `RCON failed: <status> <mensaje>` | El panel rechazó/falló el RCON (p. ej. servidor apagado) |
| `Command rejected: line breaks and ";" are not allowed.` | `/rcon` con salto de línea o `;` |
