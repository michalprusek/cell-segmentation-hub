/**
 * Test Data Manager for consistent test data creation and cleanup
 * Handles parallel test execution with unique data generation
 */

export interface TestUser {
  email: string;
  password: string;
  name?: string;
}

export interface TestProject {
  name: string;
  description: string;
  id?: string;
}

export interface TestImage {
  name: string;
  path: string;
  size?: number;
  type?: string;
}

export class TestDataManager {
  private static instance: TestDataManager;
  private users: Map<string, TestUser> = new Map();
  private projects: Map<string, TestProject> = new Map();
  private images: Map<string, TestImage> = new Map();
  private cleanup: Array<() => Promise<void>> = [];

  static getInstance(): TestDataManager {
    if (!TestDataManager.instance) {
      TestDataManager.instance = new TestDataManager();
    }
    return TestDataManager.instance;
  }

  /**
   * Generate unique test user
   */
  generateUser(prefix = 'test'): TestUser {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(7);
    const user: TestUser = {
      email: `${prefix}-${timestamp}-${random}@example.com`,
      password: 'TestPassword123!',
      name: `Test User ${timestamp}`,
    };

    const userId = `${prefix}-${timestamp}-${random}`;
    this.users.set(userId, user);

    // Add cleanup function
    this.cleanup.push(async () => {
      // In a real implementation, this would call API to delete user
      this.users.delete(userId);
    });

    return user;
  }

  /**
   * Generate unique test project
   */
  generateProject(prefix = 'project'): TestProject {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(7);
    const project: TestProject = {
      name: `${prefix.charAt(0).toUpperCase() + prefix.slice(1)} ${timestamp}`,
      description: `Test project created at ${new Date().toISOString()}`,
    };

    const projectId = `${prefix}-${timestamp}-${random}`;
    this.projects.set(projectId, project);

    // Add cleanup function
    this.cleanup.push(async () => {
      this.projects.delete(projectId);
    });

    return project;
  }

  /**
   * Generate test image data
   */
  generateImage(name?: string): TestImage {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(7);
    const imageName = name || `test-image-${timestamp}-${random}.jpg`;

    const image: TestImage = {
      name: imageName,
      path: `/tests/fixtures/${imageName}`,
      size: 1024 * 1024, // 1MB default
      type: 'image/jpeg',
    };

    this.images.set(imageName, image);
    return image;
  }

  /**
   * Generate multiple test images
   */
  generateImages(count: number, prefix = 'test-image'): TestImage[] {
    const images: TestImage[] = [];
    for (let i = 0; i < count; i++) {
      images.push(this.generateImage(`${prefix}-${i + 1}.jpg`));
    }
    return images;
  }

  /**
   * Get user by pattern
   */
  getUser(pattern: string): TestUser | undefined {
    for (const [key, user] of this.users) {
      if (key.includes(pattern) || user.email.includes(pattern)) {
        return user;
      }
    }
    return undefined;
  }

  /**
   * Get project by pattern
   */
  getProject(pattern: string): TestProject | undefined {
    for (const [key, project] of this.projects) {
      if (key.includes(pattern) || project.name.includes(pattern)) {
        return project;
      }
    }
    return undefined;
  }

  /**
   * Generate test data for specific scenarios
   */
  generateScenarioData(scenario: string): {
    user: TestUser;
    projects: TestProject[];
    images: TestImage[];
  } {
    const user = this.generateUser(scenario);

    const scenarioConfig = {
      'bulk-upload': {
        projects: 1,
        images: 10,
      },
      performance: {
        projects: 3,
        images: 50,
      },
      collaboration: {
        projects: 2,
        images: 5,
      },
      'error-recovery': {
        projects: 1,
        images: 3,
      },
      accessibility: {
        projects: 1,
        images: 2,
      },
      default: {
        projects: 1,
        images: 1,
      },
    };

    const config =
      scenarioConfig[scenario as keyof typeof scenarioConfig] ||
      scenarioConfig.default;

    const projects = Array.from({ length: config.projects }, (_, i) =>
      this.generateProject(`${scenario}-project-${i + 1}`)
    );

    const images = this.generateImages(config.images, `${scenario}-image`);

    return { user, projects, images };
  }

