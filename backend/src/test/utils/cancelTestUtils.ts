/**
 * Test utilities for cancel functionality testing
 * Provides mock data generators, test helpers, and common test patterns
 */

import { vi } from 'vitest';

// Types for test data
export interface TestUser {
  id: string;
  email: string;
  name: string;
}

export interface TestProject {
  id: string;
  name: string;
  userId: string;
  shares?: TestProjectShare[];
}

export interface TestProjectShare {
  id: string;
  projectId: string;
  sharedWithId?: string;
  email?: string;
  status: 'pending' | 'accepted' | 'rejected';
}

export interface TestImage {
  id: string;
  name: string;
  projectId: string;
  userId: string;
  url: string;
  segmentationStatus: 'pending' | 'queued' | 'processing' | 'completed' | 'failed' | 'no_segmentation' | 'cancelled';
}

export interface TestQueueItem {
  id: string;
  imageId: string;
  projectId: string;
  userId: string;
  model: string;
  threshold: number;
  priority: number;
  detectHoles: boolean;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  batchId?: string;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  retryCount: number;
}

export interface TestBatch {
  id: string;
  projectId: string;
  userId: string;
  itemCount: number;
  createdAt: Date;
}

// Mock data generators
export class CancelTestDataGenerator {
  /**
   * Generate test users
   */
  static generateUsers(count: number): TestUser[] {
    return Array.from({ length: count }, (_, i) => ({
      id: `test-user-${i + 1}`,
      email: `user${i + 1}@example.com`,
      name: `Test User ${i + 1}`
    }));
  }

  /**
   * Generate test projects
   */
  static generateProjects(count: number, userId: string): TestProject[] {
    return Array.from({ length: count }, (_, i) => ({
      id: `test-project-${i + 1}`,
      name: `Test Project ${i + 1}`,
      userId
    }));
  }

  /**
   * Generate shared project
   */
  static generateSharedProject(
    projectId: string,
    ownerId: string,
    sharedWithUsers: Array<{ id: string; email: string; status: 'pending' | 'accepted' | 'rejected' }>
  ): TestProject {
    return {
      id: projectId,
      name: 'Shared Test Project',
      userId: ownerId,
      shares: sharedWithUsers.map((user, i) => ({
        id: `share-${i + 1}`,
        projectId,
        sharedWithId: user.id,
        email: user.email,
        status: user.status
      }))
    };
  }

  /**
   * Generate test images
   */
  static generateImages(count: number, projectId: string, userId: string): TestImage[] {
    return Array.from({ length: count }, (_, i) => ({
      id: `test-img-${i + 1}`,
      name: `test-image-${i + 1}.jpg`,
      projectId,
      userId,
      url: `/uploads/test-image-${i + 1}.jpg`,
      segmentationStatus: 'pending'
    }));
  }

  /**
   * Generate queue items
   */
  static generateQueueItems(
    count: number,
    projectId: string,
    userId: string,
    options: {
      status?: TestQueueItem['status'];
      batchId?: string;
      model?: string;
      startFromIndex?: number;
    } = {}
  ): TestQueueItem[] {
    const {
      status = 'queued',
      batchId,
      model = 'hrnet',
      startFromIndex = 0
    } = options;

    return Array.from({ length: count }, (_, i) => {
      const index = startFromIndex + i + 1;
      const createdAt = new Date();

      return {
        id: `test-queue-${index}`,
        imageId: `test-img-${index}`,
        projectId,
        userId,
        model,
        threshold: 0.5,
        priority: 0,
        detectHoles: true,
        status,
        batchId,
        createdAt,
        updatedAt: createdAt,
        startedAt: status === 'processing' ? createdAt : undefined,
        completedAt: status === 'completed' || status === 'cancelled' ? createdAt : undefined,
        retryCount: 0
      };
    });
  }

