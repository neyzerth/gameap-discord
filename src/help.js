// Help text, built from the live command modules so it never goes stale.
// Every command module may export `help = { examples: [], notes: '' }`.

import { EmbedBuilder } from 'discord.js';
import { canUseServer, knownServerIds, serverMeta } from './config.js';
import { usageOf } from './registry.js';

const COLOR = 0x5865f2;

export const CATEGORIES = [
  { title: '🎛️ Control', blurb: 'Turn servers on and off', names: ['start', 'stop', 'restart'] },
  { title: '📊 Information', blurb: 'What is running and who is online', names: ['servers', 'status', 'players'] },
  { title: '🛠️ Utility', blurb: 'Console access, notifications and automation', names: ['rcon', 'feed', 'autostop', 'help'] },
];

function serversField(guildId) {
  const ids = knownServerIds().filter((id) => canUseServer(guildId, id));
  if (!ids.length) return null;
  const lines = ids.map((id) => {
    const meta = serverMeta(id);
    return `${meta.emoji ?? '🎮'} \`${meta.alias ?? id}\` — ${meta.label ?? id} (#${id})`;
  });
  return { name: 'Servers available here', value: lines.join('\n').slice(0, 1024) };
}

export function generalEmbed(commands, guildId) {
  const fields = CATEGORIES.map((category) => {
    const lines = category.names
      .filter((name) => commands.has(name))
      .map((name) => {
        const json = commands.get(name).data.toJSON();
        const extra = commands.get(name).help?.summary;
        return `**${usageOf(commands.get(name))}** — ${json.description}${extra ? `\n-# ${extra}` : ''}`;
      });
    return { name: `${category.title} · ${category.blurb}`, value: lines.join('\n').slice(0, 1024) };
  }).filter((f) => f.value);

  const extra = [].filter(Boolean);

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle('GameAP bot — help')
    .setDescription(
      [
        'I control the game servers of your GameAP panel and post who joins and leaves.',
        '**Tip:** every `<server>` accepts the alias (e.g. `ludopatia`) or the numeric id.',
        'Type `/help command:start` (or any other command) for details and examples.',
      ].join('\n'),
    )
    .addFields(...fields)
    .setTimestamp();

  const servers = serversField(guildId);
  if (servers) embed.addFields(servers);

  embed.addFields({
    name: '📣 Join/leave feed',
    value: [
      'A watcher checks the player list every ~20 s and posts "joined"/"left" in the feed channel.',
      '`/feed <server> off` silences it **in the channel where you run the command**; `/feed <server> on` brings it back.',
      'If a server is stopped, nothing is announced (no fake "everyone left" bursts).',
    ].join('\n'),
  });

  if (extra.length) embed.addFields({ name: 'Notes', value: extra.join('\n') });

  return embed;
}

export function commandEmbed(commands, name) {
  const mod = commands.get(name);
  if (!mod) return null;

  const json = mod.data.toJSON();
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(`/${json.name}`)
    .setDescription(json.description)
    .addFields({ name: 'Usage', value: `\`${usageOf(mod)}\`` });

  const options = json.options ?? [];
  if (options.length) {
    embed.addFields({
      name: 'Options',
      value: options
        .map((o) => {
          const choices = o.choices?.length ? ` (${o.choices.map((c) => `\`${c.value}\``).join(', ')})` : '';
          const req = o.required ? 'required' : 'optional';
          return `\`${o.name}\`${choices} — ${o.description} *(${req})*`;
        })
        .join('\n')
        .slice(0, 1024),
    });
  }

  if (mod.help?.examples?.length) {
    embed.addFields({ name: 'Examples', value: mod.help.examples.map((e) => `\`${e}\``).join('\n').slice(0, 1024) });
  }
  if (mod.help?.notes) {
    embed.addFields({ name: 'Good to know', value: String(mod.help.notes).slice(0, 1024) });
  }

  embed.setFooter({ text: 'Type /help for the full list' }).setTimestamp();
  return embed;
}
