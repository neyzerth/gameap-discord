import { Client, GatewayIntentBits, Events, MessageFlags } from 'discord.js';
import { startWatcher } from './watcher.js';
import { loadCommands } from './registry.js';
import { save, loadFeeds, loadAutoStop, getState } from './state.js';
import { setOverrides, setAutoStopOverrides, localeFor } from './config.js';
import { t } from './i18n/index.js';
import { log } from './logger.js';

function requireEnv() {
  const missing = ['DISCORD_TOKEN', 'GAMEAP_TOKEN'].filter((key) => !process.env[key]);
  if (missing.length) {
    log.error(`missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
}

async function main() {
  requireEnv();
  setOverrides(loadFeeds());
  setAutoStopOverrides(loadAutoStop());

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  client.commands = await loadCommands();
  log.info(`loaded ${client.commands.size} commands`);

  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      try {
        if (command?.autocomplete) await command.autocomplete(interaction);
        else await interaction.respond([]);
      } catch (err) {
        log.warn(`autocomplete failed: ${err.message}`);
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;
    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (err) {
      log.error(`/${interaction.commandName} failed: ${err.message}`);
      const payload = {
        content: t(localeFor(interaction.guildId), 'errors.commandFailed', { message: err.message }).slice(
          0,
          1900,
        ),
        flags: MessageFlags.Ephemeral,
      };
      if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => {});
      else await interaction.reply(payload).catch(() => {});
    }
  });

  // Events.ClientReady exists on current discord.js; fall back for older builds.
  const readyEvent = Events.ClientReady ?? 'ready';
  client.once(readyEvent, () => {
    log.info(`logged in as ${client.user.tag} — ${client.guilds.cache.size} guild(s)`);
    startWatcher(client);
  });

  // Log what we can see the moment we are invited, so config/guilds.json can be
  // filled with real ids instead of guessing.
  client.on(Events.GuildCreate, async (guild) => {
    try {
      let channels = guild.channels.cache;
      if (!channels.size) channels = await guild.channels.fetch();
      const text = [...channels.values()]
        .filter((c) => c.isTextBased?.() && !c.isThread?.())
        .slice(0, 25)
        .map((c) => `#${c.name}(${c.id})`)
        .join(' ');
      log.info(`joined guild ${guild.name} (${guild.id}) — text channels: ${text}`);
      log.info(`add "${guild.id}" to config/guilds.json (feedChannelId / servers), or run /feed <server> on in the target channel`);
    } catch (err) {
      log.warn(`joined guild ${guild?.id} but could not list its channels: ${err.message}`);
    }
  });

  const shutdown = async (signal) => {
    log.info(`${signal} received, shutting down`);
    save(getState()); // flush lo que el watcher ya persistió
    await client.destroy();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await client.login(process.env.DISCORD_TOKEN);
}

main().catch((err) => {
  log.error('fatal:', err.stack ?? err.message);
  process.exit(1);
});
