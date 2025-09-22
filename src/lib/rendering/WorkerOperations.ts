/**
 * Type-safe worker operations for polygon processing
 * Provides easy-to-use interfaces for Web Worker operations
 */

import { Point } from '@/lib/segmentation';
import { WorkerOperation, WorkerPool } from '@/lib/workerPool';

// Operation interfaces
export interface SimplifyRequest {
  points: Point[];
  tolerance: number;
  preserveTopology?: boolean;
}

export interface IntersectionRequest {
  polygon1: Point[];
  polygon2: Point[];
}

export interface SliceRequest {
  polygon: Point[];
  lineStart: Point;
  lineEnd: Point;
}

export interface AreaCalculationRequest {
  points: Point[];
}

export interface ConvexHullRequest {
  points: Point[];
}

export interface BufferRequest {
  points: Point[];
  distance: number;
  segments?: number;
}

export interface PointInPolygonRequest {
  point: Point;
  polygon: Point[];
}

// Response types
export interface AreaCalculationResponse {
  area: number;
  perimeter: number;
}

/**
 * Polygon simplification operation
 */
export class SimplifyPolygonOperation extends WorkerOperation<
  SimplifyRequest,
  Point[]
> {
  readonly type = 'simplify';

  async execute(input: SimplifyRequest): Promise<Point[]> {
    // This will be handled by the worker - this method is not called directly
    throw new Error('This method should not be called directly');
  }
}

/**
 * Polygon intersection operation
 */
export class PolygonIntersectionOperation extends WorkerOperation<
  IntersectionRequest,
  Point[]
> {
  readonly type = 'intersections';

  async execute(input: IntersectionRequest): Promise<Point[]> {
    throw new Error('This method should not be called directly');
  }
}

/**
 * Polygon slicing operation
 */
export class SlicePolygonOperation extends WorkerOperation<
  SliceRequest,
  Point[][]
> {
  readonly type = 'slice';

  async execute(input: SliceRequest): Promise<Point[][]> {
    throw new Error('This method should not be called directly');
  }
}

/**
 * Area and perimeter calculation operation
 */
export class CalculateAreaOperation extends WorkerOperation<
  AreaCalculationRequest,
  AreaCalculationResponse
> {
  readonly type = 'area';

  async execute(
    input: AreaCalculationRequest
  ): Promise<AreaCalculationResponse> {
    throw new Error('This method should not be called directly');
  }
}

/**
 * Convex hull calculation operation
 */
export class ConvexHullOperation extends WorkerOperation<
  ConvexHullRequest,
  Point[]
> {
  readonly type = 'convexHull';

  async execute(input: ConvexHullRequest): Promise<Point[]> {
    throw new Error('This method should not be called directly');
  }
}

/**
 * Polygon buffer operation
 */
export class BufferPolygonOperation extends WorkerOperation<
  BufferRequest,
  Point[]
> {
  readonly type = 'buffer';

  async execute(input: BufferRequest): Promise<Point[]> {
    throw new Error('This method should not be called directly');
  }
}

/**
 * Point in polygon test operation
 */
export class PointInPolygonOperation extends WorkerOperation<
  PointInPolygonRequest,
  boolean
> {
  readonly type = 'pointInPolygon';

  async execute(input: PointInPolygonRequest): Promise<boolean> {
    throw new Error('This method should not be called directly');
  }
}

/**
 * High-level polygon processing service
 */
export class PolygonProcessingService {
  private workerPool: WorkerPool;
  private operations: {
    simplify: SimplifyPolygonOperation;
    intersections: PolygonIntersectionOperation;
    slice: SlicePolygonOperation;
    area: CalculateAreaOperation;
    convexHull: ConvexHullOperation;
    buffer: BufferPolygonOperation;
    pointInPolygon: PointInPolygonOperation;
  };

  constructor(workerPool: WorkerPool) {
    this.workerPool = workerPool;
    this.operations = {
      simplify: new SimplifyPolygonOperation(),
      intersections: new PolygonIntersectionOperation(),
      slice: new SlicePolygonOperation(),
      area: new CalculateAreaOperation(),
      convexHull: new ConvexHullOperation(),
      buffer: new BufferPolygonOperation(),
      pointInPolygon: new PointInPolygonOperation(),
    };
  }

  /**
   * Simplify polygon using Ramer-Douglas-Peucker algorithm
   */
  async simplifyPolygon(
    points: Point[],
    tolerance: number,
    preserveTopology: boolean = true
  ): Promise<Point[]> {
    return this.workerPool.execute(this.operations.simplify, {
      points,
      tolerance,
      preserveTopology,
    });
  }

