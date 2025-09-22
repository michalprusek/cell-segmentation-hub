/**
 * Enhanced mock data factories for polygon testing
 * Provides consistent test data for polygon ID validation, React keys, and edge cases
 */

import type { Point, Polygon } from '@/lib/segmentation';

export interface PolygonTestScenario {
  name: string;
  description: string;
  polygons: Polygon[];
  expectedWarnings?: string[];
  expectedErrors?: string[];
  shouldRender?: boolean;
  performanceThreshold?: number;
}

/**
 * Factory for creating polygons with specific ID validation scenarios
 */
export class PolygonIdTestFactory {
  /**
   * Create a polygon with a valid ML-generated ID
   */
  static createMLPolygon(overrides: Partial<Polygon> = {}): Polygon {
    return {
      id: `ml_polygon_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      points: [
        { x: 10, y: 10 },
        { x: 50, y: 10 },
        { x: 50, y: 50 },
        { x: 10, y: 50 },
      ],
      type: 'external',
      confidence: 0.85 + Math.random() * 0.14, // 0.85-0.99
      class: 'cell',
      ...overrides,
    };
  }

  /**
   * Create a polygon with a valid user-created ID
   */
  static createUserPolygon(overrides: Partial<Polygon> = {}): Polygon {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 12);
    return {
      id: `polygon_${timestamp}_${random}`,
      points: [
        { x: 20, y: 20 },
        { x: 80, y: 20 },
        { x: 80, y: 80 },
        { x: 20, y: 80 },
      ],
      type: 'external',
      confidence: 1.0, // User-created, full confidence
      ...overrides,
    };
  }

  /**
   * Create a polygon with an undefined ID
   */
  static createUndefinedIdPolygon(overrides: Partial<Polygon> = {}): Polygon {
    return {
      id: undefined as any,
      points: [
        { x: 30, y: 30 },
        { x: 70, y: 30 },
        { x: 70, y: 70 },
        { x: 30, y: 70 },
      ],
      type: 'external',
      confidence: 0.75,
      ...overrides,
    };
  }

  /**
   * Create a polygon with an empty string ID
   */
  static createEmptyIdPolygon(overrides: Partial<Polygon> = {}): Polygon {
    return {
      id: '',
      points: [
        { x: 40, y: 40 },
        { x: 90, y: 40 },
        { x: 90, y: 90 },
        { x: 40, y: 90 },
      ],
      type: 'external',
      confidence: 0.65,
      ...overrides,
    };
  }

  /**
   * Create a polygon with whitespace-only ID
   */
  static createWhitespaceIdPolygon(overrides: Partial<Polygon> = {}): Polygon {
    return {
      id: '   \t\n   ',
      points: [
        { x: 50, y: 50 },
        { x: 100, y: 50 },
        { x: 100, y: 100 },
        { x: 50, y: 100 },
      ],
      type: 'external',
      confidence: 0.55,
      ...overrides,
    };
  }

  /**
   * Create a polygon with null ID
   */
  static createNullIdPolygon(overrides: Partial<Polygon> = {}): Polygon {
    return {
      id: null as any,
      points: [
        { x: 60, y: 60 },
        { x: 110, y: 60 },
        { x: 110, y: 110 },
        { x: 60, y: 110 },
      ],
      type: 'external',
      confidence: 0.45,
      ...overrides,
    };
  }

  /**
   * Create multiple polygons with mixed ID validity
   */
  static createMixedIdValidityPolygons(count: number = 10): Polygon[] {
    const polygons: Polygon[] = [];
    const factories = [
      this.createMLPolygon,
      this.createUserPolygon,
      this.createUndefinedIdPolygon,
      this.createEmptyIdPolygon,
      this.createWhitespaceIdPolygon,
      this.createNullIdPolygon,
    ];

    for (let i = 0; i < count; i++) {
      const factoryIndex = i % factories.length;
      const factory = factories[factoryIndex];
      const baseX = (i % 5) * 120;
      const baseY = Math.floor(i / 5) * 120;

      const polygon = factory({
        points: [
          { x: baseX + 10, y: baseY + 10 },
          { x: baseX + 50, y: baseY + 10 },
          { x: baseX + 50, y: baseY + 50 },
          { x: baseX + 10, y: baseY + 50 },
        ],
      });

      polygons.push(polygon);
    }

    return polygons;
  }
}

/**
 * Factory for creating polygons with various point data scenarios
 */
export class PolygonPointTestFactory {
  /**
   * Create a polygon with insufficient points (< 3)
   */
  static createInsufficientPointsPolygon(): Polygon {
    return {
      id: 'insufficient-points',
      points: [
        { x: 10, y: 10 },
        { x: 50, y: 10 },
      ],
      type: 'external',
    };
  }

  /**
   * Create a polygon with empty points array
   */
  static createEmptyPointsPolygon(): Polygon {
    return {
      id: 'empty-points',
      points: [],
      type: 'external',
    };
  }

  /**
   * Create a polygon with NaN coordinates
   */
  static createNaNPointsPolygon(): Polygon {
    return {
      id: 'nan-points',
      points: [
        { x: NaN, y: 10 },
        { x: 50, y: NaN },
        { x: 50, y: 50 },
        { x: 10, y: 50 },
      ],
      type: 'external',
    };
  }

  /**
   * Create a polygon with Infinity coordinates
   */
  static createInfinityPointsPolygon(): Polygon {
    return {
      id: 'infinity-points',
      points: [
        { x: Infinity, y: 10 },
        { x: 50, y: -Infinity },
        { x: 50, y: 50 },
        { x: 10, y: 50 },
      ],
      type: 'external',
    };
  }

  /**
   * Create a polygon with missing coordinate properties
   */
  static createMissingCoordsPolygon(): Polygon {
    return {
      id: 'missing-coords',
      points: [
        { x: 10, y: 10 },
        { x: 50 } as any, // Missing y
        { y: 50 } as any, // Missing x
        { x: 10, y: 50 },
      ],
      type: 'external',
    };
  }

  /**
   * Create a polygon with wrong coordinate types
   */
  static createWrongCoordTypesPolygon(): Polygon {
    return {
      id: 'wrong-coord-types',
      points: [
        { x: '10', y: 10 } as any, // String x
        { x: 50, y: true } as any, // Boolean y
        { x: null, y: 50 } as any, // Null x
        { x: 10, y: 50 },
      ],
      type: 'external',
    };
  }

  /**
   * Create a polygon with null/undefined points
   */
  static createNullPointsPolygon(): Polygon {
    return {
      id: 'null-points',
      points: [
        { x: 10, y: 10 },
        null as any,
        undefined as any,
        { x: 50, y: 50 },
        { x: 10, y: 50 },
      ],
      type: 'external',
    };
  }

  /**
   * Create a degenerate polygon (all points same)
   */
  static createDegeneratePolygon(): Polygon {
    return {
      id: 'degenerate',
      points: [
        { x: 50, y: 50 },
        { x: 50, y: 50 },
        { x: 50, y: 50 },
        { x: 50, y: 50 },
      ],
      type: 'external',
    };
  }

  /**
   * Create a polygon with extremely many points
   */
  static createManyPointsPolygon(pointCount: number = 1000): Polygon {
    const points: Point[] = [];
    const centerX = 400;
    const centerY = 300;
    const radius = 200;

    for (let i = 0; i < pointCount; i++) {
      const angle = (i / pointCount) * 2 * Math.PI;
      points.push({
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
      });
    }

    return {
      id: `many-points-${pointCount}`,
      points,
      type: 'external',
    };
  }

  /**
   * Create polygons with various point data issues
   */
  static createPointDataIssueSet(): Polygon[] {
    return [
      this.createInsufficientPointsPolygon(),
      this.createEmptyPointsPolygon(),
      this.createNaNPointsPolygon(),
      this.createInfinityPointsPolygon(),
      this.createMissingCoordsPolygon(),
      this.createWrongCoordTypesPolygon(),
      this.createNullPointsPolygon(),
      this.createDegeneratePolygon(),
    ];
  }
}

/**
 * Factory for creating complex shapes for testing geometry edge cases
 */
export class PolygonShapeTestFactory {
  /**
   * Create a self-intersecting polygon
   */
  static createSelfIntersectingPolygon(): Polygon {
    return {
      id: 'self-intersecting',
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
        { x: 100, y: 0 },
        { x: 0, y: 100 },
      ],
      type: 'external',
    };
  }

  /**
   * Create a very thin polygon
   */
  static createThinPolygon(): Polygon {
    return {
      id: 'thin-polygon',
      points: [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { x: 1000, y: 1 },
        { x: 0, y: 1 },
      ],
      type: 'external',
    };
  }

  /**
   * Create a polygon with extreme coordinates
   */
  static createExtremeCoordinatesPolygon(): Polygon {
    return {
      id: 'extreme-coordinates',
      points: [
        { x: Number.MAX_SAFE_INTEGER, y: Number.MAX_SAFE_INTEGER },
        { x: Number.MAX_SAFE_INTEGER - 1000, y: Number.MAX_SAFE_INTEGER },
        {
          x: Number.MAX_SAFE_INTEGER - 1000,
          y: Number.MAX_SAFE_INTEGER - 1000,
        },
        { x: Number.MAX_SAFE_INTEGER, y: Number.MAX_SAFE_INTEGER - 1000 },
      ],
      type: 'external',
    };
  }

  /**
   * Create a star-shaped polygon
   */
  static createStarPolygon(
    points: number = 5,
    outerRadius: number = 100,
    innerRadius: number = 50
  ): Polygon {
    const starPoints: Point[] = [];
    const centerX = 300;
    const centerY = 300;

    for (let i = 0; i < points * 2; i++) {
      const angle = (i / (points * 2)) * 2 * Math.PI;
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      starPoints.push({
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
      });
    }

    return {
      id: `star-${points}-${outerRadius}-${innerRadius}`,
      points: starPoints,
      type: 'external',
    };
  }

  /**
   * Create a polygon with a hole (internal polygon)
   */
  static createPolygonWithHole(): { external: Polygon; internal: Polygon } {
    const external: Polygon = {
      id: 'external-with-hole',
      points: [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        { x: 200, y: 200 },
        { x: 0, y: 200 },
      ],
      type: 'external',
    };

    const internal: Polygon = {
      id: 'internal-hole',
      points: [
        { x: 50, y: 50 },
        { x: 150, y: 50 },
        { x: 150, y: 150 },
        { x: 50, y: 150 },
      ],
      type: 'internal',
      parent_id: external.id,
    };

    return { external, internal };
  }
}

/**
 * Factory for creating performance test scenarios
 */
export class PolygonPerformanceTestFactory {
  /**
   * Create a large number of simple polygons for performance testing
   */
  static createManySimplePolygons(count: number): Polygon[] {
    const polygons: Polygon[] = [];

    for (let i = 0; i < count; i++) {
      const baseX = (i % 50) * 60;
      const baseY = Math.floor(i / 50) * 60;

      polygons.push({
        id: `perf-simple-${i}`,
        points: [
          { x: baseX, y: baseY },
          { x: baseX + 50, y: baseY },
          { x: baseX + 50, y: baseY + 50 },
          { x: baseX, y: baseY + 50 },
        ],
        type: 'external',
        confidence: Math.random(),
      });
    }

    return polygons;
  }

  /**
   * Create polygons with varying complexity
   */
  static createVariableComplexityPolygons(count: number): Polygon[] {
    const polygons: Polygon[] = [];

    for (let i = 0; i < count; i++) {
      const complexity = Math.floor(Math.random() * 100) + 3; // 3-102 points
      const points: Point[] = [];
      const centerX = (i % 10) * 120 + 60;
      const centerY = Math.floor(i / 10) * 120 + 60;
      const radius = 40;

      for (let j = 0; j < complexity; j++) {
        const angle = (j / complexity) * 2 * Math.PI;
        const r = radius + Math.random() * 20 - 10; // Slight variation
        points.push({
          x: centerX + Math.cos(angle) * r,
          y: centerY + Math.sin(angle) * r,
        });
      }

      polygons.push({
        id: `perf-complex-${i}-${complexity}pts`,
        points,
        type: 'external',
        confidence: Math.random(),
      });
    }

    return polygons;
  }

  /**
   * Create stress test scenario with mixed data quality
   */
  static createStressTestScenario(count: number): Polygon[] {
    const polygons: Polygon[] = [];
    const mixedFactories = [
      () => PolygonIdTestFactory.createMLPolygon(),
      () => PolygonIdTestFactory.createUndefinedIdPolygon(),
      () => PolygonPointTestFactory.createNaNPointsPolygon(),
      () => PolygonShapeTestFactory.createThinPolygon(),
      () =>
        PolygonPointTestFactory.createManyPointsPolygon(
          Math.floor(Math.random() * 500) + 100
        ),
    ];

    for (let i = 0; i < count; i++) {
      const factoryIndex = Math.floor(Math.random() * mixedFactories.length);
      const factory = mixedFactories[factoryIndex];

      try {
        const polygon = factory();
        // Modify position to avoid overlap
        if (polygon.points && polygon.points.length > 0) {
          const offsetX = (i % 20) * 100;
          const offsetY = Math.floor(i / 20) * 100;

          polygon.points = polygon.points.map(point => ({
            x: (point.x || 0) + offsetX,
            y: (point.y || 0) + offsetY,
          }));
        }

        polygons.push(polygon);
      } catch (_error) {
        // Even factory failures should be handled gracefully
        polygons.push(
          PolygonIdTestFactory.createMLPolygon({
            id: `fallback-${i}`,
            points: [
              { x: i * 20, y: 0 },
              { x: i * 20 + 15, y: 0 },
              { x: i * 20 + 15, y: 15 },
              { x: i * 20, y: 15 },
            ],
          })
        );
      }
    }

    return polygons;
  }
}

/**
 * Pre-defined test scenarios for common testing patterns
 */
export class PolygonTestScenarios {
  /**
   * React key validation scenario
   */
  static getReactKeyTestScenario(): PolygonTestScenario {
    return {
      name: 'React Key Validation',
      description: 'Tests React key generation with mixed ID validity',
      polygons: PolygonIdTestFactory.createMixedIdValidityPolygons(20),
      expectedWarnings: ['Invalid polygon ID', 'Empty polygon ID'],
      shouldRender: true,
      performanceThreshold: 200,
    };
  }

  /**
   * Point data validation scenario
   */
  static getPointDataTestScenario(): PolygonTestScenario {
    return {
      name: 'Point Data Validation',
      description: 'Tests handling of invalid point data',
      polygons: PolygonPointTestFactory.createPointDataIssueSet(),
      expectedWarnings: [
        'insufficient points',
        'Invalid coordinates',
        'Invalid point data',
        'degenerate polygon',
      ],
      shouldRender: true,
    };
  }

  /**
   * Performance stress test scenario
   */
  static getPerformanceStressScenario(): PolygonTestScenario {
    return {
      name: 'Performance Stress Test',
      description: 'Tests rendering performance with many complex polygons',
      polygons: PolygonPerformanceTestFactory.createStressTestScenario(100),
      shouldRender: true,
      performanceThreshold: 500,
    };
  }

  /**
   * Edge case scenario with extreme data
   */
  static getEdgeCaseScenario(): PolygonTestScenario {
    const polygons = [
      PolygonShapeTestFactory.createSelfIntersectingPolygon(),
      PolygonShapeTestFactory.createThinPolygon(),
      PolygonShapeTestFactory.createExtremeCoordinatesPolygon(),
      PolygonPointTestFactory.createManyPointsPolygon(5000),
      ...PolygonShapeTestFactory.createPolygonWithHole(),
    ];

    return {
      name: 'Edge Case Scenarios',
      description: 'Tests extreme polygon configurations',
      polygons,
      expectedWarnings: [
        'performance',
        'extreme coordinates',
        'complex geometry',
      ],
      shouldRender: true,
      performanceThreshold: 1000,
    };
  }

  /**
   * Get all predefined scenarios
   */
  static getAllScenarios(): PolygonTestScenario[] {
    return [
      this.getReactKeyTestScenario(),
      this.getPointDataTestScenario(),
      this.getPerformanceStressScenario(),
      this.getEdgeCaseScenario(),
    ];
  }
}

/**
 * Utility functions for test data manipulation
 */
export class PolygonTestUtils {
  /**
   * Create a polygon with specific ID pattern for testing
   */
  static createPolygonWithIdPattern(
    pattern: 'valid' | 'undefined' | 'empty' | 'whitespace' | 'null',
    index: number = 0
  ): Polygon {
    const basePolygon = {
      points: [
        { x: index * 100, y: 0 },
        { x: index * 100 + 80, y: 0 },
        { x: index * 100 + 80, y: 80 },
        { x: index * 100, y: 80 },
      ],
      type: 'external' as const,
      confidence: Math.random(),
    };

    switch (pattern) {
      case 'valid':
        return { ...basePolygon, id: `valid-polygon-${index}` };
      case 'undefined':
        return { ...basePolygon, id: undefined as any };
      case 'empty':
        return { ...basePolygon, id: '' };
      case 'whitespace':
        return { ...basePolygon, id: '   \t   ' };
      case 'null':
        return { ...basePolygon, id: null as any };
      default:
        return { ...basePolygon, id: `default-${index}` };
    }
  }

  /**
   * Validate that a polygon meets basic requirements
   */
  static validatePolygon(polygon: any): { isValid: boolean; issues: string[] } {
    const issues: string[] = [];

    if (!polygon) {
      issues.push('Polygon is null or undefined');
      return { isValid: false, issues };
    }

    if (
      !polygon.id ||
      typeof polygon.id !== 'string' ||
      polygon.id.trim() === ''
    ) {
      issues.push('Invalid or missing ID');
    }

    if (!polygon.points || !Array.isArray(polygon.points)) {
      issues.push('Invalid or missing points array');
    } else if (polygon.points.length < 3) {
      issues.push('Insufficient points for polygon');
    } else {
      polygon.points.forEach((point: any, index: number) => {
        if (
          !point ||
          typeof point.x !== 'number' ||
          typeof point.y !== 'number'
        ) {
          issues.push(`Invalid point at index ${index}`);
        } else if (isNaN(point.x) || isNaN(point.y)) {
          issues.push(`NaN coordinates at index ${index}`);
        }
      });
    }

    if (!polygon.type || !['external', 'internal'].includes(polygon.type)) {
      issues.push('Invalid or missing polygon type');
    }

    return {
      isValid: issues.length === 0,
      issues,
    };
  }

  /**
   * Generate a unique ID for test polygons
   */
  static generateUniqueId(prefix: string = 'test'): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    return `${prefix}_${timestamp}_${random}`;
  }

  /**
   * Create a grid of polygons for layout testing
   */
  static createPolygonGrid(
    rows: number,
    cols: number,
    cellSize: number = 60,
    spacing: number = 10
  ): Polygon[] {
    const polygons: Polygon[] = [];

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = col * (cellSize + spacing);
        const y = row * (cellSize + spacing);

        polygons.push({
          id: `grid-${row}-${col}`,
          points: [
            { x, y },
            { x: x + cellSize, y },
            { x: x + cellSize, y: y + cellSize },
            { x, y: y + cellSize },
          ],
          type: 'external',
          confidence: Math.random(),
        });
      }
    }

    return polygons;
  }
}