  /**
   * Generate large queue dataset for performance testing
   */
  static generateLargeQueueDataset(
    totalItems: number,
    projectId: string,
    userId: string,
    options: {
      batchSize?: number;
      statusDistribution?: {
        queued?: number;
        processing?: number;
        completed?: number;
        failed?: number;
      };
    } = {}
  ): TestQueueItem[] {
    const {
      batchSize = 500,
      statusDistribution = { queued: 0.7, processing: 0.2, completed: 0.1, failed: 0.0 }
    } = options;

    const items: TestQueueItem[] = [];
    let currentBatch = 1;

    for (let i = 0; i < totalItems; i++) {
      // Determine status based on distribution
      const random = Math.random();
      let status: TestQueueItem['status'] = 'queued';

      if (random < statusDistribution.failed!) {
        status = 'failed';
      } else if (random < statusDistribution.failed! + statusDistribution.completed!) {
        status = 'completed';
      } else if (random < statusDistribution.failed! + statusDistribution.completed! + statusDistribution.processing!) {
        status = 'processing';
      } else {
        status = 'queued';
      }

      const batchId = `batch-${currentBatch}`;
      if ((i + 1) % batchSize === 0) {
        currentBatch++;
      }

      items.push({
        id: `large-queue-${i + 1}`,
        imageId: `large-img-${i + 1}`,
        projectId,
        userId,
        model: 'hrnet',
        threshold: 0.5,
        priority: 0,
        detectHoles: true,
        status,
        batchId,
        createdAt: new Date(Date.now() - (totalItems - i) * 1000), // Spread over time
        updatedAt: new Date(Date.now() - (totalItems - i) * 1000),
        startedAt: status === 'processing' ? new Date() : undefined,
        completedAt: status === 'completed' ? new Date() : undefined,
        retryCount: status === 'failed' ? Math.floor(Math.random() * 3) : 0
      });
    }

    return items;
  }

  /**
   * Generate mixed user queue items (for multi-user scenarios)
   */
  static generateMixedUserQueueItems(
    users: TestUser[],
    projectId: string,
    itemsPerUser: number
  ): TestQueueItem[] {
    const allItems: TestQueueItem[] = [];

    users.forEach((user, userIndex) => {
      const userItems = this.generateQueueItems(itemsPerUser, projectId, user.id, {
        batchId: `batch-${user.id}`,
        startFromIndex: userIndex * itemsPerUser
      });
      allItems.push(...userItems);
    });

    return allItems;
  }
}

