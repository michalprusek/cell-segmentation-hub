import { CircuitBreaker, CircuitState, createCircuitBreaker } from '../../utils/circuitBreaker';
import { logger } from '../../utils/logger';

/**
 * Test helpers and utilities for circuit breaker testing
 */

// Mock operation that can simulate different types of failures
export class MockOperation {
  private callCount = 0;
  private failurePattern: boolean[] = [];
  private responseDelays: number[] = [];
  private currentIndex = 0;

  constructor(
    pattern: boolean[] = [true], // true = success, false = failure
    delays: number[] = [0] // delay in ms for each call
  ) {
    this.failurePattern = pattern;
    this.responseDelays = delays;
  }

  async execute(): Promise<string> {
    const shouldSucceed = this.failurePattern[this.currentIndex % this.failurePattern.length];
    const delay = this.responseDelays[this.currentIndex % this.responseDelays.length];
    
    this.callCount++;
    this.currentIndex++;

    // Simulate response delay
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    if (shouldSucceed) {
      return `Success #${this.callCount}`;
    } else {
      throw new Error(`Mock failure #${this.callCount}`);
    }
  }

  getCallCount(): number {
    return this.callCount;
  }

  reset(): void {
    this.callCount = 0;
    this.currentIndex = 0;
  }
}

// Test scenarios for circuit breaker behavior
export const testScenarios = {
  // Scenario 1: Circuit opens after threshold failures
  async testCircuitOpening(breaker: CircuitBreaker, failureThreshold: number): Promise<boolean> {
    const mockOp = new MockOperation([false]); // Always fail
    
    try {
      // Make calls until circuit should open
      for (let i = 0; i < failureThreshold + 1; i++) {
        try {
          await breaker.call(() => mockOp.execute());
        } catch (_error) {
          // Expected failures
        }
      }
      
      // Circuit should be open now
      const isOpen = breaker.getState() === CircuitState.OPEN;
      
      // Try one more call - should be rejected immediately
      let wasRejected = false;
      try {
        await breaker.call(() => mockOp.execute());
      } catch (_error) {
        wasRejected = error.message.includes('Circuit breaker is OPEN');
      }
      
      return isOpen && wasRejected;
      
    } catch (_error) {
      logger.error('Circuit opening test failed', error);
      return false;
    }
  },

  // Scenario 2: Circuit closes after successful recovery
  async testCircuitRecovery(
    breaker: CircuitBreaker, 
    successThreshold: number,
    resetTimeout: number
  ): Promise<boolean> {
    const mockOp = new MockOperation([true]); // Always succeed
    
    try {
      // Force circuit to open
      breaker.trip();
      
      // Wait for reset timeout
      await new Promise(resolve => setTimeout(resolve, resetTimeout + 100));
      
      // Circuit should transition to HALF_OPEN and then to CLOSED after successes
      for (let i = 0; i < successThreshold; i++) {
        await breaker.call(() => mockOp.execute());
      }
      
      return breaker.getState() === CircuitState.CLOSED;
      
    } catch (_error) {
      logger.error('Circuit recovery test failed', error);
      return false;
    }
  },

  // Scenario 3: Circuit handles timeout failures
  async testTimeoutHandling(breaker: CircuitBreaker, timeout: number): Promise<boolean> {
    const mockOp = new MockOperation([true], [timeout + 500]); // Delay longer than timeout
    
    try {
      let timedOut = false;
      try {
        await breaker.call(() => mockOp.execute());
      } catch (_error) {
        timedOut = error.message.includes('timeout');
      }
      
      return timedOut;
      
    } catch (_error) {
      logger.error('Timeout handling test failed', error);
      return false;
    }
  },

  // Scenario 4: Circuit handles mixed success/failure patterns
  async testMixedPattern(breaker: CircuitBreaker): Promise<{ stats: any; finalState: CircuitState }> {
    const pattern = [true, true, false, true, false, false, true]; // Mixed pattern
    const mockOp = new MockOperation(pattern);
    
    const results = [];
    
    for (let i = 0; i < pattern.length; i++) {
      try {
        const result = await breaker.call(() => mockOp.execute());
        results.push({ success: true, result });
      } catch (_error) {
        results.push({ success: false, error: error.message });
      }
    }
    
    return {
      stats: breaker.getStats(),
      finalState: breaker.getState()
    };
  }
};

