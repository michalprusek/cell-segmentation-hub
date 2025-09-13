/**
 * API Mock Manager for E2E Tests
 * Provides comprehensive mocking capabilities for external services and API endpoints
 */

import { Page, Route, Request } from '@playwright/test';

export interface MockResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: any;
  delay?: number;
}

export interface MockRule {
  method?: string;
  url: string | RegExp;
  response:
    | MockResponse
    | ((req: Request) => MockResponse | Promise<MockResponse>);
  times?: number;
  priority?: number;
}

export interface NetworkCondition {
  offline?: boolean;
  latency?: number;
  downloadThroughput?: number;
  uploadThroughput?: number;
  packetLoss?: number;
}

export class APIMockManager {
  private page: Page;
  private mockRules: Map<string, MockRule> = new Map();
  private callCounts: Map<string, number> = new Map();
  private networkConditions: NetworkCondition = {};
  private isActive = false;
  private requestLog: Array<{
    url: string;
    method: string;
    timestamp: number;
    response?: any;
  }> = [];

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Start API mocking
   */
  async start(): Promise<void> {
    if (this.isActive) return;

    this.isActive = true;
    await this.page.route('**/*', this.handleRoute.bind(this));
    // API Mock Manager started
  }

  /**
   * Stop API mocking
   */
  async stop(): Promise<void> {
    if (!this.isActive) return;

    await this.page.unroute('**/*');
    this.isActive = false;
    // API Mock Manager stopped
  }

  /**
   * Add mock rule
   */
  addMock(id: string, rule: MockRule): void {
    this.mockRules.set(id, { ...rule, priority: rule.priority || 0 });
    this.callCounts.set(id, 0);
  }

  /**
   * Remove mock rule
   */
  removeMock(id: string): void {
    this.mockRules.delete(id);
    this.callCounts.delete(id);
  }

  /**
   * Clear all mocks
   */
  clearMocks(): void {
    this.mockRules.clear();
    this.callCounts.clear();
    this.requestLog = [];
  }

  /**
   * Set network conditions
   */
  setNetworkConditions(conditions: NetworkCondition): void {
    this.networkConditions = { ...conditions };
  }

  /**
   * Get call count for a mock
   */
  getCallCount(id: string): number {
    return this.callCounts.get(id) || 0;
  }

  /**
   * Get request log
   */
  getRequestLog(): Array<{
    url: string;
    method: string;
    timestamp: number;
    response?: any;
  }> {
    return [...this.requestLog];
  }

  /**
   * Handle route with mocking logic
   */
  private async handleRoute(route: Route): Promise<void> {
    const request = route.request();
    const url = request.url();
    const method = request.method();

    // Log request
    this.requestLog.push({
      url,
      method,
      timestamp: Date.now(),
    });

    // Apply network conditions
    if (this.networkConditions.offline) {
      await route.abort('internetdisconnected');
      return;
    }

    if (this.networkConditions.latency) {
      await new Promise(resolve =>
        setTimeout(resolve, this.networkConditions.latency)
      );
    }

    // Find matching mock rule
    const matchedRule = this.findMatchingRule(url, method);

    if (matchedRule) {
      const { rule, id } = matchedRule;

      // Check times limit
      const currentCount = this.callCounts.get(id) || 0;
      if (rule.times && currentCount >= rule.times) {
        await route.continue();
        return;
      }

      // Increment call count
      this.callCounts.set(id, currentCount + 1);

      // Get response
      let mockResponse: MockResponse;
      if (typeof rule.response === 'function') {
        mockResponse = await rule.response(request);
      } else {
        mockResponse = rule.response;
      }

      // Apply delay
      if (mockResponse.delay) {
        await new Promise(resolve => setTimeout(resolve, mockResponse.delay));
      }

      // Simulate packet loss
      if (
        this.networkConditions.packetLoss &&
        Math.random() < this.networkConditions.packetLoss
      ) {
        await route.abort('failed');
        return;
      }

      // Fulfill with mock response
      await route.fulfill({
        status: mockResponse.status || 200,
        headers: {
          'content-type': 'application/json',
          ...mockResponse.headers,
        },
        body:
          typeof mockResponse.body === 'string'
            ? mockResponse.body
            : JSON.stringify(mockResponse.body),
      });

      // Log response
      this.requestLog[this.requestLog.length - 1].response = mockResponse.body;

      return;
    }

    // Continue with normal request
    await route.continue();
  }

