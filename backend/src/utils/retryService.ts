import { logger } from './logger';

export interface RetryConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffFactor: number;
  operationName?: string;
}

export class RetryService {
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    config: RetryConfig,
    isRetriableError?: (error: unknown) => boolean
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;

        if (attempt === config.maxRetries) {
          logger.error(
            `${config.operationName || 'Operation'} failed after ${config.maxRetries} attempts`,
            error
          );
          throw error;
        }

        if (isRetriableError && !isRetriableError(error)) {
          logger.error(
            `${config.operationName || 'Operation'} failed with non-retriable error`,
            error
          );
          throw error;
        }

        const delay = Math.min(
          config.initialDelay * Math.pow(config.backoffFactor, attempt - 1),
          config.maxDelay
        );

        logger.warn(
          `${config.operationName || 'Operation'} attempt ${attempt} failed, retrying in ${delay}ms`
        );
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  static isCommonRetriableError(error: unknown): boolean {
    if (!error) {
      return false;
    }

    const errorObj = error as { message?: string; code?: string };

    const errorMessage = errorObj.message?.toLowerCase() || '';
    const errorCode = errorObj.code?.toLowerCase() || '';

    // File system errors
    if (
      errorCode === 'enoent' ||
      errorCode === 'eacces' ||
      errorCode === 'emfile'
    ) {
      return true;
    }

    // Network errors
    if (
      errorCode === 'econnreset' ||
      errorCode === 'etimedout' ||
      errorCode === 'enotfound'
    ) {
      return true;
    }

    // Memory/resource errors
    if (errorMessage.includes('memory') || errorMessage.includes('heap')) {
      return true;
    }

    // Database errors
    if (errorCode === 'p1001' || errorCode === 'p1002') {
      return true;
    }

    // SMTP errors (from email service)
    if (
      errorMessage.includes('421') ||
      errorMessage.includes('450') ||
      errorMessage.includes('451') ||
      errorMessage.includes('452')
    ) {
      return true;
    }

    // Rate limiting
    if (
      errorMessage.includes('rate limit') ||
      errorMessage.includes('too many') ||
      errorMessage.includes('throttl')
    ) {
      return true;
    }

    // Temporary network issues
    if (
      errorMessage.includes('econnrefused') ||
      errorMessage.includes('timeout') ||
      errorMessage.includes('socket') ||
      errorMessage.includes('econnreset')
    ) {
      return true;
    }

    // Sharp/image processing temporary errors
    if (errorMessage.includes('sharp') && errorMessage.includes('memory')) {
      return true;
    }

    return false;
  }
}

export const retryService = new RetryService();