// Mock factory for Prisma
export class PrismaMockFactory {
  /**
   * Create a mock Prisma client for cancel testing
   */
  static createCancelMock(
    testData: {
      users?: TestUser[];
      projects?: TestProject[];
      queueItems?: TestQueueItem[];
    } = {}
  ) {
    const { users = [], projects = [], queueItems = [] } = testData;

    const userMap = new Map(users.map(u => [u.id, u]));
    const projectMap = new Map(projects.map(p => [p.id, p]));
    const queueMap = new Map(queueItems.map(q => [q.id, q]));

    return {
      user: {
        findUnique: vi.fn().mockImplementation(({ where }) => {
          const user = userMap.get(where.id);
          return Promise.resolve(user || null);
        }),
        create: vi.fn().mockImplementation((data) => {
          const user = data.data;
          userMap.set(user.id, user);
          return Promise.resolve(user);
        }),
        deleteMany: vi.fn().mockImplementation(({ where }) => {
          let deletedCount = 0;
          if (where.id) {
            if (userMap.delete(where.id)) deletedCount = 1;
          } else {
            deletedCount = userMap.size;
            userMap.clear();
          }
          return Promise.resolve({ count: deletedCount });
        })
      },

      project: {
        findFirst: vi.fn().mockImplementation(({ where }) => {
          const project = projectMap.get(where.id);
          if (!project) return Promise.resolve(null);

          // Check authorization logic
          if (where.OR) {
            const userOwnsProject = project.userId === where.OR[0]?.userId;
            const hasSharedAccess = project.shares?.some(share =>
              where.OR[1]?.shares?.some?.some?.OR?.some((condition: any) => {
                return (
                  (condition.sharedWithId && share.sharedWithId === condition.sharedWithId && share.status === condition.status) ||
                  (condition.email && share.email === condition.email && ['pending', 'accepted'].includes(share.status))
                );
              })
            );

            if (userOwnsProject || hasSharedAccess) {
              return Promise.resolve(project);
            }
          }

          return Promise.resolve(null);
        }),
        create: vi.fn().mockImplementation((data) => {
          const project = data.data;
          projectMap.set(project.id, project);
          return Promise.resolve(project);
        }),
        deleteMany: vi.fn().mockImplementation(({ where }) => {
          let deletedCount = 0;
          if (where.id) {
            if (projectMap.delete(where.id)) deletedCount = 1;
          } else {
            deletedCount = projectMap.size;
            projectMap.clear();
          }
          return Promise.resolve({ count: deletedCount });
        })
      },

      segmentationQueue: {
        findMany: vi.fn().mockImplementation(({ where, select }) => {
          let results = Array.from(queueMap.values());

          // Apply filters
          if (where) {
            if (where.projectId) {
              results = results.filter(q => q.projectId === where.projectId);
            }
            if (where.userId) {
              results = results.filter(q => q.userId === where.userId);
            }
            if (where.batchId) {
              results = results.filter(q => q.batchId === where.batchId);
            }
            if (where.status) {
              if (where.status.in) {
                results = results.filter(q => where.status.in.includes(q.status));
              } else {
                results = results.filter(q => q.status === where.status);
              }
            }
            if (where.id?.in) {
              results = results.filter(q => where.id.in.includes(q.id));
            }
          }

          // Apply select
          if (select) {
            results = results.map(q => {
              const selected: any = {};
              Object.keys(select).forEach(key => {
                if (select[key]) {
                  selected[key] = (q as any)[key];
                }
              });
              return selected;
            });
          }

          return Promise.resolve(results);
        }),

        updateMany: vi.fn().mockImplementation(({ where, data }) => {
          let updatedCount = 0;

          if (where.id?.in) {
            where.id.in.forEach((id: string) => {
              const item = queueMap.get(id);
              if (item) {
                Object.assign(item, data);
                updatedCount++;
              }
            });
          }

          return Promise.resolve({ count: updatedCount });
        }),

        create: vi.fn().mockImplementation((createData) => {
          const item = createData.data;
          queueMap.set(item.id, item);
          return Promise.resolve(item);
        }),

        count: vi.fn().mockImplementation(({ where }) => {
          let results = Array.from(queueMap.values());

          if (where) {
            if (where.projectId) {
              results = results.filter(q => q.projectId === where.projectId);
            }
            if (where.userId) {
              results = results.filter(q => q.userId === where.userId);
            }
            if (where.status?.in) {
              results = results.filter(q => where.status.in.includes(q.status));
            }
          }

          return Promise.resolve(results.length);
        }),

        deleteMany: vi.fn().mockImplementation(({ where }) => {
          let deletedCount = 0;
          const toDelete: string[] = [];

          queueMap.forEach((item, id) => {
            let shouldDelete = true;

            if (where) {
              if (where.projectId && item.projectId !== where.projectId) shouldDelete = false;
              if (where.userId && item.userId !== where.userId) shouldDelete = false;
              if (where.OR?.some && !where.OR.some((condition: any) => {
                return (condition.projectId === item.projectId || condition.userId === item.userId);
              })) shouldDelete = false;
            }

            if (shouldDelete) {
              toDelete.push(id);
              deletedCount++;
            }
          });

          toDelete.forEach(id => queueMap.delete(id));
          return Promise.resolve({ count: deletedCount });
        })
      },

      $transaction: vi.fn().mockImplementation(async (operations) => {
        if (Array.isArray(operations)) {
          return Promise.all(operations);
        } else if (typeof operations === 'function') {
          return operations(this);
        } else {
          return operations;
        }
      })
    };
  }
}

// Test scenario builders
export class CancelTestScenarios {
  /**
   * Build standard cancellation scenario
   */
  static buildStandardScenario(): {
    users: TestUser[];
    projects: TestProject[];
    queueItems: TestQueueItem[];
    expectedCancellations: number;
  } {
    const users = CancelTestDataGenerator.generateUsers(1);
    const projects = CancelTestDataGenerator.generateProjects(1, users[0].id);
    const queueItems = CancelTestDataGenerator.generateQueueItems(5, projects[0].id, users[0].id, {
      batchId: 'test-batch-1'
    });

    return {
      users,
      projects,
      queueItems,
      expectedCancellations: queueItems.filter(q => q.status === 'queued').length
    };
  }

