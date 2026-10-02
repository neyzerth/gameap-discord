[English](../custom-commands.md) · **Español**

# Comandos de config (atajos de RCON)

`config/commands.json` agrega comandos slash **por guild** que mandan un comando RCON cada uno: en
vez de escribir la línea completa de `/rcon`, un operador usa `/modcommand add player: Steve` y el
bot manda `modcommand add Steve` al panel. Está pensado para comandos de mods o de consola que un
guild usa seguido.

## Forma

```json
{
  "guilds": {
    "<id del guild>": {
      "modcommand": {
        "description": "Comando del mod, como un solo comando slash",
        "server": "8",
        "ephemeral": true,
        "subcommands": {
          "add": {
            "description": "Agrega un jugador",
            "template": "modcommand add {player}",
            "options": [
              {
                "name": "player",
                "type": "string",
                "required": true,
                "description": "Nombre del jugador",
                "source": "players",
                "pattern": "^[A-Za-z0-9_]{3,16}$"
              }
            ]
          },
          "reload": { "description": "Recarga desde el archivo", "template": "modcommand reload" }
        }
      }
    }
  }
}
```

| Campo | Qué significa |
|---|---|
| `description` | Descripción que muestra `Discord`, hasta 100 caracteres |
| `server` | Id de `config/servers.json`. Sin él, el comando recibe una opción `server` con autocompletado |
| `ephemeral` | `true` → solo quien lo ejecutó ve la respuesta |
| `hidden` | `true` → se registra oculto para los que no son admins (`default_member_permissions` `"0"`) |
| `subcommands` | Mapa de subcomando → `{ "description", "template", "options" }`. Si lo omites, pon `template` + `options` arriba para un comando sin subcomandos |
| `template` | La línea de RCON, con huecos `{opción}`. Sin saltos de línea y sin `;` |
| `templates` | Un pipeline: varias líneas de RCON enviadas en orden con los mismos argumentos (agregar y luego recargar). Úsalo **o** `template`, nunca los dos |
| `options[]` | `name`, `type` (`string`, `integer`, `boolean`), `description`, `required`, `source` (`"players"` autocompleta los jugadores en línea), `pattern`, `min`, `max` |

## Registro

Los comandos de config se registran **por guild al arrancar**: el bot le manda a ese guild su propio
conjunto de comandos, así que aparecen en segundos (sin esperar la propagación de un comando global)
y solo en el guild que los define. Los comandos incluidos conservan su registro global de
`npm run deploy`.

- Un comando de config no puede reusar el nombre de uno incluido.
- **No** corras `npm run deploy --guild <id>` en un guild con comandos de config: reemplaza el
  conjunto de ese guild y los borra hasta el siguiente reinicio.
- Igual que `servers.json`, `config/commands.json` es local: el repo solo trae
  `config/commands.example.json`.

## Quién puede usarlo

El mismo gate que `/rcon`: `commandRoles.<comando>` → `operatorRoleIds` → todos, más el bypass de
Administrator. Como ese gate es el que lo hace cumplir, los comandos de config se registran
**visibles** y no necesitan permisos en Server Settings → Integrations. Con `"hidden": true` hay que
dar los roles a mano; `npm run check:permissions` audita solo los incluidos con guard.

## Seguridad

- El template es lo único que llega a RCON, y recibe argumentos tipados — nunca texto libre.
- Se rechazan argumentos vacíos, saltos de línea y `;`, los valores se recortan y el comando
  renderizado se topa en 512 caracteres: las mismas reglas que aplica `/rcon`.
- Un pipeline (`templates`) corre en orden y se detiene en el primer fallo; la respuesta dice cuál
  línea falló, así que una acción a medias nunca queda en silencio.
- `pattern` valida un valor antes de renderizarlo.
- Cada ejecución queda en el log con el comando, el servidor destino y quién lo corrió.

## Verificación

Al arrancar, el bot registra en el log lo que quedó:

```text
registered 1 config command(s) in guild 123456789012345678: /modcommand
```

Una definición que el bot no puede usar se salta con su motivo (`docker compose logs gameap-bot`) en
vez de tumbar el bot. Los comandos de config no aparecen en `/help`, que lista los incluidos.

## Problemas comunes

| Síntoma | Causa |
|---|---|
| El comando no está en el selector | La definición se saltó: el log de arranque dice por qué (nombre inválido, `server` que no está en `servers.json`, un `{hueco}` sin opción…) |
| `Valor inválido para \`player\`` | El valor está vacío o no cumple `pattern` |
| `That server is not available in this Discord server` | La lista `servers` de ese guild no incluye ese servidor |
| Desapareció después de un deploy | `npm run deploy --guild` reemplazó el conjunto del guild: reinicia el bot |
