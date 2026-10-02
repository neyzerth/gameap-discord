[English](../development.md) · **Español**

# Desarrollo

## Requisitos

- Node **>=22** (usa ESM, `fetch` global, `--env-file` y `node --test`).
- `npm install` una sola vez en `/opt/gameap-discord-bot`.

```bash
npm test                  # 106 tests, sin red ni Discord
npm run deploy            # registra los comandos globales (necesita .env)
npm run check:permissions  # solo lectura: qué le falta dar a cada guild (necesita .env)
npm start                 # correr el bot fuera de Docker (necesita .env en el entorno)
docker compose pull && docker compose up -d   # la imagen publicada (build local: ver abajo)
```

## Mapa del código

```
src/
  index.js           cliente discord.js, router de interacciones, guildCreate, shutdown
  registry.js        carga de src/commands/*.js + usageOf() para la ayuda
  config.js          resolución multi-guild (alias, visibilidad, feed, overrides)
  permissions.js     isOperator(member, comando) desde commandRoles / operatorRoleIds (+ bypass de Administrator)
  command-permissions.js  overrides puros del lado de Discord para los comandos con guard
  check-permissions.js    auditoría solo lectura de los permisos por guild (npm run check:permissions)
  discord-app.js     resuelve el application id del token (deploy + check)
  gameap.js          cliente HTTP del panel (timeout 15 s)
  watcher.js         ciclo de polling y decisión de anunciar
  autostop.js        reloj de inactividad puro (resolveAutoStop, accumulateIdle, evaluateIdle)
  state.js           persistencia (state.json, feeds.json, autostop.json) y diff() puro
  embeds.js          embeds de estado/control/confirmación, avisos de auto-apagado y fan-out
  help.js            ayuda general y por comando, generada de los comandos vivos
  logger.js          log con niveles
  i18n/
    core.js          búsqueda pura, formas plurales, detección de claves faltantes/sobrantes
    index.js         carga de catálogos y la API t()/plural()
    commands.js      localiza descripciones y opciones (los nombres quedan en inglés)
    discord-locales.js  nuestros tags -> los de Discord (es-MX -> es-419)
    locales/         en.json (define todas las claves), es-MX.json
  commands/          11 comandos: help.js, servers.js, status.js, players.js, start.js,
                     stop.js, restart.js, rcon.js, feed.js, autostop.js, language.js
  *.test.js          state, config, autostop, help, language, i18n, permisos, gating, command-permissions (106 casos)
docs/                esta documentación
```

Regla de oro: **nada de lógica de Discord dentro de `gameap.js`**, y nada de lógica de
visor de estado dentro de los comandos. Los comandos son delgados: guard → resolver → llamada →
embed.

## Añadir un comando (5 pasos)

1. Crear `src/commands/miComando.js`:

```js
import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import { autocompleteServers, guardOperator, resolveServerOption } from '../control.js';
import { localizeCommand, localizeOption } from '../i18n/commands.js';
import { serverStatus } from '../gameap.js';
import { statusEmbed } from '../embeds.js';

export const data = localizeCommand(
  new SlashCommandBuilder()
    .setName('miComando')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      localizeOption(option.setName('server').setRequired(true).setAutocomplete(true), 'miComando', 'server'),
    ),
  'miComando',
);

export const autocomplete = autocompleteServers;

export const help = {
  examples: ['/miComando mc-survival'],
  notes: 'Anything a friend should know before using it.',
};

export async function execute(interaction) {
  if (!(await guardOperator(interaction))) return;      // solo si es de control
  const serverId = await resolveServerOption(interaction);
  if (!serverId) return;

  await interaction.deferReply();
  const status = await serverStatus(serverId).catch(() => null);
  await interaction.editReply({ embeds: [statusEmbed(serverId, status, null, null)] });
}
```

