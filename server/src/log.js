import { config } from './config.js';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const threshold = LEVELS[config.logLevel] ?? LEVELS.info;

const emit = (level, msg, fields) => {
  if (LEVELS[level] > threshold) return;
  const line = { t: new Date().toISOString(), level, msg, ...fields };
  process.stdout.write(`${JSON.stringify(line)}\n`);
};

export const log = {
  error: (msg, fields) => emit('error', msg, fields),
  warn: (msg, fields) => emit('warn', msg, fields),
  info: (msg, fields) => emit('info', msg, fields),
  debug: (msg, fields) => emit('debug', msg, fields),
};
