/**
 * HaloFire Logger
 * Structured JSON logging with file + console output
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.resolve(__dirname, '../../data/logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const COLORS = { error: '\x1b[31m', warn: '\x1b[33m', info: '\x1b[36m', debug: '\x1b[90m' };
const RESET = '\x1b[0m';

export function createLogger(module) {
  const logLevel = process.env.LOG_LEVEL || 'info';

  function log(level, message, data = {}) {
    if (LEVELS[level] > LEVELS[logLevel]) return;

    const entry = {
      timestamp: new Date().toISOString(),
      level,
      module,
      message,
      ...data,
    };

    // Console (colored)
    const prefix = `${COLORS[level]}[${level.toUpperCase()}]${RESET}`;
    const mod = `\x1b[90m[${module}]${RESET}`;
    const extra = Object.keys(data).length ? ` ${JSON.stringify(data)}` : '';
    console.log(`${prefix} ${mod} ${message}${extra}`);

    // File (JSON lines)
    const logFile = path.join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}.jsonl`);
    fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
  }

  return {
    error: (msg, data) => log('error', msg, data),
    warn: (msg, data) => log('warn', msg, data),
    info: (msg, data) => log('info', msg, data),
    debug: (msg, data) => log('debug', msg, data),
  };
}
