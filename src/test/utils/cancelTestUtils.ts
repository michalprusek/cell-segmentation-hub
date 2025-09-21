/**
 * Frontend test utilities for cancel functionality testing
 * Provides React component mocks, API mocks, and testing helpers
 */

import { vi } from 'vitest';

// Mock user event for testing interactions
export const createMockUserEvent = () => ({
  click: vi.fn(),
  type: vi.fn(),
  keyboard: vi.fn(),
  clear: vi.fn(),
  selectOptions: vi.fn(),
  upload: vi.fn(),
  setup: () => createMockUserEvent(),
});

// Mock API client for cancel operations
export const createMockApiClient = () => {
  const mockResponses = new Map();
  const callHistory: Array<{ method: string; url: string; data?: any }> = [];

  const apiClient = {
    get: vi.fn().mockImplementation((url: string) => {
      callHistory.push({ method: 'GET', url });
      const response = mockResponses.get(`GET:${url}`);
      return response
        ? Promise.resolve(response)
        : Promise.resolve({ data: [] });
    }),

    post: vi.fn().mockImplementation((url: string, data?: any) => {
      callHistory.push({ method: 'POST', url, data });
      const response = mockResponses.get(`POST:${url}`);
      return response
        ? Promise.resolve(response)
        : Promise.resolve({ data: { success: true } });
    }),

    delete: vi.fn().mockImplementation((url: string) => {
      callHistory.push({ method: 'DELETE', url });
      const response = mockResponses.get(`DELETE:${url}`);
      return response
        ? Promise.resolve(response)
        : Promise.resolve({ data: { success: true } });
    }),

    put: vi.fn().mockImplementation((url: string, data?: any) => {
      callHistory.push({ method: 'PUT', url, data });
      const response = mockResponses.get(`PUT:${url}`);
      return response
        ? Promise.resolve(response)
        : Promise.resolve({ data: { success: true } });
    }),

    // Test utilities
    setMockResponse: (method: string, url: string, response: any) => {
      mockResponses.set(`${method}:${url}`, response);
    },

    getCallHistory: () => [...callHistory],

    clearCallHistory: () => {
      callHistory.length = 0;
    },

    clearMockResponses: () => {
      mockResponses.clear();
    },

    // Convenience methods for cancel testing
    mockQueueItems: (projectId: string, items: any[]) => {
      mockResponses.set(`GET:/queue/projects/${projectId}/items`, {
        data: items,
      });
    },

    mockQueueCancel: (queueId: string, success = true) => {
      const response = success
        ? { data: { success: true } }
        : Promise.reject(new Error('Cancel failed'));
      mockResponses.set(`DELETE:/queue/items/${queueId}`, response);
    },

    mockProjectCancel: (projectId: string, cancelledCount: number) => {
      mockResponses.set(`POST:/queue/projects/${projectId}/cancel`, {
        data: { cancelledItems: cancelledCount },
      });
    },

    mockBatchCancel: (batchId: string, cancelledCount: number) => {
      mockResponses.set(`POST:/queue/batches/${batchId}/cancel`, {
        data: { cancelledItems: cancelledCount },
      });
    },
  };

  return apiClient;
};

