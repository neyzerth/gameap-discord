// Discord commands defined in config/commands.json: RCON templates with typed
// arguments, so a mod command becomes one command instead of a full `/rcon` line.
//
//   /whitelist add player: Steve   ->  RCON "whitelistgate add Steve"
//   /whitelist reload              ->  RCON "whitelist reload"
//
// Registration model: built-ins stay global (`npm run deploy`) and these commands
// are PUT into each guild's own command set at startup. They appear in seconds
// (no global propagation wait), they are scoped to the guild that defines them,
// and they never duplicate a global command — which is why a config command may
// not reuse a built-in name, and why `npm run deploy --guild` is not for a guild
// that has these (it replaces that guild's set).
//
// Execution model: identical to `/rcon` — the same operator gate (so
// `commandRoles.<name>` / `operatorRoleIds` / the Administrator bypass all work
// with no extra code), the same sanitizing (no line breaks, no `;`, bounded
// length) and the same reply format. A template takes *typed arguments*, never
// free text, which keeps the RCON surface of a config command as small as the
// command it wraps.

import { SlashCommandBuilder, InteractionContextType, MessageFlags, Routes } from 'discord.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { playerNames, rconCommand } from './gameap.js';
import { autocompleteServers, guardOperator, resolveServerOption } from './control.js';
import { canUseServer, knownServerIds, localeFor } from './config.js';
import { t } from './i18n/index.js';
import { log } from './logger.js';

export const NAME_RE = /^[a-z0-9_-]{1,32}$/;
export const OPTION_TYPES = Object.freeze({ string: 3, integer: 4, boolean: 5 });
export const MAX_COMMAND_LEN = 512;
const MAX_OUTPUT_LEN = 1800;

const FILE = () =>
  process.env.CUSTOM_COMMANDS_FILE ?? resolve(process.cwd(), 'config', 'commands.json');

const EMPTY = Object.freeze({ guilds: {} });

let cache = null;
const runtime = new Map();

// Tests: replace the file contents (null restores "read the file again").
export function __setCustomCommands(config) {
  cache = config;
  runtime.clear();
}

