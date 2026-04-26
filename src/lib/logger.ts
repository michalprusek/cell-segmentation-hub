/**
 * Centralized logging service for the application
 * Provides environment-aware logging with different levels
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LoggerConfig {
  enabledInProduction: boolean;
  enabledInDevelopment: boolean;
  enabledInTest: boolean;
}

const logConfig: Record<LogLevel, LoggerConfig> = {
  debug: {
    enabledInProduction: false,
    enabledInDevelopment: true,
    enabledInTest: false,
  },
  info: {
    enabledInProduction: true,
    enabledInDevelopment: true,
    enabledInTest: false,
  },
  warn: {
    enabledInProduction: true,
    enabledInDevelopment: true,
    enabledInTest: true,
  },
  error: {
    enabledInProduction: true,
    enabledInDevelopment: true,
    enabledInTest: true,
  },
};

class Logger {
  private isDevelopment = import.meta.env.DEV;
  private isProduction = import.meta.env.PROD;
  private isTest = import.meta.env.MODE === 'test';

  private shouldLog(level: LogLevel): boolean {
    const config = logConfig[level];

    if (this.isProduction) return config.enabledInProduction;
    if (this.isTest) return config.enabledInTest;
    return config.enabledInDevelopment;
  }

  private formatMessage(
    level: LogLevel,
    message: string,
    data?: unknown
  ): string {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

    if (data !== undefined) {
      return `${prefix} ${message}`;
    }

    return `${prefix} ${message}`;
  }

  // Passing user-derived text as the first argument to `console.*`
  // makes it a format string — a `%s` or `%o` in the message would
  // consume the `data` argument and scramble the output (CodeQL
  // js/tainted-format-string). Use a fixed `'%s'` / `'%s %o'` template
  // and move the real content to subsequent arguments so the message
  // text can never be interpreted as format specifiers.
  debug(message: string, data?: unknown): void {
    if (this.shouldLog('debug')) {
      if (data !== undefined) {
        // eslint-disable-next-line no-console -- logger implementation
        console.log('%s %o', this.formatMessage('debug', message), data);
      } else {
        // eslint-disable-next-line no-console -- logger implementation
        console.log('%s', this.formatMessage('debug', message));
      }
    }
  }

  info(message: string, data?: unknown): void {
    if (this.shouldLog('info')) {
      if (data !== undefined) {
        console.info('%s %o', this.formatMessage('info', message), data);
      } else {
        console.info('%s', this.formatMessage('info', message));
      }
    }
  }

  warn(message: string, data?: unknown): void {
    if (this.shouldLog('warn')) {
      if (data !== undefined) {
        console.warn('%s %o', this.formatMessage('warn', message), data);
      } else {
        console.warn('%s', this.formatMessage('warn', message));
      }
    }
  }

  error(message: string, error?: unknown): void {
    if (this.shouldLog('error')) {
      if (error !== undefined) {
        console.error('%s %o', this.formatMessage('error', message), error);
      } else {
        console.error('%s', this.formatMessage('error', message));
      }
    }
  }

  // Group related logs together
  group(label: string): void {
    if (this.isDevelopment) {
      // eslint-disable-next-line no-console -- logger implementation
      console.group(label);
    }
  }

  groupEnd(): void {
    if (this.isDevelopment) {
      // eslint-disable-next-line no-console -- logger implementation
      console.groupEnd();
    }
  }

  // Performance timing
  time(label: string): void {
    if (this.isDevelopment) {
      // eslint-disable-next-line no-console -- logger implementation
      console.time(label);
    }
  }

  timeEnd(label: string): void {
    if (this.isDevelopment) {
      // eslint-disable-next-line no-console -- logger implementation
      console.timeEnd(label);
    }
  }
}

export const logger = new Logger();