2. Meterlo en una categoría de `CATEGORIES` en `src/help.js` (para la ayuda general).
3. `npm test` — el test de ayuda falla si olvidaste el `help` o la categoría, y el de cobertura
   falla si el texto no está en los catálogos (`commands.miComando.description` y
   `commands.miComando.options.server`, ver [Agregar un idioma](#agregar-un-idioma)).
4. `npm run deploy` para registrarlo en Discord (global).
5. `docker compose pull && docker compose up -d` para que el bot lo cargue (`loaded N commands`).

Convenciones:

- Un comando por archivo; exporta `data`, `execute`, `help` y, si aplica, `autocomplete`.
- El texto de cara al usuario está **localizado**: las descripciones y opciones salen de los
  catálogos (inglés base + `es-MX`, elegido por guild — ver [i18n.md](i18n.md)); la documentación
  es bilingüe: inglés como principal en `docs/` y espejo en español en `docs/es/`, con el par
  `README.md` / `README.es.md` en la raíz.
- Errores al usuario con `MessageFlags.Ephemeral` cuando son solo para quien invoca; los embeds de
  resultado son públicos.
- Los comandos que consultan información no llevan `guardOperator`; los de control sí.
- Los comandos usan `setContexts(InteractionContextType.Guild)`: nada de DM.

## Agregar un idioma

El catálogo base es `src/i18n/locales/en.json` — define todas las claves; los demás catálogos lo
traducen uno a uno. Para agregar un idioma:

1. Crear `src/i18n/locales/<tag>.json` con las mismas claves que `en.json` (cópialo y tradúcelo —
   las claves faltantes y las sobrantes hacen fallar los tests).
2. Si además quieres localizar los metadatos de los comandos en Discord, agrega el tag a
   `src/i18n/discord-locales.js` (ej. `'es-MX': 'es-419'` — Discord no tiene `es-MX`).
3. `npm test` — las guardias de paridad detectan claves faltantes/sobrantes, claves pedidas en el
   código que no existen, y textos de cara al usuario que volvieron al código.
4. `npm run deploy` para publicar las localizaciones.

El idioma es **por guild**; `/language locale:auto` borra el override y el guild cae a
`guilds.json`, `defaults`, `DEFAULT_LOCALE` y luego inglés. Ver [i18n.md](i18n.md) para el detalle
completo.

## Tests

`node --test src/*.test.js src/i18n/*.test.js` (sin red, sin Discord):

| Archivo | Qué cubre |
|---|---|
| `state.test.js` | `diff()` (joins/leaves/baseline), round-trip de `state.json` y `feeds.json` |
| `config.test.js` | resolución de alias, visibilidad por guild, precedencia de `feedTarget`, `pollTargets` |
| `help.test.js` | que **todos** los comandos tengan ayuda y categoría, `usageOf()` por comando, que los embeds se construyan, y el autocompletado de `/help` |
| `autostop.test.js` | resolución de config, acumulación/reinicio/congelado del reloj, warn/stop, formato de duración, contrato de `/autostop` y sus embeds |
| `language.test.js` | contrato de `/language`: mostrar, cambiar, `auto` para limpiar, idioma desconocido, autocompletado |
| `i18n.test.js` | comportamiento de `t()`/`plural()`, resolución de idiomas y fallbacks, completitud de catálogos, mapeo de locales de Discord |
| `coverage.test.js` | que toda clave pedida por el código exista en el catálogo base; que ningún texto de cara al usuario quede en el código |

Los tests inyectan configuración con `__setConfig()` (no tocan el filesystem) y escriben en rutas
temporales vía `STATE_FILE`/`FEEDS_STATE_FILE`.

## Probar el feed sin jugadores reales

Truco usado para verificar la cadena completa (funciona porque el watcher compara con
`data/state.json`):

```bash
python3 - <<'PY'
import json
p = '/opt/gameap-discord-bot/data/state.json'
s = json.load(open(p))
s['servers'].setdefault('8', {})['players'] = ['alice']   # "alguien estaba dentro"
json.dump(s, open(p, 'w'), indent=2)
PY
docker restart gameap-bot          # arranca silencioso y, al primer sondeo, ve "left"
docker logs --tail 5 gameap-bot
```

Con la lista real vacía, el bot publica `🔴 left: alice` en los canales suscritos — eso
comprueba de una sola vez: watcher, `feedTarget()`, permisos del canal y formato del embed.
Borra el mensaje después si el canal es de producción.

**Dos trampas al probar el auto-apagado** (aprendidas a golpes, léelas antes de tocar `state.json`):

1. **Inyectar `idleMs` con `docker restart` no funciona**: al recibir SIGTERM el proceso **guarda su
   estado en memoria** y sobrescribe tu edición. Hay que hacer
   `docker stop gameap-bot` → editar `state.json` → `docker start gameap-bot`.
2. **`AUTOSTOP_DRY_RUN=true` en `.env` no aplica con `docker restart`/`start`**: las variables del
   contenedor se fijan al **crearlo**. Después de editar `.env` hay que
   `docker compose up -d --force-recreate`, y comprobar con
   `docker exec gameap-bot printenv AUTOSTOP_DRY_RUN` (vacío = modo normal, **apaga de verdad**).

## Verificar el registro de comandos

```bash
# globales (reenvía el token del bot)
curl -s "https://discord.com/api/v10/applications/<APP_ID>/commands" -H "Authorization: Bot $DISCORD_TOKEN" \
  | python3 -c "import sys,json;print([c['name'] for c in json.load(sys.stdin)])"

# por guild (debe estar vacío si usas el registro global)
curl -s "https://discord.com/api/v10/applications/<APP_ID>/guilds/<GUILD_ID>/commands" -H "Authorization: Bot $DISCORD_TOKEN"
```

## Ideas para después (fuera de alcance hoy)

- `/kick` y `/ban` usando `rconFeatures().playersManage/playersKick/playersBan` (ya se leen, no se usan).
- Enlace directo a la consola del panel en el pie de los embeds de control.
- Healthcheck del contenedor (por ejemplo, escribir un timestamp en `data/state.json` y comprobarlo).
- Registro por guild automático en `guildCreate` (hoy solo se loguea el guild nuevo y se pide
  editar `config/guilds.json`).
- Métricas del feed (avisos enviados, fallos) en un endpoint local.