export function loadCustomCommands() {
  if (cache) return cache;
  let text;
  try {
    text = readFileSync(FILE(), 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') log.error(`config/commands.json ignored: ${err.message}`);
    cache = EMPTY;
    return cache;
  }
  try {
    const parsed = JSON.parse(text);
    cache = parsed && typeof parsed === 'object' ? parsed : EMPTY;
  } catch (err) {
    log.error(`config/commands.json is not valid JSON: ${err.message}`);
    cache = EMPTY;
  }
  return cache;
}

export const customCommandsFor = (guildId) =>
  loadCustomCommands().guilds?.[String(guildId)] ?? {};

export function placeholders(template) {
  return [...String(template ?? '').matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
}

// The template is the only thing that reaches RCON, so every value is trimmed,
// empty values are refused (a command with a hole in the middle is worse than a
// clear error) and the same line-break / ";" ban as `/rcon` applies here.
export function renderTemplate(template, values = {}) {
  const missing = [];
  const command = String(template ?? '')
    .replace(/\{(\w+)\}/g, (_, key) => {
      const value = values[key];
      if (value === undefined || value === null || String(value).trim() === '') {
        missing.push(key);
        return '';
      }
      return String(value).trim();
    })
    .trim();

  if (missing.length) return { ok: false, reason: 'missing', missing };
  if (/[\n\r;]/.test(command)) return { ok: false, reason: 'rejected' };
  if (!command) return { ok: false, reason: 'missing', missing: placeholders(template) };
  if (command.length > MAX_COMMAND_LEN) return { ok: false, reason: 'toolong' };
  return { ok: true, command };
}

const isRegex = (value) => {
  try {
    new RegExp(value);
    return true;
  } catch {
    return false;
  }
};

// Everything Discord would reject with a cryptic API error, plus the rules that
// keep a config command safe: it is RCON, so its options are typed and named.
export function validateDefinition(name, def, builtinNames = []) {
  const problems = [];
  if (!NAME_RE.test(String(name))) problems.push('name must match ^[a-z0-9_-]{1,32}$');
  else if (builtinNames.includes(name)) problems.push('name collides with a built-in command');
  if (!def || typeof def !== 'object') return [...problems, 'definition must be an object'];

  if (typeof def.description !== 'string' || !def.description.trim()) {
    problems.push('description is required');
  } else if (def.description.length > 100) {
    problems.push('description is longer than 100 characters');
  }
  if (def.server !== undefined && def.server !== null && !knownServerIds().includes(String(def.server))) {
    problems.push(`server ${def.server} is not in config/servers.json`);
  }

  const targets = def.subcommands
    ? Object.entries(def.subcommands ?? {})
    : [[null, def]];

  if (def.subcommands && !Object.keys(def.subcommands).length) problems.push('subcommands is empty');

  for (const [sub, target] of targets) {
    const label = sub ? `${sub}: ` : '';
    if (sub && !NAME_RE.test(sub)) problems.push(`subcommand "${sub}" must match ^[a-z0-9_-]{1,32}$`);
    if (!target || typeof target !== 'object') {
      problems.push(`${label}definition must be an object`);
      continue;
    }
    if (typeof target.template !== 'string' || !target.template.trim()) {
      problems.push(`${label}template is required`);
    } else if (/[\n\r;]/.test(target.template)) {
      problems.push(`${label}template must not contain line breaks or ";"`);
    }
    if (target.options !== undefined && !Array.isArray(target.options)) {
      problems.push(`${label}options must be an array`);
      continue;
    }

    const options = target.options ?? [];
    const names = options.map((o) => o?.name);
    const used = placeholders(target.template ?? '');
    let sawOptional = false;

    for (const opt of options) {
      const where = `${label}option "${opt?.name}"`;
      if (!NAME_RE.test(String(opt?.name))) problems.push(`${where} must match ^[a-z0-9_-]{1,32}$`);
      if (!(opt?.type in OPTION_TYPES)) {
        problems.push(`${where} type must be one of ${Object.keys(OPTION_TYPES).join(', ')}`);
      }
      if (typeof opt?.description !== 'string' || !opt.description.trim()) {
        problems.push(`${where} needs a description`);
      }
      if (opt?.source !== undefined && opt.source !== 'players') {
        problems.push(`${where} source must be "players"`);
      }
      if (opt?.source === 'players' && opt?.type !== 'string') {
        problems.push(`${where} source "players" only works with type string`);
      }
      if (opt?.pattern !== undefined && !isRegex(opt.pattern)) problems.push(`${where} pattern is not a valid regex`);
      if (opt?.required) {
        if (sawOptional) problems.push(`${where} is required but comes after an optional option`);
      } else {
        sawOptional = true;
      }
      if (opt?.name && !used.includes(opt.name)) problems.push(`${where} is never used by the template`);
    }

    for (const key of used) {
      if (!names.includes(key)) problems.push(`${label}template uses {${key}} but no option is named that way`);
    }
    if (!target.options?.length && used.length) {
      problems.push(`${label}template uses ${used.map((k) => `{${k}}`).join(', ')} but there are no options`);
    }
  }

  return problems;
}

function addOptions(builder, name, options = []) {
  const method = { 3: 'addStringOption', 4: 'addIntegerOption', 5: 'addBooleanOption' };
  for (const opt of options) {
    builder[method[OPTION_TYPES[opt.type]]]((o) => {
      o.setName(opt.name).setDescription(opt.description ?? name).setRequired(Boolean(opt.required));
      if (opt.source === 'players') o.setAutocomplete(true);
      if (opt.type === 'integer') {
        if (Number.isInteger(opt.min)) o.setMinValue(opt.min);
        if (Number.isInteger(opt.max)) o.setMaxValue(opt.max);
      }
      return o;
    });
  }
  return builder;
}

export function buildData(name, def) {
  const data = new SlashCommandBuilder()
    .setName(name)
    .setDescription(def.description)
    .setContexts(InteractionContextType.Guild);

  if (def.subcommands) {
    for (const [sub, target] of Object.entries(def.subcommands)) {
      data.addSubcommand((s) => addOptions(s.setName(sub).setDescription(target.description ?? def.description), name, target.options));
    }
  } else {
    addOptions(data, name, def.options);
  }

  const json = data.toJSON();
  if (def.hidden === true) json.default_member_permissions = '0';
  return json;
}

// Which template/options a given interaction resolves to (a subcommand, or the
// command itself when it has none).
export function targetFor(def, interaction) {
  if (!def?.subcommands) return def;
  let sub = null;
  try {
    sub = interaction.options.getSubcommand(false);
  } catch {
    sub = null;
  }
  return (sub && def.subcommands[sub]) || null;
}

function readOption(interaction, opt) {
  if (opt.type === 'integer') return interaction.options.getInteger(opt.name);
  if (opt.type === 'boolean') return interaction.options.getBoolean(opt.name);
  return interaction.options.getString(opt.name);
}

async function replyEphemeral(interaction, content) {
  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

function buildExecutor(name, def) {
  return async function execute(interaction) {
    const locale = localeFor(interaction.guildId);

    // Same gate as `/rcon`: one line, and `commandRoles.<name>` applies to this
    // command exactly like it does to a built-in.
    if (!(await guardOperator(interaction, name))) return;

    const target = targetFor(def, interaction);
    if (!target) return replyEphemeral(interaction, t(locale, 'errors.commandFailed', { message: name }));

    let serverId = def.server ? String(def.server) : null;
    if (serverId) {
      if (!knownServerIds().includes(serverId) || !canUseServer(interaction.guildId, serverId)) {
        return replyEphemeral(interaction, t(locale, 'errors.serverNotAvailable'));
      }
    } else {
      serverId = await resolveServerOption(interaction);
      if (!serverId) return;
    }

    const values = {};
    for (const opt of target.options ?? []) {
      const value = readOption(interaction, opt);
      if (opt.pattern && typeof value === 'string' && !new RegExp(opt.pattern).test(value)) {
        return replyEphemeral(interaction, t(locale, 'errors.customInvalid', { option: opt.name }));
      }
      values[opt.name] = value;
    }

    const rendered = renderTemplate(target.template, values);
    if (!rendered.ok) {
      if (rendered.reason === 'rejected') {
        return replyEphemeral(interaction, t(locale, 'errors.rconRejected'));
      }
      return replyEphemeral(
        interaction,
        t(locale, 'errors.customInvalid', { option: (rendered.missing ?? []).join(', ') || name }),
      );
    }

    await interaction.deferReply(def.ephemeral === true ? { flags: MessageFlags.Ephemeral } : {});
    // Audit trail: what was actually sent, which server, and by whom.
    log.info(`/${name} -> server ${serverId}: ${rendered.command} (by ${interaction.user?.tag ?? interaction.user?.id})`);

    try {
      const { output } = await rconCommand(serverId, rendered.command);
      const text = String(output ?? '').trim();
      await interaction.editReply(
        text ? `\`\`\`\n${text.slice(0, MAX_OUTPUT_LEN)}\n\`\`\`` : t(locale, 'errors.rconSent'),
      );
    } catch (err) {
      await interaction.editReply(
        t(locale, 'errors.rconFailed', { message: `${err.status ?? ''} ${err.message}`.trim() }),
      );
    }
  };
}

function buildAutocomplete(name, def) {
  return async function autocomplete(interaction) {
    const focusedName = interaction.options.getFocused(true)?.name;
    const target = targetFor(def, interaction) ?? def;

    if (focusedName === 'server') return autocompleteServers(interaction);

    const opt = (target.options ?? []).find((o) => o.name === focusedName);
    if (opt?.source !== 'players') return interaction.respond([]);

    const serverId = def.server ? String(def.server) : null;
    if (!serverId || !canUseServer(interaction.guildId, serverId)) return interaction.respond([]);

    const focused = String(interaction.options.getFocused()).toLowerCase();
    const players = await playerNames(serverId).catch(() => []);
    const choices = players
      .filter((p) => p.toLowerCase().includes(focused))
      .slice(0, 25)
      .map((p) => ({ name: p, value: p }));
    return interaction.respond(choices);
  };
}

export function buildCommand(name, def) {
  return { data: buildData(name, def), execute: buildExecutor(name, def), autocomplete: buildAutocomplete(name, def) };
}

// A guild's config command, validated and cached. Returns null when the guild
// does not define it (or when its definition is unusable, which is logged).
export function guildCommand(guildId, name, builtinNames = []) {
  const key = `${guildId}:${name}`;
  if (runtime.has(key)) return runtime.get(key);

  const def = customCommandsFor(guildId)[name];
  let command = null;
  if (def) {
    const problems = validateDefinition(name, def, builtinNames);
    if (problems.length) {
      log.error(`config/commands.json: /${name} in guild ${guildId} skipped — ${problems.join('; ')}`);
    } else {
      command = buildCommand(name, def);
    }
  }
  runtime.set(key, command);
  return command;
}

// Registers each guild's own set at startup. PUT replaces that guild's command
// set, which is exactly right here: the built-ins are global, so a guild set is
// only these config commands (and a guild with none is left untouched).
export async function registerGuildCommands({ rest, appId, builtinNames = [] }) {
  const cfg = loadCustomCommands();
  const registered = [];

  for (const [guildId, defs] of Object.entries(cfg.guilds ?? {})) {
    const bodies = [];
    for (const [name, def] of Object.entries(defs ?? {})) {
      const problems = validateDefinition(name, def, builtinNames);
      if (problems.length) {
        log.error(`config/commands.json: /${name} in guild ${guildId} skipped — ${problems.join('; ')}`);
        continue;
      }
      bodies.push(buildData(name, def));
    }
    if (!bodies.length) continue;

    try {
      const result = await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: bodies });
      log.info(
        `registered ${result.length} config command(s) in guild ${guildId}: ${result
          .map((c) => `/${c.name}`)
          .join(' ')}`,
      );
      registered.push(...result);
    } catch (err) {
      log.warn(`config commands not registered in guild ${guildId}: ${err.message}`);
    }
  }

  return registered;
}
