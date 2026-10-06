[English](../README.md) · **Español**

# Documentación — GameAP Discord bot

Bot de Discord que controla los game servers del panel **GameAP** y avisa en un canal aparte
cuándo entra y cuándo sale cada jugador. Vive en `/opt/gameap-discord-bot` y corre en
Docker como parte del stack de Dockge.

> Todos los diagramas están en **Mermaid**. Se renderizan en GitHub/GitLab/Forgejo, en VS Code
> (extensión Markdown Preview Mermaid) y en Obsidian. Discord **no** los renderiza: son docs de repo.

## Cómo funciona en 30 segundos

1. El bot se conecta a Discord con el **gateway** (WebSocket) y expone comandos slash.
2. Cada comando habla con la **API HTTP del panel GameAP** usando un **PAT** (API key).
3. El panel le pide al **daemon** que ejecute las acciones y el RCON; el bot **nunca** abre
   puertos de juego ni habla RCON directo.
4. Un **watcher** consulta cada ~20 s la lista de jugadores de los servidores con `announce: true`
   y, cuando detecta cambios, publica un embed en los canales suscritos (uno por guild/canal).

```mermaid
flowchart LR
  subgraph DISCORD["Discord"]
    U["Miembros del server<br/>comandos slash"]
    CH["canal de feed<br/>#game-feed"]
  end

  subgraph HOST["Homeserver"]
    BOT["contenedor gameap-bot<br/>node src/index.js"]
    PANEL["panel GameAP<br/>127.0.0.1:8025"]
    DAEMON["daemon GameAP"]
    SRV["game servers<br/>MC, GMod"]
  end

  U -- "gateway WebSocket<br/>interactions" --> BOT
  BOT -- "REST + PAT Bearer" --> PANEL
  PANEL --> DAEMON
  DAEMON -- "RCON / procesos" --> SRV
  SRV -. "lista de jugadores" .-> DAEMON
  BOT -- "embeds de join/leave" --> CH
```

## Índice

| Documento | Léelo si quieres saber… |
|---|---|
| [architecture.md](architecture.md) | Cómo se conectan las piezas, flujo de un comando y del watcher, y **por qué** cada decisión de diseño |
| [commands.md](commands.md) | Los 11 comandos: opciones, permisos, qué embed devuelven y qué errores pueden dar |
| [custom-commands.md](custom-commands.md) | Comandos extra por guild definidos en config/commands.json, un comando RCON cada uno |
| [configuration.md](configuration.md) | Variables de entorno y los JSON de config/estado, con la precedencia exacta del feed |
| [feed.md](feed.md) | Cómo detecta el watcher las entradas/salidas y cómo evita avisos falsos |
| [autostop.md](autostop.md) | El auto-apagado por inactividad (2 h sin jugadores), cómo configurarlo y cómo probarlo |
| [power.md](power.md) | Opcional: avisos en el juego y en Discord cuando el UPS entra en batería, y el apagado por batería baja |
| [gameap-api.md](gameap-api.md) | Endpoints del panel que usa el bot, permisos del PAT y manejo de errores |
| [operations.md](operations.md) | Desplegar, actualizar, rotar credenciales, troubleshooting paso a paso |
| [development.md](development.md) | Mapa del código, cómo agregar un comando, cómo correr los tests |
| [i18n.md](i18n.md) | Catálogos de idiomas, resolución del idioma por guild, cómo agregar un idioma |

## Modelo de datos (config vs estado)

`data/state.json` — estado en disco del watcher: qué jugadores vio en el último ciclo y el reloj de
inactividad de cada servidor.

```json
{
  "servers": {
    "8": {
      "players": ["alice", "bob"], "initialized": true, "unknown": false,
      "idle": { "idleMs": 3600000, "idleSince": 1759170000000, "warnedAt": null, "blindMs": 0, "autoStoppedAt": null },
      "lastControlAt": 1759160000000
    }
  },
  "feeds": {
    "123456789012345678:8": { "initialized": true }
  }
}
```

`data/autostop.json` — overrides de `/autostop` (por servidor, no por Discord).

```json
{ "8": { "hours": 2, "warnMinutes": 15 } }
```

`data/feeds.json` — overrides de `/feed` (no se toca la config del repositorio).

```json
{
  "123456789012345678:8": { "on": true, "channelId": "234567890123456789" }
}
```

## Glosario

| Término | Qué es aquí |
|---|---|
| **panel** | La web/API de GameAP (`:8025`). Es el único punto al que el bot habla. |
| **daemon** | Proceso de GameAP que arranca/apaga servidores y ejecuta RCON. |
| **PAT** | Personal Access Token del panel. Va en `Authorization: Bearer <PAT>`. |
| **guild** | Un servidor de Discord (no confundir con "game server"). En la config aparece como `guilds`. |
| **feed** | Canal suscrito a los avisos de entradas/salidas de un game server. |
| **baseline** | Marcado silencioso: la primera lectura de un servidor (o de una suscripción nueva) no genera avisos. |

## Mantener los dos idiomas sincronizados

El inglés es la fuente de verdad; esta carpeta es su traducción. `npm run check:docs` comprueba que
cada documento tenga contraparte en el otro idioma, que todos los enlaces y anclas relativos
resuelvan, que cada archivo empiece con su conmutador de idioma, que los dos árboles se mantengan
paralelos (encabezados, tablas, diagramas) y que no se haya colado ningún dato interno en el repo
público. Córrelo después de tocar cualquier doc.

La comprobación de fugas compara cada doc, los README de la raíz, las plantillas de config y `src/`
con los patrones de **`.docs-leaks`**: un archivo local (gitignored) con una expresión regular por
línea, formato y ejemplos en `.docs-leaks.example`. Es lo único que nunca debe commitearse, porque
los patrones *son* el secreto. Sin ese archivo la comprobación se salta y se reporta como saltada.
