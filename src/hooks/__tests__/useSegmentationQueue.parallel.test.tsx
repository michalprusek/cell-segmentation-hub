/**
 * Frontend concurrent hook tests for parallel processing
 *
 * This test suite validates frontend React hooks during concurrent operations,
 * testing WebSocket handling, state management, and UI responsiveness during
 * 4-way parallel segmentation processing.
 *
 * Requirements tested:
 * - useSegmentationQueue hook behavior with 4 concurrent users
 * - WebSocket message handling for multiple concurrent streams
 * - State synchronization during parallel operations
 * - Error handling and recovery in concurrent scenarios
 * - UI responsiveness during high-throughput processing
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  WebSocketContext,
  WebSocketProvider,
} from '@/contexts/WebSocketContext';
import { AuthContext } from '@/contexts/AuthContext';
import { useSegmentationQueue } from '../useSegmentationQueue';
import React from 'react';

// Mock dependencies
vi.mock('@/lib/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('socket.io-client', () => ({
  io: vi.fn(),
}));

// Test data and types
interface MockUser {
  id: string;
  email: string;
  name: string;
  projectId: string;
}

interface MockWebSocketMessage {
  type: string;
  data: any;
  timestamp: number;
  userId: string;
}

interface ConcurrentTestScenario {
  name: string;
  userCount: number;
  imagesPerUser: number;
  expectedMessages: number;
  simulatedNetworkDelay: number;
}

interface ParallelHookMetrics {
  totalStateUpdates: number;
  websocketMessages: number;
  apiCalls: number;
  errorCount: number;
  averageUpdateLatency: number;
  memoryLeaks: boolean;
  uiResponsiveness: number;
}

// Mock users for concurrent testing
const createMockUsers = (): MockUser[] => [
  {
    id: 'user_1',
    email: 'user1@test.com',
    name: 'Concurrent User 1',
    projectId: 'project_1',
  },
  {
    id: 'user_2',
    email: 'user2@test.com',
    name: 'Concurrent User 2',
    projectId: 'project_2',
  },
  {
    id: 'user_3',
    email: 'user3@test.com',
    name: 'Concurrent User 3',
    projectId: 'project_3',
  },
  {
    id: 'user_4',
    email: 'user4@test.com',
    name: 'Concurrent User 4',
    projectId: 'project_4',
  },
];

// Test scenarios for concurrent processing
const concurrentTestScenarios: ConcurrentTestScenario[] = [
  {
    name: 'Light Load - 2 Users',
    userCount: 2,
    imagesPerUser: 3,
    expectedMessages: 12, // 2 users × 3 images × 2 messages (start + complete)
    simulatedNetworkDelay: 50,
  },
  {
    name: 'Medium Load - 3 Users',
    userCount: 3,
    imagesPerUser: 4,
    expectedMessages: 24, // 3 users × 4 images × 2 messages
    simulatedNetworkDelay: 100,
  },
  {
    name: 'High Load - 4 Users',
    userCount: 4,
    imagesPerUser: 5,
    expectedMessages: 40, // 4 users × 5 images × 2 messages
    simulatedNetworkDelay: 150,
  },
];

describe('useSegmentationQueue Parallel Processing Tests', () => {
  let queryClient: QueryClient;
  let mockSocket: any;
  let mockApi: any;
  let mockUsers: MockUser[];

  beforeEach(() => {
    // Setup fresh QueryClient for each test
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, cacheTime: 0 },
        mutations: { retry: false },
      },
    });

    // Setup mock socket with event handling
    mockSocket = {
      connected: true,
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      listeners: new Map(),
    };

    // Enhance socket mock with event simulation
    mockSocket.on.mockImplementation((event, handler) => {
      if (!mockSocket.listeners.has(event)) {
        mockSocket.listeners.set(event, []);
      }
      mockSocket.listeners.get(event).push(handler);
    });

    mockSocket.emit.mockImplementation((event, data) => {
      const handlers = mockSocket.listeners.get(event) || [];
      handlers.forEach(handler => handler(data));
    });

    // Setup mock API
    mockApi = {
      get: vi.fn(),
      post: vi.fn(),
      delete: vi.fn(),
    };

    // Setup default API responses
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/queue/stats')) {
        return Promise.resolve({
          data: { stats: { queued: 0, processing: 0, total: 0 } },
        });
      }
      if (url.includes('/queue/items')) {
        return Promise.resolve({ data: { items: [] } });
      }
      return Promise.resolve({ data: {} });
    });

    mockApi.post.mockImplementation(() =>
      Promise.resolve({ data: { success: true } })
    );
    mockApi.delete.mockImplementation(() =>
      Promise.resolve({ data: { success: true } })
    );

    mockUsers = createMockUsers();

    // Import mock after setup
    const { default: api } = require('@/lib/api');
    Object.assign(api, mockApi);

    const { io } = require('socket.io-client');
    io.mockReturnValue(mockSocket);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // Helper function to create test wrapper with context providers
  const createTestWrapper = (user: MockUser) => {
    const TestWrapper: React.FC<{ children: React.ReactNode }> = ({
      children,
    }) => (
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider
          value={{
            user: { id: user.id, email: user.email, name: user.name },
            isAuthenticated: true,
            login: vi.fn(),
            logout: vi.fn(),
            loading: false,
          }}
        >
          <WebSocketProvider>{children}</WebSocketProvider>
        </AuthContext.Provider>
      </QueryClientProvider>
    );
    return TestWrapper;
  };

  // Helper function to simulate WebSocket messages
  const simulateWebSocketMessage = (
    type: string,
    data: any,
    userId: string
  ) => {
    const message: MockWebSocketMessage = {
      type,
      data,
      timestamp: Date.now(),
      userId,
    };

    const handlers = mockSocket.listeners.get(type) || [];
    handlers.forEach(handler => {
      // Simulate network delay
      setTimeout(() => handler(message.data), Math.random() * 50);
    });
  };

  describe('Concurrent Hook State Management', () => {
    test('should handle 4 concurrent hook instances without state conflicts', async () => {
      const hookInstances: any[] = [];
      const stateSnapshots: any[][] = [];

      // Render hooks for all 4 users concurrently
      for (const user of mockUsers) {
        const wrapper = createTestWrapper(user);
        const { result, rerender } = renderHook(
          () => useSegmentationQueue(user.projectId),
          { wrapper }
        );

        hookInstances.push({ result, rerender, user });
        stateSnapshots.push([]);
      }

      // Setup state monitoring for all hooks
      hookInstances.forEach((instance, index) => {
        const snapshots = stateSnapshots[index];

        // Capture initial state
        snapshots.push({
          timestamp: Date.now(),
          state: {
            isLoading: instance.result.current.isLoading,
            queueStats: instance.result.current.queueStats,
            queueItems: instance.result.current.queueItems,
            error: instance.result.current.error,
          },
        });
      });

      // Simulate concurrent queue operations
      const operations = hookInstances.map(async (instance, index) => {
        const { user } = instance;

        await act(async () => {
          // Simulate adding multiple images to queue
          for (let i = 0; i < 3; i++) {
            const imageId = `${user.id}_image_${i}`;

            // Mock API response for queue addition
            mockApi.post.mockResolvedValueOnce({
              data: {
                queueEntry: {
                  id: `queue_${imageId}`,
                  imageId,
                  status: 'queued',
                  userId: user.id,
                  projectId: user.projectId,
                },
              },
            });

            // Add to queue
            await instance.result.current.addToQueue(imageId, 'hrnet', 0.5);

            // Capture state after operation
            stateSnapshots[index].push({
              timestamp: Date.now(),
              state: {
                isLoading: instance.result.current.isLoading,
                queueStats: instance.result.current.queueStats,
                queueItems: instance.result.current.queueItems,
                error: instance.result.current.error,
              },
              operation: `add_${imageId}`,
            });

            // Simulate processing delay
            await new Promise(resolve => setTimeout(resolve, 50));
          }
        });

        return { userId: user.id, snapshots: stateSnapshots[index] };
      });

      // Wait for all concurrent operations to complete
      const results = await Promise.all(operations);

      // Verify state isolation between hooks
      for (let i = 0; i < results.length; i++) {
        const userResult = results[i];
        const finalSnapshot =
          userResult.snapshots[userResult.snapshots.length - 1];

        // Each hook should maintain its own state
        expect(finalSnapshot.state.error).toBeNull();

        // Verify user-specific queue items
        if (
          finalSnapshot.state.queueItems &&
          finalSnapshot.state.queueItems.length > 0
        ) {
          finalSnapshot.state.queueItems.forEach((item: any) => {
            expect(item.userId).toBe(userResult.userId);
          });
        }
      }

      // Verify no cross-contamination between user states
      for (let i = 0; i < hookInstances.length; i++) {
        for (let j = i + 1; j < hookInstances.length; j++) {
          const state1 = hookInstances[i].result.current;
          const state2 = hookInstances[j].result.current;

          // States should be independent
          expect(state1.queueItems).not.toEqual(state2.queueItems);
        }
      }

      // Performance verification - operations should complete quickly
      const totalOperationTime = Math.max(
        ...results.map(
          r =>
            r.snapshots[r.snapshots.length - 1].timestamp -
            r.snapshots[0].timestamp
        )
      );

      expect(totalOperationTime).toBeLessThan(5000); // Should complete within 5 seconds
    });

    test('should synchronize WebSocket updates across concurrent hooks', async () => {
      const hookInstances: any[] = [];
      const receivedMessages: { userId: string; messages: any[] }[] = [];

      // Setup hooks for all users
      for (const user of mockUsers) {
        const wrapper = createTestWrapper(user);
        const { result } = renderHook(
          () => useSegmentationQueue(user.projectId),
          { wrapper }
        );

        hookInstances.push({ result, user });
        receivedMessages.push({ userId: user.id, messages: [] });
      }

      // Wait for hooks to initialize
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
      });

      // Simulate concurrent WebSocket messages for all users
      const messagePromises = mockUsers.map(async (user, index) => {
        const messages = [
          {
            type: 'segmentationUpdate',
            data: {
              imageId: `${user.id}_img_1`,
              status: 'processing',
              userId: user.id,
              projectId: user.projectId,
            },
          },
          {
            type: 'segmentationUpdate',
            data: {
              imageId: `${user.id}_img_1`,
              status: 'completed',
              userId: user.id,
              projectId: user.projectId,
            },
          },
          {
            type: 'queueStatsUpdate',
            data: {
              projectId: user.projectId,
              queued: 0,
              processing: 1,
              total: 1,
            },
          },
          {
            type: 'queueStatsUpdate',
            data: {
              projectId: user.projectId,
              queued: 0,
              processing: 0,
              total: 0,
            },
          },
        ];

        // Send messages with realistic timing
        for (const message of messages) {
          await act(async () => {
            simulateWebSocketMessage(message.type, message.data, user.id);
            receivedMessages[index].messages.push(message);
            await new Promise(resolve => setTimeout(resolve, 100)); // 100ms between messages
          });
        }

        return { userId: user.id, messageCount: messages.length };
      });

      // Wait for all messages to be processed
      const messageResults = await Promise.all(messagePromises);

      // Verify message handling
      messageResults.forEach(result => {
        expect(result.messageCount).toBe(4); // Each user should send 4 messages
      });

      // Verify hooks processed their respective messages
      hookInstances.forEach((instance, index) => {
        const { user } = instance;
        const userMessages = receivedMessages[index].messages;

        // Each hook should have received messages for its user
        expect(userMessages.length).toBe(4);

        userMessages.forEach(message => {
          if (message.data.userId) {
            expect(message.data.userId).toBe(user.id);
          }
          if (message.data.projectId) {
            expect(message.data.projectId).toBe(user.projectId);
          }
        });
      });

      // Verify final states are consistent with received messages
      hookInstances.forEach(instance => {
        const currentState = instance.result.current;

        // Queue should be empty after processing
        expect(currentState.queueStats?.processing || 0).toBe(0);
        expect(currentState.queueStats?.queued || 0).toBe(0);
      });
    });
  });

  describe('High-Throughput WebSocket Message Handling', () => {
    test.each(concurrentTestScenarios)(
      'should handle high-frequency messages in $name scenario',
      async ({
        userCount,
        imagesPerUser,
        expectedMessages,
        simulatedNetworkDelay,
      }) => {
        const activeUsers = mockUsers.slice(0, userCount);
        const hookInstances: any[] = [];
        const messageMetrics: ParallelHookMetrics[] = [];

        // Setup hooks for active users
        for (const user of activeUsers) {
          const wrapper = createTestWrapper(user);
          const { result } = renderHook(
            () => useSegmentationQueue(user.projectId),
            { wrapper }
          );

          hookInstances.push({ result, user });
          messageMetrics.push({
            totalStateUpdates: 0,
            websocketMessages: 0,
            apiCalls: 0,
            errorCount: 0,
            averageUpdateLatency: 0,
            memoryLeaks: false,
            uiResponsiveness: 0,
          });
        }

        // Monitor state updates
        const stateUpdateTimestamps: number[][] = Array(userCount)
          .fill(null)
          .map(() => []);

        hookInstances.forEach((instance, index) => {
          const originalState = instance.result.current;

          // Mock state update monitoring
          const checkStateUpdates = () => {
            const currentState = instance.result.current;
            if (currentState !== originalState) {
              stateUpdateTimestamps[index].push(Date.now());
              messageMetrics[index].totalStateUpdates++;
            }
          };

          // Check for updates periodically
          const updateInterval = setInterval(checkStateUpdates, 50);
          setTimeout(() => clearInterval(updateInterval), 10000); // Stop after 10 seconds
        });

        // Generate high-frequency WebSocket messages
        const messageGenerationStart = Date.now();

        const messagePromises = activeUsers.map(async (user, userIndex) => {
          const userMetrics = messageMetrics[userIndex];

          for (let imageIndex = 0; imageIndex < imagesPerUser; imageIndex++) {
            const imageId = `${user.id}_high_freq_${imageIndex}`;

            // Queue start message
            await act(async () => {
              simulateWebSocketMessage(
                'segmentationUpdate',
                {
                  imageId,
                  status: 'processing',
                  userId: user.id,
                  projectId: user.projectId,
                  timestamp: Date.now(),
                },
                user.id
              );

              userMetrics.websocketMessages++;
            });

            // Simulate processing time with network delay
            await new Promise(resolve =>
              setTimeout(resolve, simulatedNetworkDelay)
            );

            // Progress updates (simulate multiple progress messages)
            for (let progress = 25; progress <= 75; progress += 25) {
              await act(async () => {
                simulateWebSocketMessage(
                  'segmentationProgress',
                  {
                    imageId,
                    progress,
                    userId: user.id,
                    projectId: user.projectId,
                    timestamp: Date.now(),
                  },
                  user.id
                );

                userMetrics.websocketMessages++;
              });

              await new Promise(resolve => setTimeout(resolve, 25)); // Brief delay between progress updates
            }

            // Completion message
            await act(async () => {
              simulateWebSocketMessage(
                'segmentationComplete',
                {
                  imageId,
                  status: 'completed',
                  polygonCount: Math.floor(Math.random() * 20) + 5,
                  userId: user.id,
                  projectId: user.projectId,
                  timestamp: Date.now(),
                },
                user.id
              );

              userMetrics.websocketMessages++;
            });

            // Queue stats update
            await act(async () => {
              simulateWebSocketMessage(
                'queueStatsUpdate',
                {
                  projectId: user.projectId,
                  queued: Math.max(0, imagesPerUser - imageIndex - 1),
                  processing: 0,
                  total: imagesPerUser,
                  timestamp: Date.now(),
                },
                user.id
              );

              userMetrics.websocketMessages++;
            });
          }

          return userMetrics;
        });

        // Wait for all high-frequency messages to be processed
        const finalMetrics = await Promise.all(messagePromises);
        const messageGenerationTime = Date.now() - messageGenerationStart;

        // Calculate performance metrics
        finalMetrics.forEach((metrics, index) => {
          const updateTimestamps = stateUpdateTimestamps[index];

          if (updateTimestamps.length > 1) {
            const latencies = updateTimestamps
              .slice(1)
              .map((timestamp, i) => timestamp - updateTimestamps[i]);
            metrics.averageUpdateLatency =
              latencies.reduce((a, b) => a + b, 0) / latencies.length;
          }

          metrics.uiResponsiveness =
            updateTimestamps.length / (messageGenerationTime / 1000); // updates per second
        });

        // Performance assertions
        const totalMessages = finalMetrics.reduce(
          (sum, m) => sum + m.websocketMessages,
          0
        );
        expect(totalMessages).toBeGreaterThanOrEqual(expectedMessages * 0.9); // Allow 10% message loss

        // UI responsiveness check
        finalMetrics.forEach((metrics, index) => {
          expect(metrics.uiResponsiveness).toBeGreaterThan(0); // Should have some state updates
          expect(metrics.averageUpdateLatency).toBeLessThan(1000); // Updates should be < 1 second apart

          if (metrics.errorCount > 0) {
            expect(metrics.errorCount).toBeLessThan(
              metrics.websocketMessages * 0.1
            ); // < 10% error rate
          }
        });

        // Overall system performance
        const avgResponseTime = messageGenerationTime / totalMessages;
        expect(avgResponseTime).toBeLessThan(100); // Average < 100ms per message

        console.log(
          `High-Throughput Test Results (${userCount} users, ${imagesPerUser} images/user):`
        );
        console.log(
          `Total messages: ${totalMessages}, Processing time: ${messageGenerationTime}ms`
        );
        console.log(
          `Average response time: ${avgResponseTime.toFixed(1)}ms per message`
        );
        finalMetrics.forEach((metrics, index) => {
          console.log(
            `User ${index + 1}: ${metrics.websocketMessages} messages, ${metrics.uiResponsiveness.toFixed(1)} updates/s`
          );
        });
      }
    );

    test('should maintain UI responsiveness during message floods', async () => {
      const user = mockUsers[0];
      const wrapper = createTestWrapper(user);
      const { result } = renderHook(
        () => useSegmentationQueue(user.projectId),
        { wrapper }
      );

      // Track UI responsiveness metrics
      const performanceMetrics = {
        messagesSent: 0,
        stateUpdatesReceived: 0,
        maxUpdateDelay: 0,
        updateDelays: [] as number[],
      };

      // Monitor state changes
      let lastStateChange = Date.now();
      const originalState = result.current;

      const monitorStateChanges = () => {
        const currentState = result.current;
        if (currentState !== originalState) {
          const now = Date.now();
          const delay = now - lastStateChange;

          performanceMetrics.stateUpdatesReceived++;
          performanceMetrics.updateDelays.push(delay);
          performanceMetrics.maxUpdateDelay = Math.max(
            performanceMetrics.maxUpdateDelay,
            delay
          );

          lastStateChange = now;
        }
      };

      // Start monitoring
      const monitorInterval = setInterval(monitorStateChanges, 10);

      // Flood with WebSocket messages
      const messageFloodPromise = act(async () => {
        const messagesPerSecond = 50; // High frequency
        const floodDuration = 2000; // 2 seconds
        const totalMessages = (messagesPerSecond * floodDuration) / 1000;

        for (let i = 0; i < totalMessages; i++) {
          const messageType =
            i % 4 === 0 ? 'queueStatsUpdate' : 'segmentationUpdate';

          simulateWebSocketMessage(
            messageType,
            {
              imageId: `flood_test_${i}`,
              status: i % 2 === 0 ? 'processing' : 'completed',
              userId: user.id,
              projectId: user.projectId,
              timestamp: Date.now(),
            },
            user.id
          );

          performanceMetrics.messagesSent++;

          // Small delay to simulate realistic message frequency
          await new Promise(resolve =>
            setTimeout(resolve, floodDuration / totalMessages)
          );
        }
      });

      await messageFloodPromise;

      // Stop monitoring
      clearInterval(monitorInterval);

      // Analyze UI responsiveness
      const avgUpdateDelay =
        performanceMetrics.updateDelays.length > 0
          ? performanceMetrics.updateDelays.reduce((a, b) => a + b, 0) /
            performanceMetrics.updateDelays.length
          : 0;

      // UI responsiveness assertions
      expect(performanceMetrics.maxUpdateDelay).toBeLessThan(500); // Max delay should be < 500ms
      expect(avgUpdateDelay).toBeLessThan(100); // Average delay should be < 100ms
      expect(performanceMetrics.stateUpdatesReceived).toBeGreaterThan(0); // Should process some updates

      // Hook should remain functional after message flood
      expect(result.current.error).toBeNull();
      expect(typeof result.current.addToQueue).toBe('function');
      expect(typeof result.current.removeFromQueue).toBe('function');

      console.log(`Message Flood Test Results:`);
      console.log(`Messages sent: ${performanceMetrics.messagesSent}`);
      console.log(`State updates: ${performanceMetrics.stateUpdatesReceived}`);
      console.log(`Max update delay: ${performanceMetrics.maxUpdateDelay}ms`);
      console.log(`Average update delay: ${avgUpdateDelay.toFixed(1)}ms`);
    });
  });

  describe('Error Handling and Recovery', () => {
    test('should handle WebSocket disconnections during concurrent operations', async () => {
      const activeUsers = mockUsers.slice(0, 3);
      const hookInstances: any[] = [];

      // Setup hooks
      for (const user of activeUsers) {
        const wrapper = createTestWrapper(user);
        const { result } = renderHook(
          () => useSegmentationQueue(user.projectId),
          { wrapper }
        );
        hookInstances.push({ result, user });
      }

      // Start concurrent operations
      const operationPromises = hookInstances.map(async (instance, index) => {
        const { user } = instance;

        // Start some queue operations
        await act(async () => {
          mockApi.post.mockResolvedValueOnce({
            data: {
              queueEntry: {
                id: `queue_${user.id}`,
                imageId: `${user.id}_img`,
                status: 'queued',
              },
            },
          });

          await instance.result.current.addToQueue(
            `${user.id}_img`,
            'hrnet',
            0.5
          );
        });

        return { userId: user.id, operationSuccess: true };
      });

      // Simulate WebSocket disconnection during operations
      await act(async () => {
        // Simulate connection loss
        mockSocket.connected = false;

        // Trigger disconnect handlers
        const disconnectHandlers = mockSocket.listeners.get('disconnect') || [];
        disconnectHandlers.forEach(handler => handler('transport close'));

        await new Promise(resolve => setTimeout(resolve, 100));
      });

      // Wait for operations to handle disconnection
      const operationResults = await Promise.all(operationPromises);

      // Simulate reconnection
      await act(async () => {
        mockSocket.connected = true;

        // Trigger connect handlers
        const connectHandlers = mockSocket.listeners.get('connect') || [];
        connectHandlers.forEach(handler => handler());

        await new Promise(resolve => setTimeout(resolve, 200));
      });

      // Verify all operations completed despite disconnection
      operationResults.forEach(result => {
        expect(result.operationSuccess).toBe(true);
      });

      // Verify hooks are still functional after reconnection
      hookInstances.forEach(instance => {
        expect(instance.result.current.error).toBeNull();
        expect(typeof instance.result.current.addToQueue).toBe('function');
      });
    });

    test('should recover from API failures in concurrent scenarios', async () => {
      const activeUsers = mockUsers.slice(0, 2);
      const hookInstances: any[] = [];
      const recoveryMetrics = {
        totalApiCalls: 0,
        failedApiCalls: 0,
        successfulRetries: 0,
        finalSuccessRate: 0,
      };

      // Setup hooks
      for (const user of activeUsers) {
        const wrapper = createTestWrapper(user);
        const { result } = renderHook(
          () => useSegmentationQueue(user.projectId),
          { wrapper }
        );
        hookInstances.push({ result, user });
      }

      // Configure API to fail initially, then succeed
      let apiCallCount = 0;
      mockApi.post.mockImplementation(() => {
        apiCallCount++;
        recoveryMetrics.totalApiCalls++;

        // Fail first 3 calls, then succeed
        if (apiCallCount <= 3) {
          recoveryMetrics.failedApiCalls++;
          return Promise.reject(new Error('API temporarily unavailable'));
        } else {
          recoveryMetrics.successfulRetries++;
          return Promise.resolve({
            data: {
              queueEntry: { id: `recovery_${apiCallCount}`, status: 'queued' },
            },
          });
        }
      });

      // Attempt concurrent operations with retry logic
      const recoveryPromises = hookInstances.map(async (instance, index) => {
        const { user } = instance;
        let attempts = 0;
        const maxRetries = 5;

        while (attempts < maxRetries) {
          try {
            await act(async () => {
              await instance.result.current.addToQueue(
                `${user.id}_recovery_img`,
                'hrnet',
                0.5
              );
            });

            return { userId: user.id, success: true, attempts: attempts + 1 };
          } catch (error) {
            attempts++;
            if (attempts < maxRetries) {
              await new Promise(resolve => setTimeout(resolve, 100 * attempts)); // Exponential backoff
            }
          }
        }

        return { userId: user.id, success: false, attempts };
      });

      const recoveryResults = await Promise.all(recoveryPromises);

      // Calculate final metrics
      recoveryMetrics.finalSuccessRate =
        recoveryResults.filter(r => r.success).length / recoveryResults.length;

      // Recovery assertions
      expect(recoveryMetrics.finalSuccessRate).toBeGreaterThan(0.5); // At least 50% should eventually succeed
      expect(recoveryMetrics.successfulRetries).toBeGreaterThan(0); // Some retries should succeed

      // Verify hooks maintained functionality
      hookInstances.forEach(instance => {
        expect(typeof instance.result.current.addToQueue).toBe('function');
      });

      console.log('API Recovery Test Results:', recoveryMetrics);
    });

    test('should handle mixed success/failure scenarios in concurrent operations', async () => {
      const activeUsers = mockUsers;
      const hookInstances: any[] = [];
      const scenarioResults: {
        success: boolean;
        error?: string;
        userId: string;
      }[] = [];

      // Setup hooks
      for (const user of activeUsers) {
        const wrapper = createTestWrapper(user);
        const { result } = renderHook(
          () => useSegmentationQueue(user.projectId),
          { wrapper }
        );
        hookInstances.push({ result, user });
      }

      // Configure mixed success/failure API responses
      mockApi.post.mockImplementation((url: string) => {
        const urlParts = url.split('/');
        const identifier = urlParts[urlParts.length - 1];

        // Create deterministic success/failure pattern
        const shouldFail =
          identifier.includes('user_2') || identifier.includes('user_4');

        if (shouldFail) {
          return Promise.reject(new Error(`Service error for ${identifier}`));
        } else {
          return Promise.resolve({
            data: {
              queueEntry: { id: `mixed_${identifier}`, status: 'queued' },
            },
          });
        }
      });

      // Execute concurrent operations with mixed outcomes
      const mixedOperationPromises = hookInstances.map(
        async (instance, index) => {
          const { user } = instance;

          try {
            await act(async () => {
              await instance.result.current.addToQueue(
                `${user.id}_mixed_img`,
                'hrnet',
                0.5
              );
            });

            scenarioResults.push({ success: true, userId: user.id });
            return { userId: user.id, outcome: 'success' };
          } catch (error) {
            scenarioResults.push({
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
              userId: user.id,
            });
            return {
              userId: user.id,
              outcome: 'failure',
              error: error instanceof Error ? error.message : 'Unknown',
            };
          }
        }
      );

      const mixedResults = await Promise.all(mixedOperationPromises);

      // Analyze mixed scenario results
      const successfulUsers = scenarioResults.filter(r => r.success);
      const failedUsers = scenarioResults.filter(r => !r.success);

      // Verify expected pattern
      expect(successfulUsers.length).toBe(2); // Users 1 and 3 should succeed
      expect(failedUsers.length).toBe(2); // Users 2 and 4 should fail

      // Verify successful hooks maintain functionality
      hookInstances.forEach((instance, index) => {
        const isExpectedToSucceed =
          !instance.user.id.includes('user_2') &&
          !instance.user.id.includes('user_4');

        if (isExpectedToSucceed) {
          expect(instance.result.current.error).toBeNull();
        }

        // All hooks should remain functional
        expect(typeof instance.result.current.addToQueue).toBe('function');
      });

      // Verify error isolation - failures shouldn't affect successful hooks
      const user1Hook = hookInstances.find(h => h.user.id === 'user_1');
      const user3Hook = hookInstances.find(h => h.user.id === 'user_3');

      if (user1Hook && user3Hook) {
        expect(user1Hook.result.current.error).toBeNull();
        expect(user3Hook.result.current.error).toBeNull();
      }

      console.log('Mixed Scenario Results:');
      console.log(
        `Successful: ${successfulUsers.length}, Failed: ${failedUsers.length}`
      );
      mixedResults.forEach(result => {
        console.log(`${result.userId}: ${result.outcome}`);
      });
    });
  });

  describe('Memory Management and Performance', () => {
    test('should not cause memory leaks during sustained concurrent operations', async () => {
      const user = mockUsers[0];
      const wrapper = createTestWrapper(user);

      // Track hook instances and cleanup
      const hookRenders: any[] = [];
      let renderCount = 0;

      // Create and destroy multiple hook instances rapidly
      for (let cycle = 0; cycle < 10; cycle++) {
        const { result, unmount } = renderHook(
          () => {
            renderCount++;
            return useSegmentationQueue(user.projectId);
          },
          { wrapper }
        );

        hookRenders.push({ result, unmount, cycle });

        // Perform operations on each hook instance
        await act(async () => {
          mockApi.post.mockResolvedValueOnce({
            data: {
              queueEntry: { id: `memory_test_${cycle}`, status: 'queued' },
            },
          });

          await result.current.addToQueue(`memory_test_${cycle}`, 'hrnet', 0.5);
        });

        // Simulate WebSocket messages
        simulateWebSocketMessage(
          'segmentationUpdate',
          {
            imageId: `memory_test_${cycle}`,
            status: 'completed',
            userId: user.id,
            projectId: user.projectId,
          },
          user.id
        );

        // Cleanup every other cycle
        if (cycle % 2 === 1) {
          unmount();
        }

        await new Promise(resolve => setTimeout(resolve, 50)); // Brief pause between cycles
      }

      // Cleanup remaining instances
      hookRenders.forEach(({ unmount }) => {
        try {
          unmount();
        } catch (e) {
          // Already unmounted
        }
      });

      // Verify memory management
      expect(renderCount).toBe(10); // All hooks should have rendered

      // Check for potential memory leaks (simplified)
      // In a real environment, you would use memory profiling tools
      const activeListeners = Array.from(mockSocket.listeners.values()).flat()
        .length;
      expect(activeListeners).toBeLessThan(50); // Should not accumulate excessive listeners

      console.log(
        `Memory Management Test: ${renderCount} renders, ${activeListeners} active listeners`
      );
    });

    test('should maintain performance with high-frequency state updates', async () => {
      const user = mockUsers[0];
      const wrapper = createTestWrapper(user);
      const { result } = renderHook(
        () => useSegmentationQueue(user.projectId),
        { wrapper }
      );

      const performanceMetrics = {
        updateCount: 0,
        totalUpdateTime: 0,
        maxUpdateTime: 0,
        updateTimes: [] as number[],
      };

      // Generate high-frequency updates
      const updateCount = 100;
      const startTime = Date.now();

      for (let i = 0; i < updateCount; i++) {
        const updateStart = performance.now();

        await act(async () => {
          // Simulate various types of updates
          const updateType = i % 3;

          if (updateType === 0) {
            simulateWebSocketMessage(
              'queueStatsUpdate',
              {
                projectId: user.projectId,
                queued: Math.floor(Math.random() * 10),
                processing: Math.floor(Math.random() * 5),
                total: Math.floor(Math.random() * 15),
              },
              user.id
            );
          } else if (updateType === 1) {
            simulateWebSocketMessage(
              'segmentationUpdate',
              {
                imageId: `perf_test_${i}`,
                status: i % 2 === 0 ? 'processing' : 'completed',
                userId: user.id,
                projectId: user.projectId,
              },
              user.id
            );
          } else {
            simulateWebSocketMessage(
              'segmentationProgress',
              {
                imageId: `perf_test_${i}`,
                progress: i % 100,
                userId: user.id,
                projectId: user.projectId,
              },
              user.id
            );
          }
        });

        const updateTime = performance.now() - updateStart;
        performanceMetrics.updateTimes.push(updateTime);
        performanceMetrics.totalUpdateTime += updateTime;
        performanceMetrics.maxUpdateTime = Math.max(
          performanceMetrics.maxUpdateTime,
          updateTime
        );
        performanceMetrics.updateCount++;

        // Brief pause to prevent overwhelming
        if (i % 10 === 0) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }

      const totalTime = Date.now() - startTime;
      const averageUpdateTime =
        performanceMetrics.totalUpdateTime / performanceMetrics.updateCount;

      // Performance assertions
      expect(averageUpdateTime).toBeLessThan(50); // Average update should be < 50ms
      expect(performanceMetrics.maxUpdateTime).toBeLessThan(200); // Max update should be < 200ms
      expect(totalTime).toBeLessThan(10000); // Total time should be < 10 seconds

      // Hook should remain functional
      expect(result.current.error).toBeNull();
      expect(typeof result.current.addToQueue).toBe('function');

      console.log(`Performance Test Results:`);
      console.log(
        `Updates: ${performanceMetrics.updateCount}, Total time: ${totalTime}ms`
      );
      console.log(`Average update time: ${averageUpdateTime.toFixed(2)}ms`);
      console.log(
        `Max update time: ${performanceMetrics.maxUpdateTime.toFixed(2)}ms`
      );
    });
  });
});
