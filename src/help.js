// Help text, built from the live command modules so it never goes stale.
// Every command module may export `help = { examples: [] }`; the prose lives in
// the catalogs (commands.<name>.*), so the same command reads in both languages.

import { EmbedBuilder } from 'discord.js';
import { canUseServer, knownServerIds, serverMeta } from './config.js';
import { usageOf } from './registry.js';
import { has, t } from './i18n/index.js';

const COLOR = 0x5865f2;

// Las categorías son solo agrupación; los nombres están en el catálogo.
export const CATEGORIES = [
  { id: 'control', names: ['start', 'stop', 'restart'] },
  { id: 'information', names: ['servers', 'status', 'players'] },
  { id: 'utility', names: ['rcon', 'feed', 'autostop', 'help'] },
];

// Texto opcional de un comando (solo algunos lo tienen, p. ej. la nota de /rcon).
const optional = (locale, name, field) => {
  const key = `commands.${name}.${field}`;
  return has(locale, key) ? t(locale, key) : null;
};

function serversField(locale, guildId) {
  const ids = knownServerIds().filter((id) => canUseServer(guildId, id));
  if (!ids.length) return null;
  const lines = ids.map((id) => {
    const meta = serverMeta(id);
    return `${meta.emoji ?? '🎮'} \`${meta.alias ?? id}\` — ${meta.label ?? id} (#${id})`;
  });
  return { name: t(locale, 'help.serversField'), value: lines.join('\n').slice(0, 1024) };
}

export function generalEmbed(commands, guildId, locale) {
  const fields = CATEGORIES.map((category) => {
    const lines = category.names
      .filter((name) => commands.has(name))
      .map((name) => {
        const description = t(locale, `commands.${name}.description`);
        const extra = optional(locale, name, 'summary');
        return `**${usageOf(commands.get(name))}** — ${description}${extra ? `\n-# ${extra}` : ''}`;
      });
    return {
      name: `${t(locale, `help.categories.${category.id}.title`)} · ${t(locale, `help.categories.${category.id}.blurb`)}`,
      value: lines.join('\n').slice(0, 1024),
    };
  }).filter((f) => f.value);

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(t(locale, 'help.title'))
    .setDescription(
      [
        t(locale, 'help.intro'),
        t(locale, 'help.tip'),
        t(locale, 'help.detailHint'),
      ].join('\n'),
    )
    .addFields(...fields)
    .setTimestamp();

  const servers = serversField(locale, guildId);
  if (servers) embed.addFields(servers);

  embed.addFields({
    name: t(locale, 'help.feed.title'),
    value: t(locale, 'help.feed.body'),
  });

  return embed;
}

export function commandEmbed(commands, name, locale) {
  const mod = commands.get(name);
  if (!mod) return null;

  const json = mod.data.toJSON();
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(`/${json.name}`)
    .setDescription(t(locale, `commands.${name}.description`))
    .addFields({ name: t(locale, 'help.usage'), value: `\`${usageOf(mod)}\`` });

  const options = json.options ?? [];
  if (options.length) {
    embed.addFields({
      name: t(locale, 'help.options'),
      value: options
        .map((o) => {
          const choices = o.choices?.length ? ` (${o.choices.map((c) => `\`${c.value}\``).join(', ')})` : '';
          const req = t(locale, o.required ? 'help.required' : 'help.optional');
          return `\`${o.name}\`${choices} — ${t(locale, `commands.${name}.options.${o.name}`)} *(${req})*`;
        })
        .join('\n')
        .slice(0, 1024),
    });
  }

  if (mod.help?.examples?.length) {
    embed.addFields({
      name: t(locale, 'help.examples'),
      value: mod.help.examples.map((e) => `\`${e}\``).join('\n').slice(0, 1024),
    });
  }
  const notes = optional(locale, name, 'notes');
  if (notes) embed.addFields({ name: t(locale, 'help.goodToKnow'), value: String(notes).slice(0, 1024) });

  embed.setFooter({ text: t(locale, 'help.footer') }).setTimestamp();
  return embed;
}
