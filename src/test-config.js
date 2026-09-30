// Helper de tests: la config real (config/servers.json, config/guilds.json) no se
// versiona, así que en CI no existe. Salvo que el test elija otra cosa, los tests
// leen las plantillas versionadas, y así la suite no depende de la máquina.
//
// Se importa como primera línea de los tests que tocan config.js. Los que quieren
// controlar la config usan __setConfig() y no se ven afectados.

import { fileURLToPath } from 'node:url';

const config = new URL('../config/', import.meta.url);

process.env.SERVERS_FILE ??= fileURLToPath(new URL('servers.example.json', config));
process.env.GUILDS_FILE ??= fileURLToPath(new URL('guilds.example.json', config));

export {};
