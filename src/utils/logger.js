/**
 * Logger configurável
 */

let currentLogLevel = 'info';

const LOG_LEVELS = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  verboso: 5
};

class Logger {
  static setLevel(level) {
    if (LOG_LEVELS[level] !== undefined) {
      currentLogLevel = level;
    }
  }
  
  static error(...args) {
    if (LOG_LEVELS[currentLogLevel] >= LOG_LEVELS.error) {
      console.error('\x1b[31m%s\x1b[0m', '❌', ...args);
    }
  }
  
  static warn(...args) {
    if (LOG_LEVELS[currentLogLevel] >= LOG_LEVELS.warn) {
      console.warn('\x1b[33m%s\x1b[0m', '⚠️', ...args);
    }
  }
  
  static info(...args) {
    if (LOG_LEVELS[currentLogLevel] >= LOG_LEVELS.info) {
      console.log('\x1b[36m%s\x1b[0m', 'ℹ️', ...args);
    }
  }
  
  static debug(...args) {
    if (LOG_LEVELS[currentLogLevel] >= LOG_LEVELS.debug) {
      console.debug('\x1b[90m%s\x1b[0m', '🔍', ...args);
    }
  }
  
  static verboso(...args) {
    if (LOG_LEVELS[currentLogLevel] >= LOG_LEVELS.verboso) {
      console.log('\x1b[35m%s\x1b[0m', '📝', ...args);
    }
  }
  
  static success(...args) {
    if (LOG_LEVELS[currentLogLevel] >= LOG_LEVELS.info) {
      console.log('\x1b[32m%s\x1b[0m', '✅', ...args);
    }
  }
}

module.exports = Logger;