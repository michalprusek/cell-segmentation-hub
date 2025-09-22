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
       
      console.log(
        this.formatMessage('debug', message),
        data !== undefined ? data : ''
      );
    }
  }

  info(message: string, data?: unknown): void {
    if (this.shouldLog('info')) {
      console.info(
        this.formatMessage('info', message),
        data !== undefined ? data : ''
      );
    }
  }

  warn(message: string, data?: unknown): void {
    if (this.shouldLog('warn')) {
      console.warn(
        this.formatMessage('warn', message),
        data !== undefined ? data : ''
      );
    }
  }

  error(message: string, error?: unknown): void {
    if (this.shouldLog('error')) {
      console.error(
        this.formatMessage('error', message),
        error !== undefined ? error : ''
      );
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
