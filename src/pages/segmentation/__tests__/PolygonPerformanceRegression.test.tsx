/**
 * Performance regression tests for polygon rendering and interaction
 * Tests rendering performance with various polygon datasets and interaction patterns
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import CanvasPolygon from '../components/canvas/CanvasPolygon';
import {
  PolygonPerformanceTestFactory,
  PolygonIdTestFactory,
  PolygonPointTestFactory,
  PolygonShapeTestFactory,
  PolygonTestScenarios,
  PolygonTestUtils,
} from '@/test-utils/polygonTestDataFactory';
import type { Polygon } from '@/lib/segmentation';

// Performance monitoring utilities
interface PerformanceMetrics {
  renderTime: number;
  memoryBefore: number;
  memoryAfter: number;
  memoryDelta: number;
  fps: number;
  interactionTime?: number;
}

class PerformanceMonitor {
  private startTime: number = 0;
  private endTime: number = 0;
  private memoryBefore: number = 0;
  private memoryAfter: number = 0;

  start(): void {
    this.memoryBefore = this.getMemoryUsage();
    this.startTime = performance.now();
  }

  end(): PerformanceMetrics {
    this.endTime = performance.now();
    this.memoryAfter = this.getMemoryUsage();

    const renderTime = this.endTime - this.startTime;
    const memoryDelta = this.memoryAfter - this.memoryBefore;
    const fps = renderTime > 0 ? 1000 / renderTime : 0;

    return {
      renderTime,
      memoryBefore: this.memoryBefore,
      memoryAfter: this.memoryAfter,
      memoryDelta,
      fps,
    };
  }

  private getMemoryUsage(): number {
    // Use performance.memory if available (Chrome)
    if (typeof performance !== 'undefined' && 'memory' in performance) {
      // @ts-expect-error - performance.memory exists in Chrome
      return performance.memory?.usedJSHeapSize || 0;
    }
    return 0;
  }
}

// Mock dependencies with performance considerations
vi.mock('../components/canvas/PolygonVertices', () => ({
  default: React.memo(({ polygonId, points, isSelected }: any) => {
    if (!isSelected || !points || points.length === 0) return null;

    return (
      <g data-testid={`vertices-${polygonId}`}>
        {points.slice(0, 100).map((point: any, index: number) => {
          // Limit vertices for performance
          if (
            !point ||
            typeof point.x !== 'number' ||
            typeof point.y !== 'number'
          ) {
            return null;
          }
          return (
            <circle
              key={`vertex-${polygonId}-${index}`}
              data-testid={`vertex-${polygonId}-${index}`}
              cx={point.x}
              cy={point.y}
              r="2"
            />
          );
        })}
      </g>
    );
  }),
}));

vi.mock('../../context-menu/PolygonContextMenu', () => ({
  default: React.memo(({ children, polygonId }: any) => (
    <g key={`context-${polygonId}`}>{children}</g>
  )),
}));

vi.mock('@/lib/polygonGeometry', () => ({
  calculateBoundingBox: vi.fn((points: any[]) => {
    if (!points || points.length === 0) {
      return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    }

    // Fast bounding box calculation
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;

    for (const point of points) {
      if (point && typeof point.x === 'number' && typeof point.y === 'number') {
        if (point.x < minX) minX = point.x;
        if (point.x > maxX) maxX = point.x;
        if (point.y < minY) minY = point.y;
        if (point.y > maxY) maxY = point.y;
      }
    }

    return { minX, maxX, minY, maxY };
  }),
  isPolygonInViewport: vi.fn(() => true),
  simplifyPolygon: vi.fn((points: any[]) => {
    // Simplify for performance testing
    if (points.length > 50) {
      return points.filter((_, index) => index % 2 === 0);
    }
    return points;
  }),
}));

describe('Polygon Performance Regression Tests', () => {
  let performanceMonitor: PerformanceMonitor;
  let mockHandlers: {
    onSelectPolygon: ReturnType<typeof vi.fn>;
    onDeletePolygon: ReturnType<typeof vi.fn>;
    onSlicePolygon: ReturnType<typeof vi.fn>;
    onEditPolygon: ReturnType<typeof vi.fn>;
    onDeleteVertex: ReturnType<typeof vi.fn>;
    onDuplicateVertex: ReturnType<typeof vi.fn>;
  };

  // Performance thresholds (in milliseconds)
  const PERFORMANCE_THRESHOLDS = {
    SINGLE_POLYGON_RENDER: 50,
    MANY_POLYGONS_RENDER: 500,
    COMPLEX_POLYGON_RENDER: 200,
    INTERACTION_RESPONSE: 100,
    MEMORY_LEAK_THRESHOLD: 10 * 1024 * 1024, // 10MB
  };

  beforeEach(() => {
    performanceMonitor = new PerformanceMonitor();
    mockHandlers = {
      onSelectPolygon: vi.fn(),
      onDeletePolygon: vi.fn(),
      onSlicePolygon: vi.fn(),
      onEditPolygon: vi.fn(),
      onDeleteVertex: vi.fn(),
      onDuplicateVertex: vi.fn(),
    };

    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // Helper to render polygons with performance monitoring
  const renderPolygonsWithMetrics = (
    polygons: Polygon[],
    selectedPolygonId: string | null = null
  ): PerformanceMetrics => {
    performanceMonitor.start();

    const result = render(
      <svg width="2000" height="2000" viewBox="0 0 2000 2000">
        {polygons.map((polygon, index) => (
          <CanvasPolygon
            key={polygon.id || `fallback-${index}`}
            polygon={polygon}
            isSelected={selectedPolygonId === polygon.id}
            zoom={1}
            onSelectPolygon={mockHandlers.onSelectPolygon}
            onDeletePolygon={mockHandlers.onDeletePolygon}
            onSlicePolygon={mockHandlers.onSlicePolygon}
            onEditPolygon={mockHandlers.onEditPolygon}
            onDeleteVertex={mockHandlers.onDeleteVertex}
            onDuplicateVertex={mockHandlers.onDuplicateVertex}
          />
        ))}
      </svg>
    );

    const metrics = performanceMonitor.end();
    return metrics;
  };

  describe('Single Polygon Rendering Performance', () => {
    it('should render simple polygon within performance threshold', () => {
      const simplePolygon = PolygonIdTestFactory.createMLPolygon();
      const metrics = renderPolygonsWithMetrics([simplePolygon]);

      expect(metrics.renderTime).toBeLessThan(
        PERFORMANCE_THRESHOLDS.SINGLE_POLYGON_RENDER
      );
      expect(screen.getByTestId(simplePolygon.id)).toBeInTheDocument();
    });

    it('should render complex polygon efficiently', () => {
      const complexPolygon =
        PolygonPointTestFactory.createManyPointsPolygon(200);
      const metrics = renderPolygonsWithMetrics([complexPolygon]);

      expect(metrics.renderTime).toBeLessThan(
        PERFORMANCE_THRESHOLDS.COMPLEX_POLYGON_RENDER
      );
      expect(screen.getByTestId(complexPolygon.id)).toBeInTheDocument();
    });

    it('should handle extreme coordinate values without performance degradation', () => {
      const extremePolygon =
        PolygonShapeTestFactory.createExtremeCoordinatesPolygon();
      const metrics = renderPolygonsWithMetrics([extremePolygon]);

      expect(metrics.renderTime).toBeLessThan(
        PERFORMANCE_THRESHOLDS.SINGLE_POLYGON_RENDER * 2
      );
      expect(screen.getByTestId(extremePolygon.id)).toBeInTheDocument();
    });

    it('should render self-intersecting polygon without performance issues', () => {
      const selfIntersectingPolygon =
        PolygonShapeTestFactory.createSelfIntersectingPolygon();
      const metrics = renderPolygonsWithMetrics([selfIntersectingPolygon]);

      expect(metrics.renderTime).toBeLessThan(
        PERFORMANCE_THRESHOLDS.SINGLE_POLYGON_RENDER
      );
      expect(
        screen.getByTestId(selfIntersectingPolygon.id)
      ).toBeInTheDocument();
    });
  });

  describe('Multiple Polygon Rendering Performance', () => {
    it('should render many simple polygons within threshold', () => {
      const manyPolygons =
        PolygonPerformanceTestFactory.createManySimplePolygons(100);
      const metrics = renderPolygonsWithMetrics(manyPolygons);

      expect(metrics.renderTime).toBeLessThan(
        PERFORMANCE_THRESHOLDS.MANY_POLYGONS_RENDER
      );

      // Verify some polygons rendered
      expect(screen.getByTestId('perf-simple-0')).toBeInTheDocument();
      expect(screen.getByTestId('perf-simple-50')).toBeInTheDocument();
    });

    it('should handle variable complexity polygons efficiently', () => {
      const variablePolygons =
        PolygonPerformanceTestFactory.createVariableComplexityPolygons(50);
      const metrics = renderPolygonsWithMetrics(variablePolygons);

      expect(metrics.renderTime).toBeLessThan(
        PERFORMANCE_THRESHOLDS.MANY_POLYGONS_RENDER
      );

      // Check that complex polygons rendered
      const complexPolygons = variablePolygons.filter(
        p => p.points.length > 50
      );
      if (complexPolygons.length > 0) {
        expect(screen.getByTestId(complexPolygons[0].id)).toBeInTheDocument();
      }
    });

    it('should maintain performance with mixed data quality', () => {
      const stressTestPolygons =
        PolygonPerformanceTestFactory.createStressTestScenario(75);
      const metrics = renderPolygonsWithMetrics(stressTestPolygons);

      expect(metrics.renderTime).toBeLessThan(
        PERFORMANCE_THRESHOLDS.MANY_POLYGONS_RENDER
      );

      // Application should remain stable
      expect(stressTestPolygons.length).toBeGreaterThan(0);
    });

    it('should handle polygon grid layout efficiently', () => {
      const gridPolygons = PolygonTestUtils.createPolygonGrid(10, 10, 80, 5);
      const metrics = renderPolygonsWithMetrics(gridPolygons);

      expect(metrics.renderTime).toBeLessThan(
        PERFORMANCE_THRESHOLDS.MANY_POLYGONS_RENDER
      );
      expect(gridPolygons.length).toBe(100);

      // Check corners of grid
      expect(screen.getByTestId('grid-0-0')).toBeInTheDocument();
      expect(screen.getByTestId('grid-9-9')).toBeInTheDocument();
    });
  });

  describe('Interaction Performance', () => {
    it('should respond to polygon selection quickly', () => {
      const testPolygons =
        PolygonPerformanceTestFactory.createManySimplePolygons(20);
      renderPolygonsWithMetrics(testPolygons);

      const targetPolygon = screen.getByTestId('perf-simple-5');
      const pathElement = targetPolygon.querySelector('path');

      if (pathElement) {
        const interactionStart = performance.now();
        fireEvent.click(pathElement);
        const interactionTime = performance.now() - interactionStart;

        expect(interactionTime).toBeLessThan(
          PERFORMANCE_THRESHOLDS.INTERACTION_RESPONSE
        );
        expect(mockHandlers.onSelectPolygon).toHaveBeenCalledWith(
          'perf-simple-5'
        );
      }
    });

    it('should handle rapid selection changes efficiently', () => {
      const testPolygons =
        PolygonPerformanceTestFactory.createManySimplePolygons(10);
      renderPolygonsWithMetrics(testPolygons);

      const startTime = performance.now();

      // Rapidly click different polygons
      for (let i = 0; i < 5; i++) {
        const polygon = screen.getByTestId(`perf-simple-${i}`);
        const pathElement = polygon.querySelector('path');
        if (pathElement) {
          fireEvent.click(pathElement);
        }
      }

      const totalInteractionTime = performance.now() - startTime;

      expect(totalInteractionTime).toBeLessThan(
        PERFORMANCE_THRESHOLDS.INTERACTION_RESPONSE * 2
      );
      expect(mockHandlers.onSelectPolygon).toHaveBeenCalledTimes(5);
    });

    it('should handle vertex interactions without performance degradation', () => {
      const complexPolygon =
        PolygonPointTestFactory.createManyPointsPolygon(50);
      renderPolygonsWithMetrics([complexPolygon], complexPolygon.id);

      const vertices = screen.getByTestId(`vertices-${complexPolygon.id}`);
      const vertexElements = vertices.querySelectorAll('circle');

      if (vertexElements.length > 0) {
        const interactionStart = performance.now();

        // Interact with multiple vertices
        for (let i = 0; i < Math.min(5, vertexElements.length); i++) {
          fireEvent.mouseDown(vertexElements[i]);
          fireEvent.mouseMove(vertexElements[i]);
          fireEvent.mouseUp(vertexElements[i]);
        }

        const interactionTime = performance.now() - interactionStart;
        expect(interactionTime).toBeLessThan(
          PERFORMANCE_THRESHOLDS.INTERACTION_RESPONSE
        );
      }
    });

    it('should maintain performance during zoom operations', () => {
      const testPolygons =
        PolygonPerformanceTestFactory.createManySimplePolygons(30);

      // Test different zoom levels
      const zoomLevels = [0.5, 1, 2, 5];

      zoomLevels.forEach(zoom => {
        cleanup(); // Clean up previous render

        performanceMonitor.start();

        render(
          <svg width="2000" height="2000" viewBox="0 0 2000 2000">
            {testPolygons.map((polygon, index) => (
              <CanvasPolygon
                key={polygon.id || `fallback-${index}`}
                polygon={polygon}
                isSelected={false}
                zoom={zoom}
                onSelectPolygon={mockHandlers.onSelectPolygon}
                onDeletePolygon={mockHandlers.onDeletePolygon}
                onSlicePolygon={mockHandlers.onSlicePolygon}
                onEditPolygon={mockHandlers.onEditPolygon}
                onDeleteVertex={mockHandlers.onDeleteVertex}
                onDuplicateVertex={mockHandlers.onDuplicateVertex}
              />
            ))}
          </svg>
        );

        const metrics = performanceMonitor.end();
        expect(metrics.renderTime).toBeLessThan(
          PERFORMANCE_THRESHOLDS.MANY_POLYGONS_RENDER
        );
      });
    });
  });

  describe('Memory Management Performance', () => {
    it('should not leak memory during repeated renders', () => {
      const testPolygon = PolygonIdTestFactory.createMLPolygon();
      let initialMemory = 0;
      let finalMemory = 0;

      // Initial render to establish baseline
      const initialMetrics = renderPolygonsWithMetrics([testPolygon]);
      initialMemory = initialMetrics.memoryAfter;
      cleanup();

      // Perform many render/cleanup cycles
      for (let i = 0; i < 50; i++) {
        const metrics = renderPolygonsWithMetrics([testPolygon]);
        cleanup();

        if (i === 49) {
          finalMemory = metrics.memoryAfter;
        }
      }

      const memoryIncrease = finalMemory - initialMemory;

      // Memory increase should be minimal (accounting for test framework overhead)
      if (initialMemory > 0 && finalMemory > 0) {
        expect(memoryIncrease).toBeLessThan(
          PERFORMANCE_THRESHOLDS.MEMORY_LEAK_THRESHOLD
        );
      }
    });

    it('should efficiently handle large polygon datasets', () => {
      const largeDataset =
        PolygonPerformanceTestFactory.createStressTestScenario(200);

      const metrics = renderPolygonsWithMetrics(largeDataset);

      expect(metrics.renderTime).toBeLessThan(
        PERFORMANCE_THRESHOLDS.MANY_POLYGONS_RENDER * 2
      );

      // Memory usage should be reasonable
      if (metrics.memoryDelta > 0) {
        // Should not use more than 50MB for 200 polygons
        expect(metrics.memoryDelta).toBeLessThan(50 * 1024 * 1024);
      }
    });

    it('should handle polygon updates without memory accumulation', () => {
      let testPolygons =
        PolygonPerformanceTestFactory.createManySimplePolygons(20);

      const { rerender } = render(
        <svg width="2000" height="2000" viewBox="0 0 2000 2000">
          {testPolygons.map((polygon, index) => (
            <CanvasPolygon
              key={polygon.id || `fallback-${index}`}
              polygon={polygon}
              isSelected={false}
              zoom={1}
              onSelectPolygon={mockHandlers.onSelectPolygon}
              onDeletePolygon={mockHandlers.onDeletePolygon}
              onSlicePolygon={mockHandlers.onSlicePolygon}
              onEditPolygon={mockHandlers.onEditPolygon}
              onDeleteVertex={mockHandlers.onDeleteVertex}
              onDuplicateVertex={mockHandlers.onDuplicateVertex}
            />
          ))}
        </svg>
      );

      // Simulate polygon updates
      for (let update = 0; update < 10; update++) {
        testPolygons = testPolygons.map(polygon => ({
          ...polygon,
          confidence: Math.random(),
          points: polygon.points.map(point => ({
            x: point.x + (Math.random() - 0.5) * 2,
            y: point.y + (Math.random() - 0.5) * 2,
          })),
        }));

        const updateStart = performance.now();

        rerender(
          <svg width="2000" height="2000" viewBox="0 0 2000 2000">
            {testPolygons.map((polygon, index) => (
              <CanvasPolygon
                key={polygon.id || `fallback-${index}`}
                polygon={polygon}
                isSelected={false}
                zoom={1}
                onSelectPolygon={mockHandlers.onSelectPolygon}
                onDeletePolygon={mockHandlers.onDeletePolygon}
                onSlicePolygon={mockHandlers.onSlicePolygon}
                onEditPolygon={mockHandlers.onEditPolygon}
                onDeleteVertex={mockHandlers.onDeleteVertex}
                onDuplicateVertex={mockHandlers.onDuplicateVertex}
              />
            ))}
          </svg>
        );

        const updateTime = performance.now() - updateStart;
        expect(updateTime).toBeLessThan(
          PERFORMANCE_THRESHOLDS.MANY_POLYGONS_RENDER / 2
        );
      }
    });
  });

  describe('Regression Detection', () => {
    it('should detect performance regressions in core scenarios', () => {
      const testScenarios = PolygonTestScenarios.getAllScenarios();

      testScenarios.forEach(scenario => {
        cleanup();

        if (scenario.performanceThreshold) {
          const metrics = renderPolygonsWithMetrics(scenario.polygons);

          expect(metrics.renderTime).toBeLessThan(
            scenario.performanceThreshold
          );

          // Log performance for regression tracking
          console.log(
            `Scenario "${scenario.name}": ${metrics.renderTime.toFixed(2)}ms (threshold: ${scenario.performanceThreshold}ms)`
          );
        }
      });
    });

    it('should maintain consistent performance across browser conditions', () => {
      const testPolygons =
        PolygonPerformanceTestFactory.createManySimplePolygons(50);
      const measurements: number[] = [];

      // Take multiple measurements
      for (let i = 0; i < 5; i++) {
        cleanup();
        const metrics = renderPolygonsWithMetrics(testPolygons);
        measurements.push(metrics.renderTime);
      }

      // Calculate variance
      const average =
        measurements.reduce((sum, time) => sum + time, 0) / measurements.length;
      const variance =
        measurements.reduce(
          (sum, time) => sum + Math.pow(time - average, 2),
          0
        ) / measurements.length;
      const standardDeviation = Math.sqrt(variance);

      // Performance should be consistent (low variance)
      expect(standardDeviation).toBeLessThan(average * 0.5); // SD should be less than 50% of average
      expect(average).toBeLessThan(PERFORMANCE_THRESHOLDS.MANY_POLYGONS_RENDER);
    });

    it('should track performance metrics for monitoring', () => {
      const baselinePolygons =
        PolygonPerformanceTestFactory.createManySimplePolygons(25);
      const baselineMetrics = renderPolygonsWithMetrics(baselinePolygons);

      cleanup();

      const stressPolygons =
        PolygonPerformanceTestFactory.createStressTestScenario(25);
      const stressMetrics = renderPolygonsWithMetrics(stressPolygons);

      // Stress test should not be more than 3x slower than baseline
      expect(stressMetrics.renderTime).toBeLessThan(
        baselineMetrics.renderTime * 3
      );

      // Create performance report
      const performanceReport = {
        baseline: {
          polygonCount: baselinePolygons.length,
          renderTime: baselineMetrics.renderTime,
          fps: baselineMetrics.fps,
        },
        stress: {
          polygonCount: stressPolygons.length,
          renderTime: stressMetrics.renderTime,
          fps: stressMetrics.fps,
        },
        ratio: stressMetrics.renderTime / baselineMetrics.renderTime,
      };

      console.log('Performance Report:', performanceReport);

      // Ensure we have meaningful data
      expect(performanceReport.baseline.renderTime).toBeGreaterThan(0);
      expect(performanceReport.stress.renderTime).toBeGreaterThan(0);
    });
  });

  describe('Edge Case Performance', () => {
    it('should handle invalid polygon data without performance penalty', () => {
      const invalidPolygons = [
        ...PolygonPointTestFactory.createPointDataIssueSet(),
        PolygonIdTestFactory.createUndefinedIdPolygon(),
        PolygonIdTestFactory.createEmptyIdPolygon(),
      ];

      const metrics = renderPolygonsWithMetrics(invalidPolygons);

      // Should render quickly despite invalid data
      expect(metrics.renderTime).toBeLessThan(
        PERFORMANCE_THRESHOLDS.SINGLE_POLYGON_RENDER * invalidPolygons.length
      );
    });

    it('should maintain performance with extremely complex polygons', () => {
      const extremePolygon =
        PolygonPointTestFactory.createManyPointsPolygon(1000);
      const metrics = renderPolygonsWithMetrics([extremePolygon]);

      // Should handle complex polygon reasonably
      expect(metrics.renderTime).toBeLessThan(
        PERFORMANCE_THRESHOLDS.COMPLEX_POLYGON_RENDER * 2
      );
    });

    it('should handle mixed valid and invalid polygon sets efficiently', () => {
      const mixedPolygons = [
        ...PolygonPerformanceTestFactory.createManySimplePolygons(10),
        ...PolygonPointTestFactory.createPointDataIssueSet(),
        ...PolygonIdTestFactory.createMixedIdValidityPolygons(5),
      ];

      const metrics = renderPolygonsWithMetrics(mixedPolygons);

      expect(metrics.renderTime).toBeLessThan(
        PERFORMANCE_THRESHOLDS.MANY_POLYGONS_RENDER
      );

      // Valid polygons should still render
      expect(screen.getByTestId('perf-simple-0')).toBeInTheDocument();
    });
  });
});
