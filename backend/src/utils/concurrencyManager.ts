import { logger } from './logger';

export class ConcurrencyManager {
  private active = 0;
  private queue: Array<{
    operation: () => Promise<any>;
    resolve: (value: any) => void;
    reject: (error: any) => void;
  }> = [];
  
  constructor(private maxConcurrent: number) {}
  
  async execute<T>(operation: () => Promise<T>, operationName?: string): Promise<T> {
    if (this.active >= this.maxConcurrent) {
      return new Promise((resolve, reject) => {
        this.queue.push({ operation, resolve, reject });
        logger.debug(`${operationName || 'Operation'} queued, queue size: ${this.queue.length}`);
      });
    }
    
    this.active++;
    
    try {
      const result = await operation();
      this.processQueue();
      return result;
    } catch (error) {
      this.processQueue();
      throw error;
    } finally {
      this.active--;
    }
  }
  
  private async processQueue() {
    if (this.queue.length === 0 || this.active >= this.maxConcurrent) {
      return;
    }
    
    const { operation, resolve, reject } = this.queue.shift()!;
    this.active++;
    
    try {
      const result = await operation();
      resolve(result);
    } catch (error) {
      reject(error);
    } finally {
      this.active--;
      this.processQueue();
    }
  }
  
  getStatus() {
    return {
      active: this.active,
      queued: this.queue.length,
      maxConcurrent: this.maxConcurrent
    };
  }
}