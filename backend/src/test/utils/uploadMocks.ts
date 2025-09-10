import { vi } from 'vitest';

/**
 * Mock file data generator for upload testing
 */
export class UploadMockGenerator {
  /**
   * Generate a mock image file buffer with specified size
   */
  static createMockImageBuffer(size: number = 1024, format: 'JPEG' | 'PNG' | 'TIFF' = 'JPEG'): Buffer {
    const buffer = Buffer.alloc(size);
    
    // Add basic file headers to make it look like a real image
    switch (format) {
      case 'JPEG':
        // JPEG header: FF D8 FF
        buffer[0] = 0xFF;
        buffer[1] = 0xD8;
        buffer[2] = 0xFF;
        buffer[3] = 0xE0;
        break;
      case 'PNG':
        // PNG header: 89 50 4E 47 0D 0A 1A 0A
        buffer[0] = 0x89;
        buffer[1] = 0x50;
        buffer[2] = 0x4E;
        buffer[3] = 0x47;
        buffer[4] = 0x0D;
        buffer[5] = 0x0A;
        buffer[6] = 0x1A;
        buffer[7] = 0x0A;
        break;
      case 'TIFF':
        // TIFF header: 49 49 2A 00 (little-endian)
        buffer[0] = 0x49;
        buffer[1] = 0x49;
        buffer[2] = 0x2A;
        buffer[3] = 0x00;
        break;
    }
    
    // Fill rest with random data
    for (let i = 8; i < size; i++) {
      buffer[i] = Math.floor(Math.random() * 256);
    }
    
    return buffer;
  }

  /**
   * Create mock Multer file objects
   */
  static createMockFiles(
    count: number,
    options: {
      fileSize?: number;
      mimeType?: string;
      extension?: string;
      namePrefix?: string;
    } = {}
  ): Express.Multer.File[] {
    const {
      fileSize = 1024 * 100, // 100KB default
      mimeType = 'image/jpeg',
      extension = 'jpg',
      namePrefix = 'test-image'
    } = options;

    return Array.from({ length: count }, (_, i) => ({
      fieldname: 'images',
      originalname: `${namePrefix}-${i + 1}.${extension}`,
      encoding: '7bit',
      mimetype: mimeType,
      buffer: this.createMockImageBuffer(fileSize, this.getMimeTypeFormat(mimeType)),
      size: fileSize,
      stream: {} as any,
      destination: '',
      filename: '',
      path: '',
    }));
  }

  /**
   * Create mock FormData for testing
   */
  static createMockFormData(files: Express.Multer.File[]): FormData {
    const formData = new FormData();
    
    files.forEach(file => {
      const blob = new Blob([file.buffer], { type: file.mimetype });
      formData.append('images', blob, file.originalname);
    });
    
    return formData;
  }

  /**
   * Create mock files with various sizes for stress testing
   */
  static createVariedSizeFiles(count: number): Express.Multer.File[] {
    const sizes = [
      1024 * 10,    // 10KB
      1024 * 100,   // 100KB
      1024 * 500,   // 500KB
      1024 * 1024,  // 1MB
      1024 * 1024 * 2, // 2MB
      1024 * 1024 * 5, // 5MB
    ];

    return Array.from({ length: count }, (_, i) => {
      const size = sizes[i % sizes.length];
      const format = i % 3 === 0 ? 'PNG' : i % 3 === 1 ? 'JPEG' : 'TIFF';
      const ext = format.toLowerCase();
      const mimeType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;

      return {
        fieldname: 'images',
        originalname: `varied-image-${i + 1}.${ext}`,
        encoding: '7bit',
        mimetype: mimeType,
        buffer: this.createMockImageBuffer(size, format as any),
        size,
        stream: {} as any,
        destination: '',
        filename: '',
        path: '',
      };
    });
  }

  /**
   * Create invalid mock files for error testing
   */
  static createInvalidFiles(): Express.Multer.File[] {
    return [
      // File with no buffer
      {
        fieldname: 'images',
        originalname: 'no-buffer.jpg',
        encoding: '7bit',
        mimetype: 'image/jpeg',
        buffer: null as any,
        size: 0,
        stream: {} as any,
        destination: '',
        filename: '',
        path: '',
      },
      // File with invalid MIME type
      {
        fieldname: 'images',
        originalname: 'invalid-mime.jpg',
        encoding: '7bit',
        mimetype: 'text/plain',
        buffer: Buffer.from('not an image'),
        size: 13,
        stream: {} as any,
        destination: '',
        filename: '',
        path: '',
      },
      // Oversized file
      {
        fieldname: 'images',
        originalname: 'oversized.jpg',
        encoding: '7bit',
        mimetype: 'image/jpeg',
        buffer: this.createMockImageBuffer(50 * 1024 * 1024), // 50MB
        size: 50 * 1024 * 1024,
        stream: {} as any,
        destination: '',
        filename: '',
        path: '',
      },
      // File with suspicious extension
      {
        fieldname: 'images',
        originalname: 'malicious.jpg.exe',
        encoding: '7bit',
        mimetype: 'image/jpeg',
        buffer: this.createMockImageBuffer(1024),
        size: 1024,
        stream: {} as any,
        destination: '',
        filename: '',
        path: '',
      },
    ];
  }

  /**
   * Create performance test files for large batch uploads
   */
  static createPerformanceTestFiles(count: number): Express.Multer.File[] {
    return this.createMockFiles(count, {
      fileSize: 1024 * 512, // 512KB each - reasonable size for testing
      namePrefix: 'perf-test'
    });
  }