  /**
   * Find matching mock rule
   */
  private findMatchingRule(
    url: string,
    method: string
  ): { rule: MockRule; id: string } | null {
    let bestMatch: { rule: MockRule; id: string; priority: number } | null =
      null;

    for (const [id, rule] of this.mockRules) {
      // Check method match
      if (rule.method && rule.method.toLowerCase() !== method.toLowerCase()) {
        continue;
      }

      // Check URL match
      let urlMatches = false;
      if (typeof rule.url === 'string') {
        urlMatches = url.includes(rule.url);
      } else {
        urlMatches = rule.url.test(url);
      }

      if (urlMatches) {
        const priority = rule.priority || 0;
        if (!bestMatch || priority > bestMatch.priority) {
          bestMatch = { rule, id, priority };
        }
      }
    }

    return bestMatch ? { rule: bestMatch.rule, id: bestMatch.id } : null;
  }

  // Pre-defined mock scenarios
  /**
   * Mock authentication endpoints
   */
  mockAuthentication(): void {
    // Successful login
    this.addMock('auth-login-success', {
      method: 'POST',
      url: '/api/auth/login',
      response: {
        status: 200,
        body: {
          token: 'mock-jwt-token',
          refreshToken: 'mock-refresh-token',
          user: {
            id: 'mock-user-id',
            email: 'test@example.com',
            name: 'Test User',
          },
        },
      },
    });

    // Successful registration
    this.addMock('auth-register-success', {
      method: 'POST',
      url: '/api/auth/register',
      response: {
        status: 201,
        body: {
          token: 'mock-jwt-token',
          refreshToken: 'mock-refresh-token',
          user: {
            id: 'mock-user-id',
            email: 'test@example.com',
            name: 'Test User',
          },
        },
      },
    });

    // User profile
    this.addMock('auth-me', {
      method: 'GET',
      url: '/api/auth/me',
      response: {
        status: 200,
        body: {
          id: 'mock-user-id',
          email: 'test@example.com',
          name: 'Test User',
          createdAt: new Date().toISOString(),
        },
      },
    });

    // Token refresh
    this.addMock('auth-refresh', {
      method: 'POST',
      url: '/api/auth/refresh',
      response: {
        status: 200,
        body: {
          token: 'new-mock-jwt-token',
          refreshToken: 'new-mock-refresh-token',
        },
      },
    });
  }

  /**
   * Mock project management endpoints
   */
  mockProjects(): void {
    // Get projects
    this.addMock('projects-list', {
      method: 'GET',
      url: '/api/projects',
      response: {
        status: 200,
        body: {
          projects: [
            {
              id: 'mock-project-1',
              name: 'Mock Project 1',
              description: 'First mock project',
              imageCount: 5,
              processedCount: 3,
              createdAt: new Date().toISOString(),
            },
            {
              id: 'mock-project-2',
              name: 'Mock Project 2',
              description: 'Second mock project',
              imageCount: 8,
              processedCount: 8,
              createdAt: new Date().toISOString(),
            },
          ],
          total: 2,
          page: 1,
          limit: 10,
        },
      },
    });

    // Create project
    this.addMock('projects-create', {
      method: 'POST',
      url: '/api/projects',
      response: _req => ({
        status: 201,
        body: {
          id: `mock-project-${Date.now()}`,
          name: 'Mock Created Project',
          description: 'Mock project created via API',
          imageCount: 0,
          processedCount: 0,
          createdAt: new Date().toISOString(),
        },
      }),
    });

    // Get single project
    this.addMock('projects-get', {
      method: 'GET',
      url: /\/api\/projects\/[\w-]+$/,
      response: {
        status: 200,
        body: {
          id: 'mock-project-1',
          name: 'Mock Project 1',
          description: 'Mock project details',
          imageCount: 5,
          processedCount: 3,
          images: [
            {
              id: 'mock-image-1',
              filename: 'test-image-1.jpg',
              status: 'processed',
              segmentationResults: {
                polygonCount: 15,
                totalArea: 45678.9,
              },
            },
            {
              id: 'mock-image-2',
              filename: 'test-image-2.jpg',
              status: 'processing',
            },
          ],
          createdAt: new Date().toISOString(),
        },
      },
    });
  }

