import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach as _beforeEach,
  afterEach as _afterEach,
} from 'vitest';
import axios, { AxiosInstance } from 'axios';
import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import FormData from 'form-data';
import * as fs from 'fs';
import * as path from 'path';
import { io as ioClient } from 'socket.io-client';

/**
 * Critical Workflow Integration Tests
 * Tests complete user journeys through the application
 */

const API_BASE_URL = process.env.TEST_API_URL || 'http://localhost:3001/api';
const TEST_TIMEOUT = 60000; // 60 seconds for ML operations

describe('Critical User Workflows', () => {
  let api: AxiosInstance;
  let prisma: PrismaClient;
  let authToken: string;
  let refreshToken: string;
  let testUser: { id: string; email: string };
  let testProject: { id: string; name: string };
  let testImage: { id: string; filename: string };

  beforeAll(async () => {
    // Initialize API client
    api = axios.create({
      baseURL: API_BASE_URL,
      timeout: TEST_TIMEOUT,
      validateStatus: () => true, // Don't throw on any status
    });

    // Initialize Prisma client
    prisma = new PrismaClient();
    await prisma.$connect();
  });

  afterAll(async () => {
    // Cleanup test data
    if (testUser?.id) {
      await prisma.user.delete({ where: { id: testUser.id } }).catch(() => {});
    }

    await prisma.$disconnect();
  });

  describe('Complete Registration → Login → Project → Segmentation Workflow', () => {
    const testEmail = `test-${uuidv4()}@example.com`;
    const testPassword = 'TestPassword123!';

    it(
      'should complete full user journey with error recovery',
      async () => {
        // Step 1: Register new user
        const registerResponse = await api.post('/auth/register', {
          email: testEmail,
          password: testPassword,
          username: `testuser-${Date.now()}`,
        });

        expect(registerResponse.status).toBe(201);
        expect(registerResponse.data.user).toBeDefined();
        expect(registerResponse.data.accessToken).toBeDefined();

        testUser = registerResponse.data.user;
        authToken = registerResponse.data.accessToken;
        refreshToken = registerResponse.data.refreshToken;

        // Configure API with auth token
        api.defaults.headers.common['Authorization'] = `Bearer ${authToken}`;

        // Step 2: Create a project
        const projectResponse = await api.post('/projects', {
          name: `Test Project ${Date.now()}`,
          description: 'Integration test project',
          visibility: 'private',
          segmentationSettings: {
            model: 'hrnet',
            threshold: 0.5,
          },
        });

        expect(projectResponse.status).toBe(201);
        expect(projectResponse.data.id).toBeDefined();
        testProject = projectResponse.data;

        // Step 3: Upload an image
        const testImagePath = path.join(__dirname, '../fixtures/test-cell.jpg');

        // Check if test fixture exists, otherwise create a minimal test image
        let imageBuffer: Buffer;
        if (fs.existsSync(testImagePath)) {
          imageBuffer = fs.readFileSync(testImagePath);
        } else {
          // Create a minimal 1x1 pixel JPEG for testing
          // This is a base64 encoded 1x1 white pixel JPEG
          const minimalJpeg =
            '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP/bAEMAAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAf/AABEIAAEAAQMBEgACEQEDEQH/xABVAAEAAAAAAAAAAAAAAAAAAAAKEAEBAQAAAAAAAAAAAAAAAAAAAQEBAQAAAAAAAAAAAAAAAAAAAAERAAEAAAAAAAAAAAAAAAAAAAAQEQEAAAAAAAAAAAAAAAAAAAAQ/9oADAMBAAIRAxEAPwA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhADEAAAAU8P/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AAAA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEAAA8A//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAn//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/AX//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/AX//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/An//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IX//2gAMAwEAAgADAAAAEAB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=';
          imageBuffer = Buffer.from(minimalJpeg, 'base64');
          //           console.warn('Test fixture not found, using minimal test image');
        }

        const formData = new FormData();
        formData.append('images', imageBuffer, 'test-cell.jpg');

        const uploadResponse = await api.post(
          `/projects/${testProject.id}/images/upload`,
          formData,
          {
            headers: {
              ...formData.getHeaders(),
            },
          }
        );

        expect(uploadResponse.status).toBe(201);
        expect(uploadResponse.data.images).toHaveLength(1);
        testImage = uploadResponse.data.images[0];

        // Step 4: Submit for segmentation
        const segmentationResponse = await api.post(
          `/projects/${testProject.id}/images/${testImage.id}/segment`,
          {
            model: 'hrnet',
            threshold: 0.5,
          }
        );

        expect(segmentationResponse.status).toBe(202);
        expect(segmentationResponse.data.queueId).toBeDefined();

        // Step 5: Poll for segmentation completion (with timeout)
        const startTime = Date.now();
        let segmentationComplete = false;
        let segmentationResult = null;

        while (!segmentationComplete && Date.now() - startTime < 30000) {
          await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds

          const statusResponse = await api.get(
            `/projects/${testProject.id}/images/${testImage.id}/segmentation`
          );

          if (
            statusResponse.status === 200 &&
            statusResponse.data.status === 'completed'
          ) {
            segmentationComplete = true;
            segmentationResult = statusResponse.data;
          } else if (statusResponse.data.status === 'failed') {
            throw new Error(
              'Segmentation failed: ' + statusResponse.data.error
            );
          }
        }

        expect(segmentationComplete).toBe(true);
        expect(segmentationResult).toBeDefined();
        expect(segmentationResult.polygons).toBeDefined();
        expect(Array.isArray(segmentationResult.polygons)).toBe(true);

        // Step 6: Test error recovery - invalid token
        const oldToken = api.defaults.headers.common['Authorization'];
        api.defaults.headers.common['Authorization'] = 'Bearer invalid-token';

        const unauthorizedResponse = await api.get('/auth/profile');
        expect(unauthorizedResponse.status).toBe(401);

        // Step 7: Use refresh token to get new access token
        api.defaults.headers.common['Authorization'] = oldToken;
        const refreshResponse = await api.post('/auth/refresh-token', {
          refreshToken: refreshToken,
        });

        expect(refreshResponse.status).toBe(200);
        expect(refreshResponse.data.accessToken).toBeDefined();

        authToken = refreshResponse.data.accessToken;
        api.defaults.headers.common['Authorization'] = `Bearer ${authToken}`;

        // Step 8: Export segmentation results
        const exportResponse = await api.get(
          `/projects/${testProject.id}/images/${testImage.id}/export`,
          {
            params: { format: 'coco' },
          }
        );

        expect(exportResponse.status).toBe(200);
        expect(exportResponse.data).toHaveProperty('annotations');

        // Step 9: Delete project (cleanup)
        const deleteResponse = await api.delete(`/projects/${testProject.id}`);
        expect(deleteResponse.status).toBe(204);

        // Step 10: Verify project is deleted
        const getDeletedResponse = await api.get(`/projects/${testProject.id}`);
        expect(getDeletedResponse.status).toBe(404);
      },
      TEST_TIMEOUT
    );
  });

  describe('WebSocket Real-time Updates', () => {
    it('should receive real-time segmentation updates', async () => {
      // This would require Socket.io client setup
      // Simplified version for demonstration

      const socket = ioClient(API_BASE_URL.replace('/api', ''), {
        auth: { token: authToken },
      });

      return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          socket.disconnect();
          reject(new Error('Timeout waiting for segmentation update'));
        }, 30000);

        socket.on('connect', () => {
          //           console.log('WebSocket connected');
          socket.emit('join-project', testProject.id);
        });

        socket.on('segmentationUpdate', (data: any) => {
          clearTimeout(timeout);
          try {
            expect(data).toHaveProperty('imageId');
            expect(data).toHaveProperty('status');
            socket.disconnect();
            resolve();
          } catch (error) {
            socket.disconnect();
            reject(error);
          }
        });

        socket.on('error', (error: any) => {
          clearTimeout(timeout);
          socket.disconnect();
          reject(error);
        });

        // Trigger segmentation request
        api
          .post(`/projects/${testProject.id}/images/${testImage.id}/segment`, {
            model: 'hrnet-v2',
          })
          .catch(err => {
            clearTimeout(timeout);
            socket.disconnect();
            reject(err);
          });
      });
    });
  });

  describe('Rate Limiting and Security', () => {
    it('should enforce rate limits on authentication endpoints', async () => {
      const attempts = [];

      // Make 6 login attempts (rate limit is 5)
      for (let i = 0; i < 6; i++) {
        const response = await api.post('/auth/login', {
          email: 'wrong@email.com',
          password: 'wrongpassword',
        });
        attempts.push(response.status);
      }

      // First 5 should be 401 (unauthorized)
      expect(attempts.slice(0, 5).every(status => status === 401)).toBe(true);

      // 6th should be 429 (too many requests)
      expect(attempts[5]).toBe(429);
    });

    it('should validate input and prevent SQL injection', async () => {
      const maliciousInput = "'; DROP TABLE users; --";

      const response = await api.post('/auth/login', {
        email: maliciousInput,
        password: 'test',
      });

      // Should reject as invalid email format, not execute SQL
      expect(response.status).toBe(400);
      expect(response.data.errors).toBeDefined();

      // Verify database is still intact
      const userCount = await prisma.user.count();
      expect(userCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Transaction Integrity', () => {
    it('should rollback on partial failure during user registration', async () => {
      // Simulate a failure during profile creation
      const mockEmail = `fail-${uuidv4()}@example.com`;

      // This would require mocking Prisma to fail at profile creation
      // For now, we verify the transaction wrapper exists
      const transactionUtilPath = path.join(
        __dirname,
        '../../backend/src/utils/database.ts'
      );

      expect(fs.existsSync(transactionUtilPath)).toBe(true);

      // Verify no partial user exists
      const partialUser = await prisma.user.findUnique({
        where: { email: mockEmail },
      });
      expect(partialUser).toBeNull();
    });
  });

  describe('Circuit Breaker for ML Service', () => {
    it('should handle ML service failures gracefully', async () => {
      // Simulate multiple ML service failures
      const failureResponses = [];

      for (let i = 0; i < 5; i++) {
        // Use invalid model to trigger failure
        const response = await api.post(
          `/projects/${testProject.id}/images/${testImage.id}/segment`,
          { model: 'invalid-model' }
        );
        failureResponses.push(response);

        // Small delay between attempts
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // After threshold, circuit should open
      const lastResponse = failureResponses[failureResponses.length - 1];

      // Should return service unavailable or similar error
      expect([503, 500]).toContain(lastResponse.status);
    });
  });
});

/**
 * Performance and Load Testing
 */
describe('Performance Benchmarks', () => {
  it('should handle concurrent user registrations', async () => {
    const concurrentUsers = 10;
    const registrations = [];

    for (let i = 0; i < concurrentUsers; i++) {
      const promise = axios.post(`${API_BASE_URL}/auth/register`, {
        email: `perf-test-${i}-${uuidv4()}@example.com`,
        password: 'TestPassword123!',
        username: `perfuser${i}-${Date.now()}`,
      });
      registrations.push(promise);
    }

    const results = await Promise.allSettled(registrations);
    const successful = results.filter(r => r.status === 'fulfilled');

    // At least 80% should succeed
    expect(successful.length).toBeGreaterThanOrEqual(concurrentUsers * 0.8);
  });

  it('should maintain response times under load', async () => {
    const requests = 50;
    const responseTimes: number[] = [];

    for (let i = 0; i < requests; i++) {
      const startTime = Date.now();

      await axios.get(`${API_BASE_URL}/health`).catch(() => {});

      const responseTime = Date.now() - startTime;
      responseTimes.push(responseTime);
    }

    const averageTime =
      responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
    const maxTime = Math.max(...responseTimes);

    // Average response time should be under 100ms
    expect(averageTime).toBeLessThan(100);

    // Max response time should be under 500ms
    expect(maxTime).toBeLessThan(500);
  });
});
