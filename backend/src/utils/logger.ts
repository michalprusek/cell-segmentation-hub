import { Request, Response, NextFunction } from 'express';

// Check environment directly to avoid circular dependency
const isDevelopment = process.env.NODE_ENV === 'development';

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
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

  /** Strip CR/LF and control chars from user-controlled log fields so an
   *  attacker-set value (e.g. an uploaded filename or image name) can't forge
   *  extra log lines (CWE-117). The intentional `\nData:`/`\nError:`/`\nStack:`
   *  separators below are added after this and are preserved.
   *
   *  CR/LF first and on its own: a newline is a *record* separator, so it is
   *  the character that turns one field into two log lines. The second pass
   *  removes the remaining C0 controls and DEL, which do not forge a record
   *  but do let a value repaint or hide part of the line in a terminal. */
  private sanitize(value: string): string {
    return (
      value
        .replace(/[\r\n]/g, ' ')
        // eslint-disable-next-line no-control-regex -- stripping controls is the point
        .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    );
  }

  /** Sanitize a value that is *meant* to span several lines (a stack trace).
   *
   *  Folding a stack onto one line would make it unreadable, so instead each
   *  line is sanitized individually and the block is re-joined with our own
   *  newline plus an indent. Two things follow: a CR/LF the attacker put
   *  inside the error message cannot introduce an un-indented line, and every
   *  continuation line is visibly a continuation rather than something that
   *  could pass for a new record. Only V8's own frame separators survive. */
  private sanitizeBlock(value: string): string {
    return value
      .split(/\r?\n/)
      .map(line => this.sanitize(line))
      .join('\n    ');
  }

  private formatMessage(entry: LogEntry): string {
    const timestamp = entry.timestamp.toISOString();
    const level = LogLevel[entry.level].padEnd(5);
    const context = entry.context
      ? `[${this.sanitize(entry.context)}] `
      : '';

    let message = `${timestamp} ${level} ${context}${this.sanitize(
      entry.message
    )}`;

    if (entry.data) {
      // `data` is the last field that reached the sink unsanitized. Its
      // string values are already JSON-escaped, so a newline inside one
      // cannot forge a record -- but the object is attacker-shaped
      // (request ids, filenames, channel names), and JSON escaping is not a
      // control-character filter: it leaves C1 and DEL alone, which can still
      // repaint a terminal line. Run it through the same block sanitizer the
      // stack trace uses, so the pretty-printed structure survives while every
      // continuation line stays visibly a continuation.
      message += `\nData: ${this.sanitizeBlock(
        JSON.stringify(entry.data, null, 2)
      )}`;
    }

    if (entry.error) {
      // An Error's message and stack are NOT trusted text. Half the throws in
      // this codebase interpolate a request value into the message (an
      // uploaded filename, a channel name, a rejected MIME type), and a
      // library's exception can quote bytes straight out of a user's file. Up
      // to now those two fields were the only parts of a record appended
      // without going through `sanitize`, which made them the way to forge a
      // log line — while `entry.message` and `entry.context`, which are
      // usually OUR literals, were the parts that got sanitized.
      message += `\nError: ${this.sanitize(entry.error.message)}`;
      if (entry.error.stack) {
        message += `\nStack: ${this.sanitizeBlock(entry.error.stack)}`;
      }
    }

    return message;
  }

  private log(entry: LogEntry): void {
    if (!this.shouldLog(entry.level)) {
      return;
    }

    const message = this.formatMessage(entry);

    // Console output is the core functionality of a logger.
    /* eslint-disable no-console -- console is the logger's intended sink */
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
    /* eslint-enable no-console */
  }

  error(
    message: string,
    error?: Error,
    context?: string,
    data?: Record<string, unknown> | string | number | boolean | null
  ): void {
    this.log({
      level: LogLevel.ERROR,
      message,
      timestamp: new Date(),
      context,
      data,
      error,
    });
  }

  warn(
    message: string,
    context?: string,
    data?: Record<string, unknown> | string | number | boolean | null
  ): void {
    this.log({
      level: LogLevel.WARN,
      message,
      timestamp: new Date(),
      context,
      data,
    });
  }

  info(
    message: string,
    context?: string,
    data?: Record<string, unknown> | string | number | boolean | null
  ): void {
    this.log({
      level: LogLevel.INFO,
      message,
      timestamp: new Date(),
      context,
      data,
    });
  }

  debug(
    message: string,
    context?: string,
    data?: Record<string, unknown> | string | number | boolean | null
  ): void {
    this.log({
      level: LogLevel.DEBUG,
      message,
      timestamp: new Date(),
      context,
      data,
    });
  }

  setLevel(level: LogLevel): void {
    this.currentLevel = level;
  }
}

export const logger = new Logger();

// Helper function for express middleware
export const createRequestLogger = (
  context = 'HTTP'
): ((req: Request, res: Response, next: NextFunction) => void) => {
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
        userAgent: req.get('User-Agent'),
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