  /**
   * Mock WebSocket connection for progress tracking
   */
  static createMockWebSocket() {
    const mockSocket = {
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      join: vi.fn(),
      leave: vi.fn(),
      to: vi.fn().mockReturnThis(),
      connected: true,
      id: 'mock-socket-id',
    };

    const mockIo = {
      to: vi.fn().mockReturnValue({
        emit: vi.fn(),
      }),
      emit: vi.fn(),
    };

    return { mockSocket, mockIo };
  }

  /**
   * Create mock progress callback for testing
   */
  static createMockProgressCallback() {
    const progressEvents: number[] = [];
    const callback = vi.fn((progress: number) => {
      progressEvents.push(progress);
    });

    return { callback, progressEvents };
  }

  /**
   * Simulate network delays for testing timeout scenarios
   */
  static async simulateNetworkDelay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Create mock database responses for batch operations
   */
  static createMockDatabaseResponses(imageCount: number) {
    const mockImages = Array.from({ length: imageCount }, (_, i) => ({
      id: `image-${i + 1}`,
      name: `test-image-${i + 1}.jpg`,
      projectId: 'project-123',
      userId: 'user-123',
      originalPath: `/uploads/test-image-${i + 1}.jpg`,
      thumbnailPath: `/uploads/thumbnails/test-image-${i + 1}_thumb.jpg`,
      fileSize: 1024 * 100,
      width: 800,
      height: 600,
      mimeType: 'image/jpeg',
      segmentationStatus: 'pending' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    return {
      createManyResponse: {
        count: imageCount,
      },
      findManyResponse: mockImages,
      uploadResponse: mockImages,
    };
  }

  /**
   * Create memory usage tracking utilities
   */
  static createMemoryTracker() {
    const initialMemory = process.memoryUsage();
    
    return {
      getInitialMemory: () => initialMemory,
      getCurrentMemoryUsage: () => process.memoryUsage(),
      getMemoryIncrease: () => {
        const current = process.memoryUsage();
        return {
          heapUsed: current.heapUsed - initialMemory.heapUsed,
          heapTotal: current.heapTotal - initialMemory.heapTotal,
          rss: current.rss - initialMemory.rss,
        };
      },
      assertMemoryWithinLimits: (maxHeapIncreaseMB: number = 100) => {
        const increase = process.memoryUsage().heapUsed - initialMemory.heapUsed;
        const increaseMB = increase / (1024 * 1024);
        
        if (increaseMB > maxHeapIncreaseMB) {
          throw new Error(`Memory increase (${increaseMB.toFixed(2)}MB) exceeds limit (${maxHeapIncreaseMB}MB)`);
        }
        
        return true;
      },
    };
  }

  /**
   * Helper to get format from MIME type
   */
  private static getMimeTypeFormat(mimeType: string): 'JPEG' | 'PNG' | 'TIFF' {
    if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'JPEG';
    if (mimeType.includes('png')) return 'PNG';
    if (mimeType.includes('tiff') || mimeType.includes('tif')) return 'TIFF';
    return 'JPEG'; // default
  }
}

/**
 * Mock rate limiter for testing concurrent uploads
 */
export class MockRateLimiter {
  private requests: Array<{ timestamp: number; ip: string }> = [];
  
  constructor(
    private maxRequests: number = 100,
    private windowMs: number = 60 * 1000 // 1 minute
  ) {}

  isAllowed(ip: string = 'test-ip'): boolean {
    const now = Date.now();
    
    // Clean old requests
    this.requests = this.requests.filter(
      req => now - req.timestamp < this.windowMs
    );

    // Count requests from this IP
    const ipRequests = this.requests.filter(req => req.ip === ip);
    
    if (ipRequests.length >= this.maxRequests) {
      return false;
    }

    // Add this request
    this.requests.push({ timestamp: now, ip });
    return true;
  }

  reset(): void {
    this.requests = [];
  }

  getRequestCount(ip: string = 'test-ip'): number {
    const now = Date.now();
    return this.requests
      .filter(req => req.ip === ip && now - req.timestamp < this.windowMs)
      .length;
  }
}

/**
 * Performance metrics collector for testing
 */
export class PerformanceMetrics {
  private startTime: number;
  private endTime?: number;
  private memoryStart: NodeJS.MemoryUsage;
  private memoryEnd?: NodeJS.MemoryUsage;

  constructor() {
    this.startTime = Date.now();
    this.memoryStart = process.memoryUsage();
  }

  end(): void {
    this.endTime = Date.now();
    this.memoryEnd = process.memoryUsage();
  }

  getDuration(): number {
    if (!this.endTime) this.end();
    return this.endTime! - this.startTime;
  }

  getMemoryUsage(): { initial: NodeJS.MemoryUsage; final: NodeJS.MemoryUsage; increase: NodeJS.MemoryUsage } {
    if (!this.memoryEnd) this.end();
    
    return {
      initial: this.memoryStart,
      final: this.memoryEnd!,
      increase: {
        rss: this.memoryEnd!.rss - this.memoryStart.rss,
        heapTotal: this.memoryEnd!.heapTotal - this.memoryStart.heapTotal,
        heapUsed: this.memoryEnd!.heapUsed - this.memoryStart.heapUsed,
        external: this.memoryEnd!.external - this.memoryStart.external,
        arrayBuffers: this.memoryEnd!.arrayBuffers - this.memoryStart.arrayBuffers,
      },
    };
  }

  getMetrics() {
    return {
      duration: this.getDuration(),
      memory: this.getMemoryUsage(),
    };
  }

  static async measureAsync<T>(fn: () => Promise<T>): Promise<{ result: T; metrics: ReturnType<PerformanceMetrics['getMetrics']> }> {
    const metrics = new PerformanceMetrics();
    const result = await fn();
    metrics.end();
    
    return {
      result,
      metrics: metrics.getMetrics(),
    };
  }
}