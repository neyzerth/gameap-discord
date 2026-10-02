**English** · [Español](es/custom-commands.md)

# Config commands (RCON shortcuts)

`config/commands.json` adds slash commands **per guild** that send one RCON command each: instead of
typing the whole `/rcon` line, an operator runs `/modcommand add player: Steve` and the bot sends
`modcommand add Steve` to the panel. It is meant for mod or console commands a guild uses often.

## Shape

```json
{
  "guilds": {
    "<guild id>": {
      "modcommand": {
        "description": "Mod command, as a single slash command",
        "server": "8",
        "ephemeral": true,
        "subcommands": {
          "add": {
            "description": "Add a player",
            "template": "modcommand add {player}",
            "options": [
              {
                "name": "player",
                "type": "string",
                "required": true,
                "description": "Player name",
                "source": "players",
                "pattern": "^[A-Za-z0-9_]{3,16}$"
              }
            ]
          },
          "reload": { "description": "Reload from file", "template": "modcommand reload" }
        }
      }
    }
  }
}
```

| Field | Meaning |
|---|---|
| `description` | Command description `Discord` shows, up to 100 characters |
| `server` | Id from `config/servers.json`. Without it the command gets a `server` option with autocomplete |
| `ephemeral` | `true` → only the person who ran it sees the reply |
| `hidden` | `true` → registered hidden from non-admins (`default_member_permissions` `"0"`) |
| `subcommands` | Map of subcommand → `{ "description", "template", "options" }`. Leave it out and put `template` + `options` at the top level for a command without subcommands |
| `template` | The RCON line, with `{option}` holes. No line breaks and no `;` |
| `options[]` | `name`, `type` (`string`, `integer`, `boolean`), `description`, `required`, `source` (`"players"` autocompletes the players online), `pattern`, `min`, `max` |

## Registration

Config commands are registered **per guild at startup**: the bot sends that guild its own command
set, so they appear in seconds (no wait for a global command to propagate) and only in the guild
that defines them. The built-in commands keep their global registration from `npm run deploy`.

- A config command may not reuse a built-in name.
- Do **not** run `npm run deploy --guild <id>` in a guild with config commands: it replaces that
  guild's set and removes them until the next restart.
- Like `servers.json`, `config/commands.json` is local: the repo ships only
  `config/commands.example.json`.

## Who may run it

The same gate as `/rcon`: `commandRoles.<command>` → `operatorRoleIds` → everyone, plus the
Administrator bypass. Because that gate is what enforces it, config commands are registered
**visible** and need no grant in Server Settings → Integrations. With `"hidden": true` you must
grant the roles by hand instead; `npm run check:permissions` audits only the gated built-ins.

## Safety

- The template is the only thing that reaches RCON, and it takes typed arguments — never free text.
- Empty arguments, line breaks and `;` are refused, values are trimmed, and the rendered command is
  capped at 512 characters: the same rules `/rcon` applies.
- `pattern` validates a value before it is rendered.
- Every run is logged with the command, the target server and who ran it.

## Verification

At startup the bot logs what it registered:

```text
registered 1 config command(s) in guild 123456789012345678: /modcommand
```

A definition the bot cannot use is skipped with its reason (`docker compose logs gameap-bot`)
instead of stopping the bot. Config commands do not show up in `/help`, which lists the built-ins.

## Common problems

| Symptom | Cause |
|---|---|
| The command is not in the picker | The definition was skipped: the startup log says why (bad name, `server` that is not in `servers.json`, a `{hole}` with no matching option…) |
| `Invalid value for \`player\`` | The value is empty or does not match `pattern` |
| `That server is not available in this Discord server` | That guild's `servers` list does not include the server |
| It vanished after a deploy | `npm run deploy --guild` replaced the guild's command set: restart the bot |
