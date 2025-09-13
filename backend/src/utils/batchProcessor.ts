import { logger } from './logger';
import { ConcurrencyManager } from './concurrencyManager';

export interface BatchOptions {
  batchSize: number;
  concurrency?: number;
  onBatchComplete?: (batchIndex: number, results: unknown[]) => void;
  onItemError?: (item: unknown, error: unknown) => void;
}

export class BatchProcessor {
  async processBatch<T, R>(
    items: T[],
    processor: (item: T) => Promise<R>,
    options: BatchOptions
  ): Promise<R[]> {
    const results: R[] = [];
    const concurrencyManager = options.concurrency 
      ? new ConcurrencyManager(options.concurrency)
      : null;
    
    for (let i = 0; i < items.length; i += options.batchSize) {
      const batch = items.slice(i, i + options.batchSize);
      const batchIndex = Math.floor(i / options.batchSize);
      
      logger.debug(`Processing batch ${batchIndex + 1}/${Math.ceil(items.length / options.batchSize)}`);
      
      const batchPromises = batch.map(item => {
        const processItem = async (): Promise<R> => {
          try {
            return await processor(item);
          } catch (error) {
            if (options.onItemError) {
              options.onItemError(item, error);
            }
            throw error;
          }
        };
        
        return concurrencyManager
          ? concurrencyManager.execute(processItem) as Promise<R>
          : processItem();
      });
      
      const batchResults = await Promise.allSettled(batchPromises);
      
      const successfulResults = batchResults
        .filter(r => r.status === 'fulfilled')
        .map(r => (r as PromiseFulfilledResult<R>).value);
      
      results.push(...successfulResults);
      
      if (options.onBatchComplete) {
        options.onBatchComplete(batchIndex, successfulResults);
      }
    }
    
    return results;
  }
  
  async processInChunks<T, R>(
    items: T[],
    processor: (chunk: T[]) => Promise<R[]>,
    chunkSize: number
  ): Promise<R[]> {
    const results: R[] = [];
    
    for (let i = 0; i < items.length; i += chunkSize) {
      const chunk = items.slice(i, i + chunkSize);
      const chunkResults = await processor(chunk);
      results.push(...chunkResults);
    }
    
    return results;
  }
}

export const batchProcessor = new BatchProcessor();