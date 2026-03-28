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

  debug(message: string, data?: unknown): void {
    if (this.shouldLog('debug')) {
      if (data !== undefined) {
        console.log(this.formatMessage('debug', message), data);
      } else {
        console.log(this.formatMessage('debug', message));
      }
    }
  }

  info(message: string, data?: unknown): void {
    if (this.shouldLog('info')) {
      if (data !== undefined) {
        console.info(this.formatMessage('info', message), data);
      } else {
        console.info(this.formatMessage('info', message));
      }
    }
  }

  warn(message: string, data?: unknown): void {
    if (this.shouldLog('warn')) {
      if (data !== undefined) {
        console.warn(this.formatMessage('warn', message), data);
      } else {
        console.warn(this.formatMessage('warn', message));
      }
    }
  }

  error(message: string, error?: unknown): void {
    if (this.shouldLog('error')) {
      if (error !== undefined) {
        console.error(this.formatMessage('error', message), error);
      } else {
        console.error(this.formatMessage('error', message));
      }
    }
  }

  // Group related logs together
  group(label: string): void {
    if (this.isDevelopment) {
      console.group(label);
    }
  }

  groupEnd(): void {
    if (this.isDevelopment) {
      console.groupEnd();
    }
  }

  // Performance timing
  time(label: string): void {
    if (this.isDevelopment) {
      console.time(label);
    }
  }

  timeEnd(label: string): void {
    if (this.isDevelopment) {
      console.timeEnd(label);
    }
  }
}

export const logger = new Logger();
