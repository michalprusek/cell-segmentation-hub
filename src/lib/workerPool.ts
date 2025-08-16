/**
 * High-performance Web Worker pool for offloading heavy polygon computations
 * Inspired by SpheroSeg worker architecture
 */

import { Point } from '@/lib/segmentation';

export interface WorkerMessage {
  id: string;
  type: string;
  payload: unknown;
  transferables?: Transferable[];
}

export interface WorkerResponse {
  id: string;
  success: boolean;
  result?: unknown;
  error?: string;
  executionTime?: number;
}

export interface PooledWorker {
  worker: Worker;
  busy: boolean;
  taskCount: number;
  lastUsed: number;
}

export interface WorkerPoolConfig {
  maxWorkers: number;
  idleTimeout: number; // ms to keep idle workers alive
  maxTasksPerWorker: number; // Restart worker after this many tasks
}

/**
 * Abstract base class for typed worker operations
 */
export abstract class WorkerOperation<TInput, TOutput> {
  abstract readonly type: string;

  abstract execute(input: TInput): Promise<TOutput>;

  protected createMessage(
    id: string,
    payload: TInput,
    transferables?: Transferable[]
  ): WorkerMessage {
    return {
      id,
      type: this.type,
      payload,
      transferables,
    };
  }
}

/**
 * High-performance worker pool manager
 */