  /**
   * Create test fixtures with realistic data
   */
  createRealisticFixtures(): {
    users: TestUser[];
    projects: TestProject[];
    images: TestImage[];
  } {
    const users = [
      this.generateUser('researcher'),
      this.generateUser('student'),
      this.generateUser('admin'),
    ];

    const projects = [
      {
        ...this.generateProject('cell-analysis'),
        description:
          'Microscopy analysis of HeLa cells under different conditions',
      },
      {
        ...this.generateProject('tissue-segmentation'),
        description: 'Histological tissue segmentation for cancer research',
      },
      {
        ...this.generateProject('bacteria-detection'),
        description: 'Automated bacterial colony counting and classification',
      },
    ];

    const images = [
      { ...this.generateImage('hela-cells-001.tiff'), type: 'image/tiff' },
      { ...this.generateImage('tissue-sample-h&e.jpg'), type: 'image/jpeg' },
      { ...this.generateImage('bacteria-petri-dish.png'), type: 'image/png' },
      { ...this.generateImage('fluorescent-cells.tiff'), type: 'image/tiff' },
      { ...this.generateImage('blood-smear.jpg'), type: 'image/jpeg' },
    ];

    return { users, projects, images };
  }

  /**
   * Generate data for parallel test execution
   */
  generateParallelTestData(
    testName: string,
    workerIndex: number
  ): {
    user: TestUser;
    project: TestProject;
    images: TestImage[];
  } {
    const worker = `worker-${workerIndex}`;
    const timestamp = Date.now();

    const user = this.generateUser(`${testName}-${worker}`);
    const project = {
      ...this.generateProject(`${testName}-${worker}`),
      name: `${testName} Project Worker ${workerIndex} - ${timestamp}`,
    };
    const images = this.generateImages(3, `${testName}-${worker}`);

    return { user, project, images };
  }

  /**
   * Create test data with specific constraints
   */
  generateConstrainedData(constraints: {
    userCount?: number;
    projectCount?: number;
    imageCount?: number;
    imageSize?: 'small' | 'medium' | 'large';
    imageFormats?: string[];
  }) {
    const {
      userCount = 1,
      projectCount = 1,
      imageCount = 1,
      imageSize = 'medium',
      imageFormats = ['jpg'],
    } = constraints;

    const users = Array.from({ length: userCount }, () => this.generateUser());
    const projects = Array.from({ length: projectCount }, () =>
      this.generateProject()
    );

    const sizeMap = {
      small: 100 * 1024, // 100KB
      medium: 1024 * 1024, // 1MB
      large: 10 * 1024 * 1024, // 10MB
    };

    const images = Array.from({ length: imageCount }, (_, i) => {
      const format = imageFormats[i % imageFormats.length];
      const image = this.generateImage(`test-image-${i + 1}.${format}`);
      image.size = sizeMap[imageSize];
      image.type = `image/${format}`;
      return image;
    });

    return { users, projects, images };
  }

  /**
   * Generate error test cases
   */
  generateErrorTestCases(): {
    corruptedFiles: TestImage[];
    oversizedFiles: TestImage[];
    unsupportedFormats: TestImage[];
    invalidUsers: TestUser[];
  } {
    const corruptedFiles = [
      { ...this.generateImage('corrupted.jpg'), size: 0 },
      { ...this.generateImage('invalid-header.png'), size: 10 },
    ];

    const oversizedFiles = [
      { ...this.generateImage('huge-file.tiff'), size: 100 * 1024 * 1024 }, // 100MB
      { ...this.generateImage('massive-image.png'), size: 250 * 1024 * 1024 }, // 250MB
    ];

    const unsupportedFormats = [
      { ...this.generateImage('document.pdf'), type: 'application/pdf' },
      { ...this.generateImage('archive.zip'), type: 'application/zip' },
      { ...this.generateImage('video.mp4'), type: 'video/mp4' },
    ];

    const invalidUsers = [
      { email: 'invalid-email', password: 'weak' },
      { email: '', password: '' },
      { email: 'test@', password: '123' },
    ];

    return { corruptedFiles, oversizedFiles, unsupportedFormats, invalidUsers };
  }