// Chaos testing utilities for resilience testing
export class ChaosTestRunner {
  private operations: Array<() => Promise<any>> = [];
  private chaosScenarios: Array<{
    name: string;
    execute: () => Promise<void>;
    probability: number;
  }> = [];

  // Add operation to test
  addOperation(name: string, operation: () => Promise<any>): void {
    this.operations.push(operation);
  }

  // Add chaos scenario
  addChaosScenario(
    name: string,
    scenario: () => Promise<void>,
    probability = 0.1
  ): void {
    this.chaosScenarios.push({ name, execute: scenario, probability });
  }

  // Run chaos test
  async runChaosTest(
    durationMs: number,
    concurrentOperations = 10
  ): Promise<ChaosTestResults> {
    const startTime = Date.now();
    const results: ChaosTestResults = {
      totalOperations: 0,
      successfulOperations: 0,
      failedOperations: 0,
      chaosEventsTriggered: 0,
      averageResponseTime: 0,
      errors: {},
      chaosEvents: []
    };

    const responseTimes: number[] = [];

    logger.info(`Starting chaos test for ${durationMs}ms with ${concurrentOperations} concurrent operations`);

    while (Date.now() - startTime < durationMs) {
      const promises: Promise<any>[] = [];

      // Execute concurrent operations
      for (let i = 0; i < concurrentOperations && this.operations.length > 0; i++) {
        const operation = this.operations[Math.floor(Math.random() * this.operations.length)];
        
        promises.push(
          this.executeOperationWithTracking(operation, results, responseTimes)
        );
      }

      // Maybe trigger chaos
      await this.maybeExecuteChaos(results);

      // Wait for operations to complete
      await Promise.allSettled(promises);

      // Small delay between rounds
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    results.averageResponseTime = responseTimes.length > 0 
      ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length 
      : 0;

    logger.info(`Chaos test completed`, results);
    return results;
  }

  private async executeOperationWithTracking(
    operation: () => Promise<any>,
    results: ChaosTestResults,
    responseTimes: number[]
  ): Promise<void> {
    const startTime = Date.now();
    results.totalOperations++;

    try {
      await operation();
      results.successfulOperations++;
    } catch (_error) {
      results.failedOperations++;
      
      const errorType = error.constructor.name || 'UnknownError';
      results.errors[errorType] = (results.errors[errorType] || 0) + 1;
    }

    responseTimes.push(Date.now() - startTime);
  }

  private async maybeExecuteChaos(results: ChaosTestResults): Promise<void> {
    for (const scenario of this.chaosScenarios) {
      if (Math.random() < scenario.probability) {
        try {
          await scenario.execute();
          results.chaosEventsTriggered++;
          results.chaosEvents.push({
            name: scenario.name,
            timestamp: new Date()
          });
          
          logger.warn(`Chaos event triggered: ${scenario.name}`);
        } catch (_error) {
          logger.error(`Chaos scenario failed: ${scenario.name}`, error);
        }
      }
    }
  }
}

export interface ChaosTestResults {
  totalOperations: number;
  successfulOperations: number;
  failedOperations: number;
  chaosEventsTriggered: number;
  averageResponseTime: number;
  errors: Record<string, number>;
  chaosEvents: Array<{
    name: string;
    timestamp: Date;
  }>;
}

// Pre-built chaos scenarios
export const chaosScenarios = {
  // Network delays
  networkDelay: (minMs = 1000, maxMs = 5000) => async () => {
    const delay = Math.random() * (maxMs - minMs) + minMs;
    await new Promise(resolve => setTimeout(resolve, delay));
  },

  // Service unavailability
  serviceUnavailable: (breaker: CircuitBreaker) => async () => {
    breaker.trip(); // Force circuit open
    logger.warn('Chaos: Forced service unavailable');
  },

  // Memory pressure simulation
  memoryPressure: (sizeMB = 100) => async () => {
    const _bigArray = new Array(sizeMB * 1024 * 1024).fill('x');
    await new Promise(resolve => setTimeout(resolve, 1000));
    // Array will be garbage collected
  },

  // CPU spike simulation
  cpuSpike: (durationMs = 1000) => async () => {
    const endTime = Date.now() + durationMs;
    while (Date.now() < endTime) {
      void (Math.random() * Math.random()); // Busy work - void operator suppresses unused expression warning
    }
  }
};

// Circuit breaker test suite
export class CircuitBreakerTestSuite {
  private breaker: CircuitBreaker;
  private testResults: TestResult[] = [];