// Mock WebSocket manager for real-time updates
export const createMockWebSocketManager = () => {
  const eventListeners = new Map<string, Array<(...args: any[]) => void>>();
  const emittedEvents: Array<{ event: string; data: any }> = [];

  return {
    on: vi
      .fn()
      .mockImplementation(
        (event: string, listener: (...args: any[]) => void) => {
          if (!eventListeners.has(event)) {
            eventListeners.set(event, []);
          }
          eventListeners.get(event)?.push(listener);
        }
      ),

    off: vi
      .fn()
      .mockImplementation(
        (event: string, listener: (...args: any[]) => void) => {
          const listeners = eventListeners.get(event);
          if (listeners) {
            const index = listeners.indexOf(listener);
            if (index > -1) {
              listeners.splice(index, 1);
            }
          }
        }
      ),

    emit: vi.fn().mockImplementation((event: string, data: any) => {
      emittedEvents.push({ event, data });
      const listeners = eventListeners.get(event);
      if (listeners) {
        listeners.forEach(listener => listener(data));
      }
    }),

    getInstance: vi.fn().mockReturnThis(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    isConnected: vi.fn().mockReturnValue(true),

    // Test utilities
    getEventListeners: (event?: string) => {
      if (event) {
        return eventListeners.get(event) || [];
      }
      return Array.from(eventListeners.entries());
    },

    getEmittedEvents: () => [...emittedEvents],

    clearEmittedEvents: () => {
      emittedEvents.length = 0;
    },

    clearEventListeners: () => {
      eventListeners.clear();
    },

    // Simulate cancel events
    simulateQueueCancelled: (data: {
      projectId: string;
      cancelledCount: number;
      timestamp: string;
    }) => {
      this.emit('queue:cancelled', data);
    },

    simulateBatchCancelled: (data: {
      batchId: string;
      cancelledCount: number;
      timestamp: string;
    }) => {
      this.emit('batch:cancelled', data);
    },
  };
};

// Mock toast notifications for testing
export const createMockToast = () => {
  const toastHistory: Array<{ type: string; message: string; options?: any }> =
    [];

  return {
    success: vi.fn().mockImplementation((message: string, options?: any) => {
      toastHistory.push({ type: 'success', message, options });
    }),

    error: vi.fn().mockImplementation((message: string, options?: any) => {
      toastHistory.push({ type: 'error', message, options });
    }),

    warning: vi.fn().mockImplementation((message: string, options?: any) => {
      toastHistory.push({ type: 'warning', message, options });
    }),

    info: vi.fn().mockImplementation((message: string, options?: any) => {
      toastHistory.push({ type: 'info', message, options });
    }),

    dismiss: vi.fn().mockImplementation((_id?: string) => {
      // Remove toast with specific ID or all toasts
    }),

    // Test utilities
    getToastHistory: () => [...toastHistory],

    clearToastHistory: () => {
      toastHistory.length = 0;
    },

    getLastToast: () => toastHistory[toastHistory.length - 1],

    getToastsByType: (type: string) =>
      toastHistory.filter(t => t.type === type),
  };
};

// Mock React contexts for cancel testing
export const createMockContexts = () => ({
  useAuth: () => ({
    user: { id: 'test-user-123', email: 'test@example.com', name: 'Test User' },
    login: vi.fn(),
    logout: vi.fn(),
    isAuthenticated: true,
    loading: false,
  }),

  useLanguage: () => ({
    t: vi.fn().mockImplementation((key: string, params?: any) => {
      const translations: Record<string, string> = {
        'errors.noProjectOrUser': 'No project or user',
        'queue.batchCancelled': `Cancelled ${params?.count || 0} queue items`,
        'queue.nothingToCancel': 'No items to cancel',
        'queue.itemsAlreadyProcessing': 'Items are already processing',
        'queue.cancelFailed': 'Failed to cancel batch operation',
        'queue.cancel': 'Cancel',
        'queue.cancelling': 'Cancelling...',
        'queue.cancelled': `Cancelled ${params?.count || 0} items`,
        'projects.allImagesAlreadySegmented': 'All images already segmented',
        'projects.errorAddingToQueue': 'Error adding to queue',
        'common.cancel': 'Cancel',
        'common.delete': 'Delete',
      };
      return translations[key] || key;
    }),
    language: 'en',
    setLanguage: vi.fn(),
  }),

  useModel: () => ({
    selectedModel: 'unet',
    confidenceThreshold: 0.5,
    detectHoles: false,
    setSelectedModel: vi.fn(),
    setConfidenceThreshold: vi.fn(),
    setDetectHoles: vi.fn(),
  }),
});

// Mock hooks for cancel functionality testing
export const createMockHooks = () => ({
  useProjectData: () => ({
    projectTitle: 'Test Project',
    images: [
      {
        id: 'img-1',
        name: 'test1.jpg',
        segmentationStatus: 'queued',
        url: '/images/test1.jpg',
        thumbnail_url: '/thumbs/test1.jpg',
      },
      {
        id: 'img-2',
        name: 'test2.jpg',
        segmentationStatus: 'processing',
        url: '/images/test2.jpg',
        thumbnail_url: '/thumbs/test2.jpg',
      },
    ],
    loading: false,
    updateImages: vi.fn(),
    refreshImageSegmentation: vi.fn(),
  }),

  useSegmentationQueue: () => ({
    isConnected: true,
    queueStats: { queued: 5, processing: 2, completed: 10, failed: 1 },
    lastUpdate: null,
    requestQueueStats: vi.fn(),
  }),

  useImageFilter: () => ({
    filteredImages: [],
    searchTerm: '',
    sortField: 'name',
    sortDirection: 'asc',
    handleSearch: vi.fn(),
    handleSort: vi.fn(),
  }),

  usePagination: () => ({
    currentPage: 1,
    totalPages: 1,
    itemsPerPage: 30,
    startIndex: 0,
    endIndex: 30,
    canGoNext: false,
    canGoPrevious: false,
    setCurrentPage: vi.fn(),
    goToNextPage: vi.fn(),
    goToPreviousPage: vi.fn(),
    pageNumbers: [1],
    paginatedIndices: { start: 0, end: 30 },
  }),

  useProjectImageActions: () => ({
    handleDeleteImage: vi.fn(),
    handleOpenSegmentationEditor: vi.fn(),
  }),
});

// Test data generators for frontend
export class FrontendTestDataGenerator {
  /**
   * Generate mock images for testing
   */
  static generateMockImages(
    count: number,
    options: {
      projectId?: string;
      statuses?: Array<
        'pending' | 'queued' | 'processing' | 'completed' | 'failed'
      >;
    } = {}
  ) {
    const { projectId = 'test-project', statuses = ['pending'] } = options;

    return Array.from({ length: count }, (_, i) => ({
      id: `img-${i + 1}`,
      name: `test-image-${i + 1}.jpg`,
      projectId,
      url: `/uploads/test-image-${i + 1}.jpg`,
      thumbnail_url: `/thumbs/test-image-${i + 1}.jpg`,
      segmentationStatus: statuses[i % statuses.length],
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
  }

  /**
   * Generate mock queue items for frontend testing
   */
  static generateMockQueueItems(
    count: number,
    options: {
      userId?: string;
      projectId?: string;
      batchId?: string;
    } = {}
  ) {
    const {
      userId = 'test-user-123',
      projectId = 'test-project',
      batchId = 'test-batch',
    } = options;

    return Array.from({ length: count }, (_, i) => ({
      id: `queue-${i + 1}`,
      imageId: `img-${i + 1}`,
      projectId,
      userId,
      status: i % 3 === 0 ? 'processing' : 'queued',
      batchId,
      createdAt: new Date().toISOString(),
      model: 'unet',
      threshold: 0.5,
    }));
  }

  /**
   * Generate mock WebSocket events
   */
  static generateMockWebSocketEvents() {
    return {
      queueCancelled: {
        projectId: 'test-project',
        cancelledCount: 5,
        timestamp: new Date().toISOString(),
      },
      batchCancelled: {
        batchId: 'test-batch',
        cancelledCount: 3,
        timestamp: new Date().toISOString(),
      },
      segmentationUpdate: {
        imageId: 'img-1',
        projectId: 'test-project',
        status: 'cancelled',
        timestamp: new Date().toISOString(),
      },
    };
  }
}

// Test utilities for component testing
export class ComponentTestUtils {
  /**
   * Create wrapper with all necessary providers
   */
  static createTestWrapper(
    options: {
      initialRoute?: string;
      mockContexts?: any;
    } = {}
  ) {
    const { initialRoute: _initialRoute = '/', mockContexts: _mockContexts = createMockContexts() } = options;

    return ({ children }: { children: React.ReactNode }) => {
      // This would typically wrap with Router, context providers, etc.
      return children as React.ReactElement;
    };
  }

  /**
   * Wait for async operations in tests
   */
  static async waitForAsync(ms = 0) {
    await new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Simulate user interactions for cancel testing
   */
  static async simulateCancelInteraction(
    screen: any,
    userEvent: any,
    options: {
      buttonText?: string;
      confirmCancel?: boolean;
      expectLoading?: boolean;
    } = {}
  ) {
    const {
      buttonText = /cancel/i,
      confirmCancel = true,
      expectLoading = true,
    } = options;

    // Find cancel button
    const cancelButton = screen.getByRole('button', { name: buttonText });
    expect(cancelButton).toBeInTheDocument();

    // Click cancel button
    await userEvent.click(cancelButton);

    if (expectLoading) {
      // Check for loading state
      expect(cancelButton).toBeDisabled();
      expect(screen.getByText(/cancelling/i)).toBeInTheDocument();
    }

    if (confirmCancel) {
      // Wait for operation to complete
      await this.waitForAsync(100);
    }

    return { cancelButton };
  }

  /**
   * Assert toast messages for cancel operations
   */
  static assertCancelToasts(
    mockToast: any,
    expectedType: 'success' | 'error' | 'warning' | 'info',
    expectedCount?: number
  ) {
    const toasts = mockToast.getToastsByType(expectedType);

    if (expectedCount !== undefined) {
      expect(toasts).toHaveLength(expectedCount);
    } else {
      expect(toasts.length).toBeGreaterThan(0);
    }

    return toasts;
  }

  /**
   * Assert API calls for cancel operations
   */
  static assertCancelApiCalls(
    mockApiClient: any,
    expectedCalls: Array<{
      method: string;
      url: string;
      shouldMatch?: boolean;
    }>
  ) {
    const callHistory = mockApiClient.getCallHistory();

    expectedCalls.forEach(expectedCall => {
      const matchingCall = callHistory.find(
        call =>
          call.method === expectedCall.method &&
          (expectedCall.shouldMatch !== false
            ? call.url.includes(expectedCall.url)
            : call.url === expectedCall.url)
      );

      if (!matchingCall) {
        throw new Error(
          `Expected API call not found: ${expectedCall.method} ${expectedCall.url}`
        );
      }
    });
  }

  /**
   * Assert WebSocket events for cancel operations
   */
  static assertCancelWebSocketEvents(
    mockWebSocket: any,
    expectedEvents: Array<{
      event: string;
      data?: Record<string, any>;
    }>
  ) {
    const emittedEvents = mockWebSocket.getEmittedEvents();

    expectedEvents.forEach(expectedEvent => {
      const matchingEvent = emittedEvents.find(
        event => event.event === expectedEvent.event
      );

      if (!matchingEvent) {
        throw new Error(
          `Expected WebSocket event not found: ${expectedEvent.event}`
        );
      }

      if (expectedEvent.data) {
        Object.keys(expectedEvent.data).forEach(key => {
          expect(matchingEvent.data[key]).toBe(expectedEvent.data![key]);
        });
      }
    });
  }
}

// Performance testing utilities for frontend
export class FrontendPerformanceUtils {
  /**
   * Measure component render performance
   */
  static async measureRenderPerformance(renderFn: () => any): Promise<{
    renderTime: number;
    memoryUsed: number;
  }> {
    const startTime = performance.now();
    const startMemory = (performance as any).memory?.usedJSHeapSize || 0;

    await renderFn();

    const endTime = performance.now();
    const endMemory = (performance as any).memory?.usedJSHeapSize || 0;

    return {
      renderTime: endTime - startTime,
      memoryUsed: endMemory - startMemory,
    };
  }

  /**
   * Test cancel operation performance
   */
  static async measureCancelPerformance(cancelFn: () => Promise<any>): Promise<{
    duration: number;
    success: boolean;
  }> {
    const startTime = performance.now();

    try {
      await cancelFn();
      const endTime = performance.now();

      return {
        duration: endTime - startTime,
        success: true,
      };
    } catch (_error) {
      const endTime = performance.now();

      return {
        duration: endTime - startTime,
        success: false,
      };
    }
  }

  /**
   * Assert performance benchmarks
   */
  static assertPerformanceBenchmarks(
    metrics: { renderTime?: number; duration?: number; memoryUsed?: number },
    limits: { maxRenderTime?: number; maxDuration?: number; maxMemory?: number }
  ) {
    if (
      limits.maxRenderTime &&
      metrics.renderTime &&
      metrics.renderTime > limits.maxRenderTime
    ) {
      throw new Error(
        `Render time ${metrics.renderTime}ms exceeds limit ${limits.maxRenderTime}ms`
      );
    }

    if (
      limits.maxDuration &&
      metrics.duration &&
      metrics.duration > limits.maxDuration
    ) {
      throw new Error(
        `Operation duration ${metrics.duration}ms exceeds limit ${limits.maxDuration}ms`
      );
    }

    if (
      limits.maxMemory &&
      metrics.memoryUsed &&
      metrics.memoryUsed > limits.maxMemory
    ) {
      throw new Error(
        `Memory usage ${metrics.memoryUsed} bytes exceeds limit ${limits.maxMemory} bytes`
      );
    }
  }
}

// Export utilities
export {
  FrontendTestDataGenerator as TestDataGenerator,
  ComponentTestUtils as ComponentUtils,
  FrontendPerformanceUtils as PerformanceUtils,
};