  /**
   * Generate performance test data
   */
  generatePerformanceTestData(): {
    bulkUsers: TestUser[];
    largeProjects: TestProject[];
    manyImages: TestImage[];
    complexPolygons: any[];
  } {
    const bulkUsers = Array.from({ length: 50 }, (_, i) =>
      this.generateUser(`perf-user-${i}`)
    );

    const largeProjects = Array.from({ length: 20 }, (_, i) => ({
      ...this.generateProject(`large-project-${i}`),
      description: `Performance test project ${i} with extensive metadata and long descriptions that test the limits of the UI rendering capabilities and database query performance. This project contains multiple datasets and complex analysis workflows that need to be processed efficiently.`,
    }));

    const manyImages = this.generateImages(1000, 'perf-image');

    const complexPolygons = Array.from({ length: 100 }, (_, i) => ({
      id: `polygon-${i}`,
      vertices: Array.from(
        { length: 50 + Math.floor(Math.random() * 200) },
        () => ({
          x: Math.random() * 2000,
          y: Math.random() * 2000,
        })
      ),
      properties: {
        area: Math.random() * 10000,
        perimeter: Math.random() * 1000,
        category: `category-${Math.floor(Math.random() * 5)}`,
      },
    }));

    return { bulkUsers, largeProjects, manyImages, complexPolygons };
  }

  /**
   * Get all registered test data
   */
  getAllTestData(): {
    users: TestUser[];
    projects: TestProject[];
    images: TestImage[];
  } {
    return {
      users: Array.from(this.users.values()),
      projects: Array.from(this.projects.values()),
      images: Array.from(this.images.values()),
    };
  }

  /**
   * Clean up all test data
   */
  async cleanup(): Promise<void> {
    // Cleaning up test data items

    const cleanupErrors: Error[] = [];

    for (const cleanupFn of this.cleanup) {
      try {
        await cleanupFn();
      } catch (_error) {
        // console.warn('Cleanup error:', _error);
        cleanupErrors.push(
          _error instanceof Error ? _error : new Error(String(_error))
        );
      }
    }

    this.users.clear();
    this.projects.clear();
    this.images.clear();
    this.cleanup.length = 0;

    // Test data cleanup completed

    // Throw aggregate error if any cleanup operations failed
    if (cleanupErrors.length > 0) {
      const aggregateError = new Error(
        `${cleanupErrors.length} cleanup operations failed: ${cleanupErrors.map(e => e.message).join(', ')}`
      );
      aggregateError.name = 'AggregateCleanupError';
      throw aggregateError;
    }
  }

  /**
   * Export test data for debugging
   */
  exportTestData(): string {
    return JSON.stringify(
      {
        users: Array.from(this.users.entries()),
        projects: Array.from(this.projects.entries()),
        images: Array.from(this.images.entries()),
        timestamp: new Date().toISOString(),
      },
      null,
      2
    );
  }

  /**
   * Import test data from export
   */
  importTestData(data: string): void {
    try {
      const parsed = JSON.parse(data);

      for (const [key, user] of parsed.users) {
        this.users.set(key, user);
      }

      for (const [key, project] of parsed.projects) {
        this.projects.set(key, project);
      }

      for (const [key, image] of parsed.images) {
        this.images.set(key, image);
      }

      // Test data imported successfully
    } catch (_error) {
      // console.error('Failed to import test data:', _error);
    }
  }
}

// Global instance for easy access
export const testDataManager = TestDataManager.getInstance();
