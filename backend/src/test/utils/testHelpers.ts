import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Express } from 'express';
import request from 'supertest';

/**
 * Test data creation and cleanup utilities
 */

export interface TestUser {
  id: string;
  email: string;
  name: string;
}

export interface TestProject {
  id: string;
  name: string;
  userId: string;
}

export interface TestImage {
  id: string;
  name: string;
  projectId: string;
  url: string;
  segmentationStatus: string;
}

/**
 * Creates a test user with authentication token
 */
export async function createTestUser(
  app: Express,
  email: string = 'test@example.com',
  name: string = 'Test User'
): Promise<{ user: TestUser; token: string }> {
  const hashedPassword = await bcrypt.hash('testpassword', 10);

  // Create user via API endpoint
  const response = await request(app)
    .post('/api/auth/register')
    .send({
      email,
      name,
      password: 'testpassword'
    });

  if (response.status !== 201) {
    throw new Error(`Failed to create test user: ${response.body.message}`);
  }

  const user = response.body.data.user;
  const token = response.body.data.token;

  return { user, token };
}

/**
 * Creates a test project
 */
export async function createTestProject(
  prisma: PrismaClient,
  userId: string,
  name: string = 'Test Project'
): Promise<TestProject> {
  const project = await prisma.project.create({
    data: {
      title: name,  // Changed from 'name' to 'title' to match schema
      userId,
      description: 'Test project for integration tests'
    }
  });

  return {
    id: project.id,
    name: project.title,  // Changed to match schema
    userId: project.userId
  };
}

/**
 * Creates a test image
 */
export async function createTestImage(
  prisma: PrismaClient,
  projectId: string,
  name: string = 'test-image.jpg'
): Promise<TestImage> {
  const image = await prisma.image.create({
    data: {
      name,
      projectId,
      originalPath: `/uploads/${name}`,  // Changed from 'url' to match schema
      thumbnailPath: `/thumbnails/${name}`,  // Changed from 'thumbnail_url' to match schema
      mimeType: 'image/jpeg',
      fileSize: 1024000,
      segmentationStatus: 'no_segmentation',
      width: 1024,
      height: 768
    }
  });

  return {
    id: image.id,
    name: image.name,
    projectId: image.projectId,
    url: image.originalPath,  // Changed to match schema
    segmentationStatus: image.segmentationStatus
  };
}

/**
 * Creates multiple test queue items
 */
export async function createTestQueueItems(
  prisma: PrismaClient,
  imageIds: string[],
  projectId: string,
  userId: string,
  options: {
    model?: string;
    threshold?: number;
    status?: string;
    batchId?: string;
  } = {}
): Promise<any[]> {
  const {
    model = 'hrnet',
    threshold = 0.5,
    status = 'queued',
    batchId = null
  } = options;

  const queueItems = await Promise.all(
    imageIds.map(imageId =>
      prisma.segmentationQueue.create({
        data: {
          imageId,
          projectId,
          userId,
          model,
          threshold,
          detectHoles: true,
          priority: 0,
          status,
          batchId,
          // createdAt and updatedAt are auto-generated
        }
      })
    )
  );

  return queueItems;
}

/**
 * Cleans up all test data
 */
export async function cleanupTestData(prisma: PrismaClient): Promise<void> {
  // Delete in correct order to avoid foreign key constraints
  await prisma.segmentationQueue.deleteMany({});
  await prisma.segmentation.deleteMany({});
  await prisma.image.deleteMany({});
  await prisma.project.deleteMany({});
  await prisma.user.deleteMany({});
}

/**
 * Creates a JWT token for testing
 */
export function createTestJWT(userId: string, email: string): string {
  return jwt.sign(
    { id: userId, email },
    process.env.JWT_SECRET || 'test-secret',
    { expiresIn: '1h' }
  );
}

/**
 * Waits for a specific condition to be true
 */
export async function waitForCondition(
  condition: () => boolean | Promise<boolean>,
  timeout: number = 5000,
  interval: number = 100
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }

  throw new Error(`Condition not met within ${timeout}ms`);
}

/**
 * Generates test data for performance testing
 */
export async function generateBulkTestData(
  prisma: PrismaClient,
  userId: string,
  projectCount: number = 1,
  imagesPerProject: number = 100
): Promise<{ projects: TestProject[]; images: TestImage[] }> {
  const projects: TestProject[] = [];
  const images: TestImage[] = [];

  for (let p = 0; p < projectCount; p++) {
    const project = await createTestProject(prisma, userId, `Bulk Test Project ${p + 1}`);
    projects.push(project);

    for (let i = 0; i < imagesPerProject; i++) {
      const image = await createTestImage(prisma, project.id, `bulk-image-${p}-${i}.jpg`);
      images.push(image);
    }
  }

  return { projects, images };
}

/**
 * Simulates WebSocket events for testing
 */
export class MockWebSocketEvents {
  private events: any[] = [];

  emit(event: string, data: any): void {
    this.events.push({ event, data, timestamp: new Date() });
  }

  getEvents(eventType?: string): any[] {
    if (eventType) {
      return this.events.filter(e => e.event === eventType);
    }
    return this.events;
  }

  clear(): void {
    this.events = [];
  }

  waitForEvent(eventType: string, timeout: number = 5000): Promise<any> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      const checkForEvent = () => {
        const event = this.events.find(e => e.event === eventType);
        if (event) {
          resolve(event);
          return;
        }

        if (Date.now() - startTime > timeout) {
          reject(new Error(`Event ${eventType} not received within ${timeout}ms`));
          return;
        }

        setTimeout(checkForEvent, 50);
      };

      checkForEvent();
    });
  }
}

/**
 * Database state verification utilities
 */
export class DatabaseStateVerifier {
  constructor(private prisma: PrismaClient) {}

  async verifyQueueItemCount(projectId: string, expectedCount: number): Promise<void> {
    const count = await this.prisma.segmentationQueue.count({
      where: { projectId }
    });

    if (count !== expectedCount) {
      throw new Error(`Expected ${expectedCount} queue items, found ${count}`);
    }
  }

  async verifyImageStatus(imageId: string, expectedStatus: string): Promise<void> {
    const image = await this.prisma.image.findUnique({
      where: { id: imageId }
    });

    if (!image) {
      throw new Error(`Image ${imageId} not found`);
    }

    if (image.segmentationStatus !== expectedStatus) {
      throw new Error(
        `Expected image status ${expectedStatus}, found ${image.segmentationStatus}`
      );
    }
  }

  async verifyQueueItemStatus(queueId: string, expectedStatus: string | null): Promise<void> {
    const queueItem = await this.prisma.segmentationQueue.findUnique({
      where: { id: queueId }
    });

    if (expectedStatus === null) {
      if (queueItem !== null) {
        throw new Error(`Expected queue item ${queueId} to be deleted, but it still exists`);
      }
    } else {
      if (!queueItem) {
        throw new Error(`Queue item ${queueId} not found`);
      }

      if (queueItem.status !== expectedStatus) {
        throw new Error(
          `Expected queue item status ${expectedStatus}, found ${queueItem.status}`
        );
      }
    }
  }

  async getAllQueueItems(projectId?: string): Promise<any[]> {
    const where = projectId ? { projectId } : {};
    return await this.prisma.segmentationQueue.findMany({ where });
  }

  async getAllImages(projectId?: string): Promise<any[]> {
    const where = projectId ? { projectId } : {};
    return await this.prisma.image.findMany({ where });
  }
}