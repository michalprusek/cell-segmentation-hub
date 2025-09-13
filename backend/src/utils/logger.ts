import { Request, Response, NextFunction } from 'express';

// Check environment directly to avoid circular dependency
const isDevelopment = process.env.NODE_ENV === 'development';

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: Date;
  context?: string;
  data?: Record<string, unknown> | string | number | boolean | null;
  error?: Error;
}

class Logger {
  private currentLevel: LogLevel;

  constructor() {
    this.currentLevel = isDevelopment ? LogLevel.DEBUG : LogLevel.INFO;
  }

  private shouldLog(level: LogLevel): boolean {
    return level <= this.currentLevel;
  }

  private formatMessage(entry: LogEntry): string {
    const timestamp = entry.timestamp.toISOString();
    const level = LogLevel[entry.level].padEnd(5);
    const context = entry.context ? `[${entry.context}] ` : '';
    
    let message = `${timestamp} ${level} ${context}${entry.message}`;
    
    if (entry.data) {
      message += `\nData: ${JSON.stringify(entry.data, null, 2)}`;
    }
    
    if (entry.error) {
      message += `\nError: ${entry.error.message}`;
      if (entry.error.stack) {
        message += `\nStack: ${entry.error.stack}`;
      }
    }
    
    return message;
  }

  private log(entry: LogEntry): void {
    if (!this.shouldLog(entry.level)) {
      return;
    }

    const message = this.formatMessage(entry);
    
     
    // Console output is the core functionality of a logger
    switch (entry.level) {
      case LogLevel.ERROR:
        // Error logging to console
         
        console.error(message);
        break;
      case LogLevel.WARN:
        // Warning logging to console
         
        console.warn(message);
        break;
      case LogLevel.INFO:
        // Info logging to console
         
        console.info(message);
        break;
      case LogLevel.DEBUG:
        // Debug logging to console
         
        console.debug(message);
        break;
    }
     
  }

  error(message: string, error?: Error, context?: string, data?: Record<string, unknown> | string | number | boolean | null): void {
    this.log({
      level: LogLevel.ERROR,
      message,
      timestamp: new Date(),
      context,
      data,
      error
    });
  }

  warn(message: string, context?: string, data?: Record<string, unknown> | string | number | boolean | null): void {
    this.log({
      level: LogLevel.WARN,
      message,
      timestamp: new Date(),
      context,
      data
    });
  }

  info(message: string, context?: string, data?: Record<string, unknown> | string | number | boolean | null): void {
    this.log({
      level: LogLevel.INFO,
      message,
      timestamp: new Date(),
      context,
      data
    });
  }

  debug(message: string, context?: string, data?: Record<string, unknown> | string | number | boolean | null): void {
    this.log({
      level: LogLevel.DEBUG,
      message,
      timestamp: new Date(),
      context,
      data
    });
  }

  setLevel(level: LogLevel): void {
    this.currentLevel = level;
  }
}

export const logger = new Logger();

// Helper function for express middleware
export const createRequestLogger = (context = 'HTTP'): (req: Request, res: Response, next: NextFunction) => void => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const start = Date.now();
    
    res.on('finish', () => {
      const duration = Date.now() - start;
      const { method, url, ip } = req;
      const { statusCode } = res;
      
      const message = `${method} ${url} ${statusCode} ${duration}ms`;
      const logData = {
        method,
        url,
        statusCode,
        duration,
        ip,
        userAgent: req.get('User-Agent')
      };

      if (statusCode >= 500) {
        logger.error(message, undefined, context, logData);
      } else if (statusCode >= 400) {
        logger.warn(message, context, logData);
      } else {
        logger.info(message, context, logData);
      }
    });

    next();
  };
};