  /**
   * Simplify multiple polygons in parallel
   */
  async simplifyPolygons(
    polygons: Array<{ points: Point[]; tolerance: number }>,
    preserveTopology: boolean = true
  ): Promise<Point[][]> {
    const requests = polygons.map(p => ({
      points: p.points,
      tolerance: p.tolerance,
      preserveTopology,
    }));

    return this.workerPool.executeParallel(this.operations.simplify, requests);
  }

  /**
   * Find intersection points between two polygons
   */
  async findIntersections(
    polygon1: Point[],
    polygon2: Point[]
  ): Promise<Point[]> {
    return this.workerPool.execute(this.operations.intersections, {
      polygon1,
      polygon2,
    });
  }

  /**
   * Slice polygon with a line
   */
  async slicePolygon(
    polygon: Point[],
    lineStart: Point,
    lineEnd: Point
  ): Promise<Point[][]> {
    return this.workerPool.execute(this.operations.slice, {
      polygon,
      lineStart,
      lineEnd,
    });
  }

  /**
   * Calculate polygon area and perimeter
   */
  async calculateArea(points: Point[]): Promise<AreaCalculationResponse> {
    return this.workerPool.execute(this.operations.area, { points });
  }

  /**
   * Calculate areas for multiple polygons
   */
  async calculateAreas(
    polygonsPoints: Point[][]
  ): Promise<AreaCalculationResponse[]> {
    const requests = polygonsPoints.map(points => ({ points }));
    return this.workerPool.executeParallel(this.operations.area, requests);
  }

  /**
   * Calculate convex hull
   */
  async calculateConvexHull(points: Point[]): Promise<Point[]> {
    return this.workerPool.execute(this.operations.convexHull, { points });
  }

  /**
   * Create buffer around polygon
   */
  async bufferPolygon(
    points: Point[],
    distance: number,
    segments: number = 8
  ): Promise<Point[]> {
    return this.workerPool.execute(this.operations.buffer, {
      points,
      distance,
      segments,
    });
  }

  /**
   * Test if point is inside polygon
   */
  async pointInPolygon(point: Point, polygon: Point[]): Promise<boolean> {
    return this.workerPool.execute(this.operations.pointInPolygon, {
      point,
      polygon,
    });
  }

  /**
   * Test multiple points against polygon
   */
  async pointsInPolygon(points: Point[], polygon: Point[]): Promise<boolean[]> {
    const requests = points.map(point => ({ point, polygon }));
    return this.workerPool.executeParallel(
      this.operations.pointInPolygon,
      requests
    );
  }

  /**
   * Batch process multiple operations efficiently
   */
  async batchProcess<T, R>(
    operation: WorkerOperation<T, R>,
    inputs: T[],
    batchSize: number = 10
  ): Promise<R[]> {
    return this.workerPool.executeBatched(operation, inputs, batchSize);
  }

  /**
   * Get worker pool statistics
   */
  getStats() {
    return this.workerPool.getStats();
  }

  /**
   * Warm up worker pool
   */
  async warmUp(workerCount?: number): Promise<void> {
    return this.workerPool.warmUp(workerCount);
  }

  /**
   * Terminate all workers
   */
  terminate(): void {
    this.workerPool.terminate();
  }
}

/**
 * Global polygon processing service instance
 */
let globalPolygonService: PolygonProcessingService | null = null;
let initializationPromise: Promise<PolygonProcessingService> | null = null;

/**
 * Get or create global polygon processing service (thread-safe)
 */
export function getPolygonProcessingService(): PolygonProcessingService {
  if (!globalPolygonService) {
    let workerPool: WorkerPool;

    try {
      workerPool = new WorkerPool('/workers/polygonWorker.js', {
        maxWorkers: Math.min(4, navigator.hardwareConcurrency || 2),
        idleTimeout: 30000,
        maxTasksPerWorker: 100,
      });

      globalPolygonService = new PolygonProcessingService(workerPool);
    } catch (error) {
      // Clean up any partially constructed worker pool
      if (workerPool && typeof workerPool.terminate === 'function') {
        workerPool.terminate();
      }
      throw error;
    }
  }

  return globalPolygonService;
}

/**
 * Initialize polygon processing service (race condition safe)
 */
export async function initializePolygonProcessing(): Promise<PolygonProcessingService> {
  // Prevent race conditions during initialization
  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = (async () => {
    const service = getPolygonProcessingService();
    await service.warmUp();
    return service;
  })();

  try {
    return await initializationPromise;
  } catch (error) {
    // Reset promise on failure to allow retry
    initializationPromise = null;
    throw error;
  }
}

/**
 * Cleanup polygon processing service
 */
export function cleanupPolygonProcessing(): void {
  if (globalPolygonService) {
    globalPolygonService.terminate();
    globalPolygonService = null;
  }

  // Reset initialization promise to allow clean re-initialization
  initializationPromise = null;
}