  /**
   * Build multi-user scenario
   */
  static buildMultiUserScenario(): {
    users: TestUser[];
    projects: TestProject[];
    queueItems: TestQueueItem[];
    expectedCancellationsByUser: Record<string, number>;
  } {
    const users = CancelTestDataGenerator.generateUsers(3);
    const projects = CancelTestDataGenerator.generateProjects(1, users[0].id);
    const queueItems = CancelTestDataGenerator.generateMixedUserQueueItems(users, projects[0].id, 3);

    const expectedCancellationsByUser: Record<string, number> = {};
    users.forEach(user => {
      expectedCancellationsByUser[user.id] = queueItems.filter(
        q => q.userId === user.id && q.status === 'queued'
      ).length;
    });

    return {
      users,
      projects,
      queueItems,
      expectedCancellationsByUser
    };
  }

  /**
   * Build shared project scenario
   */
  static buildSharedProjectScenario(): {
    users: TestUser[];
    projects: TestProject[];
    queueItems: TestQueueItem[];
    sharedAccess: Record<string, boolean>;
  } {
    const users = CancelTestDataGenerator.generateUsers(3);
    const owner = users[0];
    const acceptedUser = users[1];
    const pendingUser = users[2];

    const sharedProject = CancelTestDataGenerator.generateSharedProject(
      'shared-project-1',
      owner.id,
      [
        { id: acceptedUser.id, email: acceptedUser.email, status: 'accepted' },
        { id: pendingUser.id, email: pendingUser.email, status: 'pending' }
      ]
    );

    const queueItems = [
      ...CancelTestDataGenerator.generateQueueItems(2, sharedProject.id, owner.id, { startFromIndex: 0 }),
      ...CancelTestDataGenerator.generateQueueItems(2, sharedProject.id, acceptedUser.id, { startFromIndex: 2 }),
      ...CancelTestDataGenerator.generateQueueItems(2, sharedProject.id, pendingUser.id, { startFromIndex: 4 })
    ];

    return {
      users,
      projects: [sharedProject],
      queueItems,
      sharedAccess: {
        [owner.id]: true,
        [acceptedUser.id]: true,
        [pendingUser.id]: true // Pending users also have access in this implementation
      }
    };
  }

  /**
   * Build performance test scenario
   */
  static buildPerformanceScenario(scale: 'small' | 'medium' | 'large' = 'medium'): {
    users: TestUser[];
    projects: TestProject[];
    queueItems: TestQueueItem[];
    expectedPerformance: {
      maxDurationMs: number;
      maxMemoryMB: number;
    };
  } {
    const scaleConfig = {
      small: { users: 1, items: 100, maxDuration: 500, maxMemory: 10 },
      medium: { users: 5, items: 1000, maxDuration: 2000, maxMemory: 50 },
      large: { users: 10, items: 10000, maxDuration: 10000, maxMemory: 200 }
    };

    const config = scaleConfig[scale];
    const users = CancelTestDataGenerator.generateUsers(config.users);
    const projects = CancelTestDataGenerator.generateProjects(1, users[0].id);
    const queueItems = CancelTestDataGenerator.generateLargeQueueDataset(
      config.items,
      projects[0].id,
      users[0].id
    );

    return {
      users,
      projects,
      queueItems,
      expectedPerformance: {
        maxDurationMs: config.maxDuration,
        maxMemoryMB: config.maxMemory
      }
    };
  }

  /**
   * Build race condition scenario
   */
  static buildRaceConditionScenario(): {
    users: TestUser[];
    projects: TestProject[];
    queueItems: TestQueueItem[];
    concurrentOperations: Array<{
      type: 'project' | 'batch';
      userId: string;
      targetId: string;
    }>;
  } {
    const users = CancelTestDataGenerator.generateUsers(2);
    const projects = CancelTestDataGenerator.generateProjects(1, users[0].id);

    const batch1Items = CancelTestDataGenerator.generateQueueItems(3, projects[0].id, users[0].id, {
      batchId: 'race-batch-1',
      startFromIndex: 0
    });

    const batch2Items = CancelTestDataGenerator.generateQueueItems(3, projects[0].id, users[1].id, {
      batchId: 'race-batch-2',
      startFromIndex: 3
    });

    const queueItems = [...batch1Items, ...batch2Items];

    const concurrentOperations = [
      { type: 'project' as const, userId: users[0].id, targetId: projects[0].id },
      { type: 'batch' as const, userId: users[0].id, targetId: 'race-batch-1' },
      { type: 'batch' as const, userId: users[1].id, targetId: 'race-batch-2' }
    ];

    return {
      users,
      projects,
      queueItems,
      concurrentOperations
    };
  }
}