  constructor(
    name: string,
    options: {
      failureThreshold?: number;
      successThreshold?: number;
      timeout?: number;
      resetTimeout?: number;
    } = {}
  ) {
    this.breaker = createCircuitBreaker(name, options);
  }

  // Run all basic tests
  async runBasicTests(): Promise<TestSuiteResults> {
    this.testResults = [];

    // Test 1: Circuit opens on failures
    const _openingTest = await this.runTest(
      'Circuit Opening',
      () => testScenarios.testCircuitOpening(this.breaker, 5)
    );

    // Reset breaker
    this.breaker.reset();

    // Test 2: Circuit recovers
    const _recoveryTest = await this.runTest(
      'Circuit Recovery',
      () => testScenarios.testCircuitRecovery(this.breaker, 3, 1000)
    );

    // Reset breaker
    this.breaker.reset();

    // Test 3: Timeout handling
    const _timeoutTest = await this.runTest(
      'Timeout Handling',
      () => testScenarios.testTimeoutHandling(this.breaker, 1000)
    );

    // Reset breaker
    this.breaker.reset();

    // Test 4: Mixed pattern handling
    const _mixedPatternTest = await this.runTest(
      'Mixed Pattern',
      async () => {
        const result = await testScenarios.testMixedPattern(this.breaker);
        return result.finalState !== CircuitState.OPEN; // Should handle mixed patterns gracefully
      }
    );

    return {
      totalTests: this.testResults.length,
      passedTests: this.testResults.filter(r => r.passed).length,
      failedTests: this.testResults.filter(r => !r.passed).length,
      results: this.testResults,
      overallSuccess: this.testResults.every(r => r.passed)
    };
  }

  private async runTest(name: string, testFn: () => Promise<boolean>): Promise<TestResult> {
    const startTime = Date.now();
    
    try {
      const passed = await testFn();
      const duration = Date.now() - startTime;
      
      const result: TestResult = {
        name,
        passed,
        duration,
        error: null
      };
      
      this.testResults.push(result);
      
      logger.info(`Test ${name}: ${passed ? 'PASSED' : 'FAILED'} (${duration}ms)`);
      return result;
      
    } catch (_error) {
      const duration = Date.now() - startTime;
      
      const result: TestResult = {
        name,
        passed: false,
        duration,
        error: error.message
      };
      
      this.testResults.push(result);
      
      logger.error(`Test ${name}: FAILED with error (${duration}ms)`, error);
      return result;
    }
  }

  getBreaker(): CircuitBreaker {
    return this.breaker;
  }
}

export interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error: string | null;
}

export interface TestSuiteResults {
  totalTests: number;
  passedTests: number;
  failedTests: number;
  results: TestResult[];
  overallSuccess: boolean;
}

// Utility function to create test circuit breakers with common configurations
export const testCircuitBreakerConfigs = {
  // Fast failing breaker for unit tests
  fastFail: {
    failureThreshold: 2,
    successThreshold: 2,
    timeout: 100,
    resetTimeout: 200
  },

  // Realistic breaker for integration tests
  realistic: {
    failureThreshold: 5,
    successThreshold: 3,
    timeout: 5000,
    resetTimeout: 30000
  },

  // Tolerant breaker for stress tests
  tolerant: {
    failureThreshold: 10,
    successThreshold: 5,
    timeout: 10000,
    resetTimeout: 60000
  }
};