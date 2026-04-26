/**
 * @polychrome/protocol — logger.ts
 *
 * Tiny structured logger.  Every module that needs logging must import
 * `log` from here; raw console.log is banned by the lint rule.
 *
 * Log level is controlled (in priority order) by:
 *   1. localStorage.PC_LOG_LEVEL  (browser environments)
 *   2. process.env.PC_LOG_LEVEL   (Node / service-worker environments with
 *                                   process shim)
 *   Accepted values (case-insensitive): debug | info | warn | error | off
 *   Default: info
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'off';

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info:  1,
  warn:  2,
  error: 3,
  off:   4,
};

function readConfiguredLevel(): LogLevel {
  // Try localStorage first (browser)
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem('PC_LOG_LEVEL');
      if (raw !== null) {
        const candidate = raw.toLowerCase() as LogLevel;
        if (candidate in LEVEL_RANK) return candidate;
      }
    }
  } catch {
    // localStorage access can throw in some contexts (e.g. sandboxed iframes)
  }

  // Try process.env (Node / bundler shim)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- @reason: process is a Node global that may not exist
    const env = (globalThis as any)['process']?.env?.['PC_LOG_LEVEL'];
    if (typeof env === 'string') {
      const candidate = env.toLowerCase() as LogLevel;
      if (candidate in LEVEL_RANK) return candidate;
    }
  } catch {
    // process may not exist
  }

  return 'info';
}

function isEnabled(messageLevel: LogLevel): boolean {
  const configured = readConfiguredLevel();
  return LEVEL_RANK[messageLevel] >= LEVEL_RANK[configured];
}

export interface Logger {
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

function makeLogger(namespace: string): Logger {
  const prefix = `[PC:${namespace}]`;

  return {
    debug(msg, ...args) {
      if (isEnabled('debug')) {
        // eslint-disable-next-line no-console -- @reason: this IS the logger implementation
        console.debug(prefix, msg, ...args);
      }
    },
    info(msg, ...args) {
      if (isEnabled('info')) {
        // eslint-disable-next-line no-console -- @reason: this IS the logger implementation
        console.info(prefix, msg, ...args);
      }
    },
    warn(msg, ...args) {
      if (isEnabled('warn')) {
        // eslint-disable-next-line no-console -- @reason: this IS the logger implementation
        console.warn(prefix, msg, ...args);
      }
    },
    error(msg, ...args) {
      if (isEnabled('error')) {
        // eslint-disable-next-line no-console -- @reason: this IS the logger implementation
        console.error(prefix, msg, ...args);
      }
    },
  };
}

/**
 * Default logger for the protocol package.
 * Other packages may call makeLogger('my-namespace') to get a namespaced instance.
 */
export const log: Logger = makeLogger('protocol');

/** Create a namespaced child logger. */
export { makeLogger };