  /**
   * Mock image upload and processing
   */
  mockImageProcessing(): void {
    // Image upload
    this.addMock('image-upload', {
      method: 'POST',
      url: /\/api\/projects\/[\w-]+\/images$/,
      response: {
        status: 201,
        delay: 1000, // Simulate upload delay
        body: {
          images: [
            {
              id: `mock-image-${Date.now()}`,
              filename: 'uploaded-image.jpg',
              status: 'uploaded',
              size: 1024 * 1024,
              createdAt: new Date().toISOString(),
            },
          ],
        },
      },
    });

    // Start segmentation
    this.addMock('segmentation-start', {
      method: 'POST',
      url: /\/api\/segmentation\/process$/,
      response: {
        status: 202,
        body: {
          queueId: `queue-${Date.now()}`,
          status: 'queued',
          images: ['mock-image-1', 'mock-image-2'],
          estimatedTime: 30,
        },
      },
    });

    // Segmentation status
    this.addMock('segmentation-status', {
      method: 'GET',
      url: /\/api\/segmentation\/status\/[\w-]+$/,
      response: {
        status: 200,
        body: {
          queueId: 'mock-queue-id',
          status: 'completed',
          progress: 100,
          processedImages: 2,
          totalImages: 2,
          results: [
            {
              imageId: 'mock-image-1',
              polygons: [
                {
                  id: 'polygon-1',
                  vertices: [
                    { x: 100, y: 100 },
                    { x: 200, y: 100 },
                    { x: 200, y: 200 },
                    { x: 100, y: 200 },
                  ],
                  area: 10000,
                  category: 'cell',
                },
              ],
            },
          ],
        },
      },
    });
  }

  /**
   * Mock ML model endpoints
   */
  mockMLModels(): void {
    // Get available models
    this.addMock('models-list', {
      method: 'GET',
      url: '/api/models',
      response: {
        status: 200,
        body: {
          models: [
            {
              id: 'hrnet-v2',
              name: 'HRNet V2',
              description: 'High-resolution network for accurate segmentation',
              accuracy: 0.92,
              inferenceTime: 3.1,
              type: 'segmentation',
            },
            {
              id: 'resunet-small',
              name: 'ResUNet Small',
              description: 'Lightweight model for fast processing',
              accuracy: 0.87,
              inferenceTime: 0.8,
              type: 'segmentation',
            },
            {
              id: 'resunet-advanced',
              name: 'ResUNet Advanced',
              description: 'Advanced model with attention mechanisms',
              accuracy: 0.95,
              inferenceTime: 18.2,
              type: 'segmentation',
            },
          ],
        },
      },
    });

    // Model inference
    this.addMock('model-inference', {
      method: 'POST',
      url: /\/api\/models\/[\w-]+\/inference$/,
      response: {
        status: 200,
        delay: 2000, // Simulate processing time
        body: {
          results: [
            {
              imageId: 'mock-image-1',
              polygons: [
                {
                  vertices: [
                    { x: 150, y: 150 },
                    { x: 250, y: 150 },
                    { x: 250, y: 250 },
                    { x: 150, y: 250 },
                  ],
                  confidence: 0.89,
                  category: 'cell',
                },
              ],
              processingTime: 1.2,
            },
          ],
        },
      },
    });
  }

