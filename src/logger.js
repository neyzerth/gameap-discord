const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const level = LEVELS[process.env.LOG_LEVEL ?? 'info'] ?? LEVELS.info;

const stamp = () => new Date().toISOString();

export const log = {
  error: (...args) => level >= LEVELS.error && console.error(stamp(), 'ERROR', ...args),
  warn: (...args) => level >= LEVELS.warn && console.warn(stamp(), 'WARN ', ...args),
  info: (...args) => level >= LEVELS.info && console.log(stamp(), 'INFO ', ...args),
  debug: (...args) => level >= LEVELS.debug && console.log(stamp(), 'DEBUG', ...args),
};
