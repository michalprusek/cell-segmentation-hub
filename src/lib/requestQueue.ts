/**
 * Request Queue Utility
 * Manages API request concurrency to prevent rate limiting issues
 */

import { logger } from '@/lib/logger';

interface QueuedRequest<T> {
  id: string;
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: any) => void;
  retries: number;
  priority?: number;
}

export class RequestQueue {
  private queue: QueuedRequest<any>[] = [];
  private processing = false;
  private concurrentRequests = 0;
  private maxConcurrent: number;
  private requestDelay: number;
  private maxRetries: number;
  private lastRequestTime = 0;

  constructor(
    options: {
      maxConcurrent?: number;
      requestDelay?: number;
      maxRetries?: number;
    } = {}
  ) {
    this.maxConcurrent = options.maxConcurrent || 5;
    this.requestDelay = options.requestDelay || 100; // ms between requests
    this.maxRetries = options.maxRetries || 2;
  }

  /**
   * Add a request to the queue
   */
  async add<T>(
    id: string,
    execute: () => Promise<T>,
    priority: number = 0
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const request: QueuedRequest<T> = {
        id,
        execute,
        resolve,
        reject,
        retries: 0,
        priority,
      };

      // Add to queue based on priority
      const insertIndex = this.queue.findIndex(
        item => (item.priority || 0) < priority
      );

      if (insertIndex === -1) {
        this.queue.push(request);
      } else {
        this.queue.splice(insertIndex, 0, request);
      }

      logger.debug(`Request queued: ${id}`, {
        queueLength: this.queue.length,
        priority,
      });

      this.process();
    });
  }

  /**
   * Process the queue
   */
  private async process(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (
      this.queue.length > 0 &&
      this.concurrentRequests < this.maxConcurrent
    ) {
      const request = this.queue.shift();
      if (!request) break;

      // Enforce minimum delay between requests
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;
      if (timeSinceLastRequest < this.requestDelay) {
        await this.delay(this.requestDelay - timeSinceLastRequest);
      }
      this.lastRequestTime = Date.now();

      this.concurrentRequests++;
      this.executeRequest(request);
    }

    this.processing = false;
  }

  /**
   * Execute a single request with retry logic
   */
  private async executeRequest<T>(request: QueuedRequest<T>): Promise<void> {
    try {
      logger.debug(`Executing request: ${request.id}`, {
        concurrent: this.concurrentRequests,
        remaining: this.queue.length,
      });

      const result = await request.execute();
      request.resolve(result);

      logger.debug(`Request completed: ${request.id}`);
    } catch (error: any) {
      const isRateLimit =
        error?.response?.status === 503 || error?.response?.status === 429;

      if (isRateLimit && request.retries < this.maxRetries) {
        request.retries++;
        const backoffDelay = Math.min(
          1000 * Math.pow(2, request.retries),
          10000
        );

        logger.warn(`Request rate limited, retrying: ${request.id}`, {
          retry: request.retries,
          delay: backoffDelay,
        });

        // Re-queue with exponential backoff
        setTimeout(() => {
          this.queue.unshift(request);
          this.process();
        }, backoffDelay);
      } else {
        logger.error(`Request failed: ${request.id}`, error);
        request.reject(error);
      }
    } finally {
      this.concurrentRequests--;

      // Continue processing queue
      if (this.queue.length > 0) {
        setTimeout(() => this.process(), 0);
      }
    }
  }

  /**
   * Utility delay function
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Clear the queue
   */
  clear(): void {
    this.queue.forEach(request => {
      request.reject(new Error('Queue cleared'));
    });
    this.queue = [];
    logger.debug('Request queue cleared');
  }

  /**
   * Get queue status
   */
  getStatus(): {
    queueLength: number;
    processing: boolean;
    concurrent: number;
  } {
    return {
      queueLength: this.queue.length,
      processing: this.processing,
      concurrent: this.concurrentRequests,
    };
  }
}

// Singleton instance for segmentation requests
export const segmentationQueue = new RequestQueue({
  maxConcurrent: 5,
  requestDelay: 100, // 100ms between requests
  maxRetries: 2,
});