  /**
   * Mock export functionality
   */
  mockExport(): void {
    // COCO export
    this.addMock('export-coco', {
      method: 'POST',
      url: /\/api\/projects\/[\w-]+\/export\/coco$/,
      response: {
        status: 200,
        delay: 3000, // Simulate export processing
        body: {
          downloadUrl: '/api/downloads/mock-export-coco.zip',
          filename: 'project-export-coco.zip',
          size: 2048576,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
      },
    });

    // Excel export
    this.addMock('export-excel', {
      method: 'POST',
      url: /\/api\/projects\/[\w-]+\/export\/excel$/,
      response: {
        status: 200,
        delay: 2000,
        body: {
          downloadUrl: '/api/downloads/mock-export-excel.xlsx',
          filename: 'project-metrics.xlsx',
          size: 1048576,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
      },
    });

    // Download file
    this.addMock('download-file', {
      method: 'GET',
      url: /\/api\/downloads\/[\w-]+\.(zip|xlsx|csv)$/,
      response: {
        status: 200,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': 'attachment; filename="export.zip"',
        },
        body: 'mock-file-content',
      },
    });
  }

  /**
   * Mock error scenarios
   */
  mockErrorScenarios(): void {
    // Server errors
    this.addMock('server-error', {
      method: 'POST',
      url: '/api/trigger-error',
      response: {
        status: 500,
        body: {
          message: 'Internal server error',
          error: 'INTERNAL_ERROR',
        },
      },
    });

    // Rate limiting
    this.addMock('rate-limit', {
      method: 'POST',
      url: '/api/rate-limited',
      response: {
        status: 429,
        headers: {
          'Retry-After': '60',
        },
        body: {
          message: 'Rate limit exceeded',
          retryAfter: 60,
        },
      },
    });

    // Validation errors
    this.addMock('validation-error', {
      method: 'POST',
      url: '/api/validation-test',
      response: {
        status: 400,
        body: {
          message: 'Validation failed',
          errors: [
            {
              field: 'name',
              message: 'Name is required',
            },
            {
              field: 'email',
              message: 'Invalid email format',
            },
          ],
        },
      },
    });

    // Unauthorized access
    this.addMock('unauthorized', {
      method: 'GET',
      url: '/api/protected-resource',
      response: {
        status: 401,
        body: {
          message: 'Unauthorized access',
          error: 'INVALID_TOKEN',
        },
      },
    });

    // Not found
    this.addMock('not-found', {
      method: 'GET',
      url: /\/api\/projects\/nonexistent-[\w-]+$/,
      response: {
        status: 404,
        body: {
          message: 'Project not found',
          error: 'NOT_FOUND',
        },
      },
    });
  }

  /**
   * Mock WebSocket connections
   */
  mockWebSocket(): void {
    // Note: WebSocket mocking with Playwright requires different approach
    // This is a placeholder for WebSocket mock setup
    // WebSocket mocking setup - requires custom implementation
  }

  /**
   * Quick setup methods for common scenarios
   */
  setupSuccessScenario(): void {
    this.mockAuthentication();
    this.mockProjects();
    this.mockImageProcessing();
    this.mockMLModels();
    this.mockExport();
  }

  setupErrorScenario(): void {
    this.mockAuthentication();
    this.mockErrorScenarios();
    this.setNetworkConditions({ latency: 2000 });
  }

  setupOfflineScenario(): void {
    this.setNetworkConditions({ offline: true });
  }

  setupSlowNetworkScenario(): void {
    this.setNetworkConditions({
      latency: 5000,
      downloadThroughput: 1024 * 1024, // 1MB/s
      uploadThroughput: 512 * 1024, // 512KB/s
      packetLoss: 0.05, // 5% packet loss
    });
  }

  /**
   * Generate test report
   */
  generateReport(): {
    mocksUsed: Array<{ id: string; callCount: number }>;
    requestLog: typeof this.requestLog;
    networkConditions: NetworkCondition;
  } {
    const mocksUsed = Array.from(this.callCounts.entries()).map(
      ([id, callCount]) => ({
        id,
        callCount,
      })
    );

    return {
      mocksUsed,
      requestLog: this.getRequestLog(),
      networkConditions: this.networkConditions,
    };
  }
}

// Export utility function for quick setup
export function createAPIMockManager(page: Page): APIMockManager {
  return new APIMockManager(page);
}