// WebSocket test helpers
export class WebSocketTestHelpers {
  /**
   * Create mock WebSocket service
   */
  static createMockWebSocketService() {
    const userSockets = new Map();
    const emittedEvents: Array<{ userId: string; event: string; data: any }> = [];

    return {
      userSockets,
      emittedEvents,
      emitToUser: vi.fn().mockImplementation((userId: string, event: string, data: any) => {
        emittedEvents.push({ userId, event, data });
        const socket = userSockets.get(userId);
        if (socket) {
          socket.emit(event, data);
        }
      }),
      getInstance: vi.fn().mockReturnValue(this),
      handleConnection: vi.fn(),
      addUser: (userId: string, socket: any) => {
        userSockets.set(userId, socket);
      },
      removeUser: (userId: string) => {
        userSockets.delete(userId);
      },
      getEmittedEvents: () => [...emittedEvents],
      clearEmittedEvents: () => {
        emittedEvents.length = 0;
      }
    };
  }

  /**
   * Create mock socket
   */
  static createMockSocket(userId: string) {
    const emittedEvents: Array<{ event: string; data: any }> = [];

    return {
      id: `socket-${userId}`,
      userId,
      emit: vi.fn().mockImplementation((event: string, data: any) => {
        emittedEvents.push({ event, data });
      }),
      on: vi.fn(),
      join: vi.fn(),
      leave: vi.fn(),
      disconnect: vi.fn(),
      connected: true,
      getEmittedEvents: () => [...emittedEvents],
      clearEmittedEvents: () => {
        emittedEvents.length = 0;
      }
    };
  }
}

// Test assertion helpers
export class CancelTestAssertions {
  /**
   * Assert WebSocket event was emitted correctly
   */
  static assertWebSocketEvent(
    emittedEvents: Array<{ userId: string; event: string; data: any }>,
    expectedEvent: {
      userId: string;
      event: string;
      data: Record<string, any>;
    }
  ) {
    const matchingEvent = emittedEvents.find(
      e => e.userId === expectedEvent.userId && e.event === expectedEvent.event
    );

    if (!matchingEvent) {
      throw new Error(`Expected WebSocket event not found: ${expectedEvent.event} for user ${expectedEvent.userId}`);
    }

    Object.keys(expectedEvent.data).forEach(key => {
      if (matchingEvent.data[key] !== expectedEvent.data[key]) {
        throw new Error(`WebSocket event data mismatch for key ${key}: expected ${expectedEvent.data[key]}, got ${matchingEvent.data[key]}`);
      }
    });
  }

  /**
   * Assert performance metrics
   */
  static assertPerformance(
    metrics: { duration: number; memoryUsed: number },
    limits: { maxDurationMs: number; maxMemoryMB: number }
  ) {
    if (metrics.duration > limits.maxDurationMs) {
      throw new Error(`Performance test failed: duration ${metrics.duration}ms exceeds limit ${limits.maxDurationMs}ms`);
    }

    const memoryMB = metrics.memoryUsed / (1024 * 1024);
    if (memoryMB > limits.maxMemoryMB) {
      throw new Error(`Performance test failed: memory usage ${memoryMB.toFixed(2)}MB exceeds limit ${limits.maxMemoryMB}MB`);
    }
  }

  /**
   * Assert cancellation results
   */
  static assertCancellationResults(
    actual: { cancelledItems: string[]; duration: number },
    expected: { minCancelled: number; maxCancelled: number; maxDurationMs: number }
  ) {
    if (actual.cancelledItems.length < expected.minCancelled) {
      throw new Error(`Insufficient items cancelled: ${actual.cancelledItems.length} < ${expected.minCancelled}`);
    }

    if (actual.cancelledItems.length > expected.maxCancelled) {
      throw new Error(`Too many items cancelled: ${actual.cancelledItems.length} > ${expected.maxCancelled}`);
    }

    if (actual.duration > expected.maxDurationMs) {
      throw new Error(`Cancellation took too long: ${actual.duration}ms > ${expected.maxDurationMs}ms`);
    }
  }
}

// Export all utilities
export {
  CancelTestDataGenerator as DataGenerator,
  PrismaMockFactory as MockFactory,
  CancelTestScenarios as Scenarios,
  WebSocketTestHelpers as WebSocketHelpers,
  CancelTestAssertions as Assertions
};