export class WorkerPool {
  private workers = new Map<string, PooledWorker>();
  private pendingTasks = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      startTime: number;
      workerId: string;
    }
  >();
  private taskQueue: Array<{
    message: WorkerMessage;
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }> = [];

  private config: WorkerPoolConfig;
  private nextWorkerId = 0;
  private nextTaskId = 0;
  private cleanupInterval: number | null = null;
  private executionTimes: number[] = [];
  private maxExecutionTimeHistory = 100;

  constructor(
    private workerScriptUrl: string,
    config: Partial<WorkerPoolConfig> = {}
  ) {
    this.config = {
      maxWorkers: navigator.hardwareConcurrency || 4,
      idleTimeout: 30000, // 30 seconds
      maxTasksPerWorker: 100,
      ...config,
    };

    // Start cleanup interval
    this.cleanupInterval = window.setInterval(() => {
      this.cleanupIdleWorkers();
    }, 10000); // Cleanup every 10 seconds
  }

  /**
   * Execute a task on an available worker
   */
  async execute<TInput, TOutput>(
    operation: WorkerOperation<TInput, TOutput>,
    input: TInput,
    transferables?: Transferable[]
  ): Promise<TOutput> {
    const taskId = `task_${this.nextTaskId++}`;
    const message = operation.createMessage(taskId, input, transferables);

    return new Promise<TOutput>((resolve, reject) => {
      const availableWorker = this.getAvailableWorker();

      if (availableWorker) {
        this.executeOnWorker(availableWorker, message, resolve, reject);
      } else {
        // Queue the task if no workers available
        this.taskQueue.push({ message, resolve, reject });
      }
    });
  }

  /**
   * Execute multiple tasks in parallel with automatic load balancing
   */
  async executeParallel<TInput, TOutput>(
    operation: WorkerOperation<TInput, TOutput>,
    inputs: TInput[],
    transferables?: Transferable[][]
  ): Promise<TOutput[]> {
    const promises = inputs.map((input, index) => {
      const taskTransferables = transferables?.[index];
      return this.execute(operation, input, taskTransferables);
    });

    return Promise.all(promises);
  }

  /**
   * Execute tasks in batches to prevent overwhelming the system
   */
  async executeBatched<TInput, TOutput>(
    operation: WorkerOperation<TInput, TOutput>,
    inputs: TInput[],
    batchSize: number = this.config.maxWorkers
  ): Promise<TOutput[]> {
    const results: TOutput[] = [];

    for (let i = 0; i < inputs.length; i += batchSize) {
      const batch = inputs.slice(i, i + batchSize);
      const batchResults = await this.executeParallel(operation, batch);
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Get an available worker or create one if possible
   */
  private getAvailableWorker(): PooledWorker | null {
    // Find an idle worker
    for (const worker of this.workers.values()) {
      if (!worker.busy) {
        return worker;
      }
    }

    // Create new worker if under limit
    if (this.workers.size < this.config.maxWorkers) {
      return this.createWorker();
    }

    return null;
  }

  /**
   * Create a new worker instance
   */
  private createWorker(): PooledWorker {
    const workerId = `worker_${this.nextWorkerId++}`;
    const worker = new Worker(this.workerScriptUrl);

    const pooledWorker: PooledWorker = {
      worker,
      busy: false,
      taskCount: 0,
      lastUsed: Date.now(),
    };

    // Set up message handling
    worker.onmessage = event => {
      this.handleWorkerMessage(workerId, event.data);
    };

    worker.onerror = error => {
      this.handleWorkerError(workerId, error);
    };

    this.workers.set(workerId, pooledWorker);
    return pooledWorker;
  }

  /**
   * Execute a task on a specific worker
   */
  private executeOnWorker(
    pooledWorker: PooledWorker,
    message: WorkerMessage,
    resolve: (value: unknown) => void,
    reject: (error: Error) => void
  ): void {
    pooledWorker.busy = true;
    pooledWorker.taskCount++;
    pooledWorker.lastUsed = Date.now();

    // Get workerId for this pooledWorker
    let workerId = '';
    for (const [id, worker] of this.workers.entries()) {
      if (worker === pooledWorker) {
        workerId = id;
        break;
      }
    }

    // Store the promise callbacks
    this.pendingTasks.set(message.id, {
      resolve,
      reject,
      startTime: performance.now(),
      workerId,
    });

    // Send the message with transferables if provided
    if (message.transferables && message.transferables.length > 0) {
      pooledWorker.worker.postMessage(message, message.transferables);
    } else {
      pooledWorker.worker.postMessage(message);
    }
  }

  /**
   * Handle messages from workers
   */
  private handleWorkerMessage(
    workerId: string,
    response: WorkerResponse
  ): void {
    const pooledWorker = this.workers.get(workerId);
    if (!pooledWorker) return;

    const task = this.pendingTasks.get(response.id);
    if (!task) return;

    // Clean up
    this.pendingTasks.delete(response.id);
    pooledWorker.busy = false;

    // Calculate execution time and track for statistics
    const executionTime = performance.now() - task.startTime;
    this.executionTimes.push(executionTime);

    // Keep only recent execution times for moving average
    if (this.executionTimes.length > this.maxExecutionTimeHistory) {
      this.executionTimes.shift();
    }

    if (response.success) {
      task.resolve(response.result);
    } else {
      task.reject(new Error(response.error || 'Worker task failed'));
    }

    // Check if worker should be recycled
    if (pooledWorker.taskCount >= this.config.maxTasksPerWorker) {
      this.recycleWorker(workerId);
    }

    // Process queued tasks
    this.processQueue();
  }

  /**
   * Handle worker errors
   */
  private handleWorkerError(workerId: string, error: ErrorEvent): void {
    const pooledWorker = this.workers.get(workerId);
    if (!pooledWorker) return;

    // Only reject pending tasks assigned to this specific worker
    const tasksToReject: string[] = [];
    for (const [taskId, task] of this.pendingTasks.entries()) {
      // Check if this task was assigned to the failed worker
      if (task.workerId === workerId) {
        tasksToReject.push(taskId);
      }
    }

    // Reject only tasks from the failed worker
    for (const taskId of tasksToReject) {
      const task = this.pendingTasks.get(taskId);
      if (task) {
        task.reject(new Error(`Worker ${task.workerId} error: ${error.message}`));
        this.pendingTasks.delete(taskId);
      }
    }

    // Remove the failed worker
    this.workers.delete(workerId);
    pooledWorker.worker.terminate();

    // Process queue with remaining workers
    this.processQueue();
  }

  /**
   * Process queued tasks when workers become available
   */
  private processQueue(): void {
    while (this.taskQueue.length > 0) {
      const availableWorker = this.getAvailableWorker();
      if (!availableWorker) break;

      const queuedTask = this.taskQueue.shift()!;
      this.executeOnWorker(
        availableWorker,
        queuedTask.message,
        queuedTask.resolve,
        queuedTask.reject
      );
    }
  }

  /**
   * Recycle a worker that has completed too many tasks
   */
  private recycleWorker(workerId: string): void {
    const pooledWorker = this.workers.get(workerId);
    if (!pooledWorker || pooledWorker.busy) return;

    this.workers.delete(workerId);
    pooledWorker.worker.terminate();

    // Create a replacement worker if needed
    if (
      this.workers.size < this.config.maxWorkers &&
      this.taskQueue.length > 0
    ) {
      this.createWorker();
    }
  }

  /**
   * Clean up idle workers to free memory
   */
  private cleanupIdleWorkers(): void {
    const now = Date.now();
    const workersToRemove: string[] = [];

    for (const [workerId, pooledWorker] of this.workers.entries()) {
      if (
        !pooledWorker.busy &&
        now - pooledWorker.lastUsed > this.config.idleTimeout
      ) {
        workersToRemove.push(workerId);
      }
    }

    for (const workerId of workersToRemove) {
      const pooledWorker = this.workers.get(workerId);
      if (pooledWorker) {
        this.workers.delete(workerId);
        pooledWorker.worker.terminate();
      }
    }
  }

  /**
   * Get pool statistics
   */
  getStats() {
    const workers = Array.from(this.workers.values());

    return {
      totalWorkers: this.workers.size,
      busyWorkers: workers.filter(w => w.busy).length,
      idleWorkers: workers.filter(w => !w.busy).length,
      queuedTasks: this.taskQueue.length,
      pendingTasks: this.pendingTasks.size,
      maxWorkers: this.config.maxWorkers,
      averageTaskCount:
        workers.length > 0
          ? workers.reduce((sum, w) => sum + w.taskCount, 0) / workers.length
          : 0,
      averageExecutionTime: this.getAverageExecutionTime(),
      executionTimeHistory: this.executionTimes.length,
    };
  }

  /**
   * Warm up the pool by creating workers in advance
   */
  async warmUp(workerCount: number = this.config.maxWorkers): void {
    const promises: Promise<void>[] = [];

    for (let i = 0; i < Math.min(workerCount, this.config.maxWorkers); i++) {
      promises.push(
        new Promise<void>((resolve, reject) => {
          try {
            const pooledWorker = this.createWorker();

            // Wait for worker to be properly initialized
            const worker = pooledWorker.worker;

            // Test worker with a simple ping operation
            const testMessage = { type: 'ping', taskId: `warmup_${i}` };

            const onMessage = (event: MessageEvent<WorkerResponse>) => {
              if (event.data.taskId === testMessage.taskId) {
                worker.removeEventListener('message', onMessage);
                worker.removeEventListener('error', onError);
                resolve();
              }
            };

            const onError = (error: ErrorEvent) => {
              worker.removeEventListener('message', onMessage);
              worker.removeEventListener('error', onError);
              reject(
                new Error(`Worker initialization failed: ${error.message}`)
              );
            };

            worker.addEventListener('message', onMessage);
            worker.addEventListener('error', onError);
            worker.postMessage(testMessage);

            // Fallback timeout in case worker doesn't respond
            setTimeout(() => {
              worker.removeEventListener('message', onMessage);
              worker.removeEventListener('error', onError);
              resolve(); // Resolve anyway to avoid hanging
            }, 5000);
          } catch (error) {
            reject(error);
          }
        })
      );
    }

    await Promise.all(promises);
  }

  /**
   * Terminate all workers and clean up
   */
  terminate(): void {
    // Cancel cleanup interval
    if (this.cleanupInterval !== null) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Reject all pending tasks
    for (const task of this.pendingTasks.values()) {
      task.reject(new Error(`Worker pool terminated (worker: ${task.workerId})`));
    }
    this.pendingTasks.clear();

    // Reject all queued tasks
    for (const queuedTask of this.taskQueue) {
      queuedTask.reject(new Error('Worker pool terminated'));
    }
    this.taskQueue = [];

    // Terminate all workers
    for (const pooledWorker of this.workers.values()) {
      pooledWorker.worker.terminate();
    }
    this.workers.clear();
  }

  /**
   * Check if the pool can handle additional tasks
   */
  canAcceptTasks(): boolean {
    return this.getAvailableWorker() !== null || this.taskQueue.length < 100;
  }

  /**
   * Get estimated time to complete all pending and queued tasks
   */
  getEstimatedCompletionTime(): number {
    const totalTasks = this.pendingTasks.size + this.taskQueue.length;

    if (totalTasks === 0) return 0;

    // Calculate real average task time based on execution history
    const averageTaskTime = this.getAverageExecutionTime();
    const availableWorkers = Math.max(1, this.workers.size);

    return (totalTasks / availableWorkers) * averageTaskTime;
  }

  /**
   * Get actual measured average execution time
   */
  private getAverageExecutionTime(): number {
    if (this.executionTimes.length === 0) {
      return 50; // Fallback default for initial estimation
    }

    const sum = this.executionTimes.reduce((acc, time) => acc + time, 0);
    return sum / this.executionTimes.length;
  }
}
