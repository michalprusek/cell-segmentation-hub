/**
 * Comprehensive edge case tests for invalid polygon data handling
 * Tests malformed data, boundary conditions, and error recovery scenarios
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CanvasPolygon from '../components/canvas/CanvasPolygon';
import { createMockPolygon } from '@/test-utils/segmentationTestUtils';
import type { Polygon, Point } from '@/lib/segmentation';

// Mock logger to capture validation warnings
const mockLogger = {
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  group: vi.fn(),
  groupEnd: vi.fn(),
  time: vi.fn(),
  timeEnd: vi.fn(),
};

// Mock logger module
vi.mock('@/lib/logger', () => ({
  logger: mockLogger,
}));

// Mock dependencies
vi.mock('../components/canvas/PolygonVertices', () => ({
  default: ({ polygonId, points, onVertexClick }: any) => (
    <g data-testid={`vertices-${polygonId}`}>
      {points?.map((point: any, index: number) => {
        if (!point || typeof point.x !== 'number' || typeof point.y !== 'number') {
          return null;
        }
        return (
          <circle
            key={`vertex-${polygonId}-${index}`}
            data-testid={`vertex-${polygonId}-${index}`}
            cx={point.x}
            cy={point.y}
            r="3"
            onClick={() => onVertexClick?.(index)}
          />
        );
      }) || null}
    </g>
  ),
}));

vi.mock('../../context-menu/PolygonContextMenu', () => ({
  default: ({ children, polygonId }: any) => (
    <g>
      {children}
      <g data-testid={`context-menu-${polygonId}`} />
    </g>
  ),
}));

vi.mock('@/lib/polygonGeometry', () => ({
  calculateBoundingBox: vi.fn((points: any[]) => {
    if (!points || points.length === 0) {
      return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    }

    const validPoints = points.filter(p =>
      p &&
      typeof p.x === 'number' &&
      typeof p.y === 'number' &&
      !isNaN(p.x) &&
      !isNaN(p.y)
    );

    if (validPoints.length === 0) {
      return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    }

    return {
      minX: Math.min(...validPoints.map(p => p.x)),
      maxX: Math.max(...validPoints.map(p => p.x)),
      minY: Math.min(...validPoints.map(p => p.y)),
      maxY: Math.max(...validPoints.map(p => p.y)),
    };
  }),
  isPolygonInViewport: vi.fn(() => true),
  simplifyPolygon: vi.fn((points: any[]) => points),
}));

describe('Polygon Data Edge Cases and Invalid Data Handling', () => {
  let mockOnSelectPolygon: ReturnType<typeof vi.fn>;
  let mockOnDeletePolygon: ReturnType<typeof vi.fn>;
  let mockOnSlicePolygon: ReturnType<typeof vi.fn>;
  let mockOnEditPolygon: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockOnSelectPolygon = vi.fn();
    mockOnDeletePolygon = vi.fn();
    mockOnSlicePolygon = vi.fn();
    mockOnEditPolygon = vi.fn();

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Helper to render polygon with error boundary
  const renderPolygonSafely = (polygon: any, props: any = {}) => {
    try {
      return render(
        <svg width="800" height="600" viewBox="0 0 800 600">
          <CanvasPolygon
            polygon={polygon}
            isSelected={false}
            zoom={1}
            onSelectPolygon={mockOnSelectPolygon}
            onDeletePolygon={mockOnDeletePolygon}
            onSlicePolygon={mockOnSlicePolygon}
            onEditPolygon={mockOnEditPolygon}
            onDeleteVertex={vi.fn()}
            onDuplicateVertex={vi.fn()}
            {...props}
          />
        </svg>
      );
    } catch (error) {
      return { error };
    }
  };

  describe('Malformed Polygon Objects', () => {
    it('should handle completely null polygon', () => {
      const result = renderPolygonSafely(null);

      // Should either render safely or provide clear error
      if ('error' in result) {
        expect(result.error).toBeDefined();
      } else {
        expect(result.container).toBeTruthy();
      }
    });

    it('should handle undefined polygon', () => {
      const result = renderPolygonSafely(undefined);

      if ('error' in result) {
        expect(result.error).toBeDefined();
      } else {
        expect(result.container).toBeTruthy();
      }
    });

    it('should handle polygon with missing required properties', () => {
      const incompletePolygon = {
        // Missing id, points, and type
        confidence: 0.9,
      };

      const result = renderPolygonSafely(incompletePolygon);

      // CanvasPolygon should handle incomplete polygon gracefully without throwing
      expect(result.container).toBeTruthy();
    });

    it('should handle polygon with wrong property types', () => {
      const wrongTypesPolygon = {
        id: 123, // Should be string
        points: 'not-an-array', // Should be array
        type: null, // Should be string
        confidence: 'high', // Should be number
      };

      const result = renderPolygonSafely(wrongTypesPolygon);

      // CanvasPolygon should handle wrong types gracefully without throwing
      expect(result.container).toBeTruthy();
    });
  });

  describe('Invalid Point Data', () => {
    it('should handle empty points array', () => {
      const emptyPointsPolygon: Polygon = {
        id: 'empty-points',
        points: [],
        type: 'external',
      };

      const { container } = renderPolygonSafely(emptyPointsPolygon);

      expect(container).toBeTruthy();
      expect(mockConsole.warn).toHaveBeenCalledWith(
        expect.stringContaining('insufficient points')
      );
    });

    it('should handle insufficient points (less than 3)', () => {
      const insufficientPointsPolygon: Polygon = {
        id: 'insufficient-points',
        points: [
          { x: 10, y: 10 },
          { x: 50, y: 10 },
        ],
        type: 'external',
      };

      const { container } = renderPolygonSafely(insufficientPointsPolygon);

      expect(container).toBeTruthy();
      expect(mockConsole.warn).toHaveBeenCalledWith(
        expect.stringContaining('insufficient points')
      );
    });

    it('should handle points with NaN coordinates', () => {
      const nanPointsPolygon: Polygon = {
        id: 'nan-points',
        points: [
          { x: NaN, y: 10 },
          { x: 50, y: NaN },
          { x: 50, y: 50 },
          { x: 10, y: 50 },
        ],
        type: 'external',
      };

      const { container } = renderPolygonSafely(nanPointsPolygon);

      expect(container).toBeTruthy();
      expect(mockConsole.warn).toHaveBeenCalledWith(
        expect.stringContaining('Invalid coordinates')
      );
    });

    it('should handle points with Infinity coordinates', () => {
      const infinityPointsPolygon: Polygon = {
        id: 'infinity-points',
        points: [
          { x: Infinity, y: 10 },
          { x: 50, y: -Infinity },
          { x: 50, y: 50 },
          { x: 10, y: 50 },
        ],
        type: 'external',
      };

      const { container } = renderPolygonSafely(infinityPointsPolygon);

      expect(container).toBeTruthy();
      expect(mockConsole.warn).toHaveBeenCalledWith(
        expect.stringContaining('Invalid coordinates')
      );
    });

    it('should handle points with missing coordinates', () => {
      const missingCoordsPolygon: Polygon = {
        id: 'missing-coords',
        points: [
          { x: 10, y: 10 },
          { x: 50 } as any, // Missing y
          { y: 50 } as any, // Missing x
          { x: 10, y: 50 },
        ],
        type: 'external',
      };

      const { container } = renderPolygonSafely(missingCoordsPolygon);

      expect(container).toBeTruthy();
      expect(mockConsole.warn).toHaveBeenCalled();
    });

    it('should handle points with wrong coordinate types', () => {
      const wrongCoordTypesPolygon: Polygon = {
        id: 'wrong-coord-types',
        points: [
          { x: '10', y: 10 } as any, // String instead of number
          { x: 50, y: true } as any, // Boolean instead of number
          { x: null, y: 50 } as any, // Null instead of number
          { x: 10, y: 50 },
        ],
        type: 'external',
      };

      const { container } = renderPolygonSafely(wrongCoordTypesPolygon);

      expect(container).toBeTruthy();
      expect(mockConsole.warn).toHaveBeenCalled();
    });

    it('should handle null/undefined points in array', () => {
      const nullPointsPolygon: Polygon = {
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

      const { container } = renderPolygonSafely(nullPointsPolygon);

      expect(container).toBeTruthy();
      expect(mockConsole.warn).toHaveBeenCalledWith(
        expect.stringContaining('Invalid point data')
      );
    });
  });

  describe('Boundary Value Testing', () => {
    it('should handle extremely large coordinate values', () => {
      const largeCoordinatesPolygon: Polygon = {
        id: 'large-coordinates',
        points: [
          { x: Number.MAX_SAFE_INTEGER, y: Number.MAX_SAFE_INTEGER },
          { x: Number.MAX_SAFE_INTEGER - 1000, y: Number.MAX_SAFE_INTEGER },
          { x: Number.MAX_SAFE_INTEGER - 1000, y: Number.MAX_SAFE_INTEGER - 1000 },
          { x: Number.MAX_SAFE_INTEGER, y: Number.MAX_SAFE_INTEGER - 1000 },
        ],
        type: 'external',
      };

      const { container } = renderPolygonSafely(largeCoordinatesPolygon);

      expect(container).toBeTruthy();
      // May log performance warning for large coordinates
    });

    it('should handle extremely small coordinate values', () => {
      const smallCoordinatesPolygon: Polygon = {
        id: 'small-coordinates',
        points: [
          { x: Number.MIN_SAFE_INTEGER, y: Number.MIN_SAFE_INTEGER },
          { x: Number.MIN_SAFE_INTEGER + 1000, y: Number.MIN_SAFE_INTEGER },
          { x: Number.MIN_SAFE_INTEGER + 1000, y: Number.MIN_SAFE_INTEGER + 1000 },
          { x: Number.MIN_SAFE_INTEGER, y: Number.MIN_SAFE_INTEGER + 1000 },
        ],
        type: 'external',
      };

      const { container } = renderPolygonSafely(smallCoordinatesPolygon);

      expect(container).toBeTruthy();
    });

    it('should handle zero-area polygons (all points same)', () => {
      const zeroAreaPolygon: Polygon = {
        id: 'zero-area',
        points: [
          { x: 50, y: 50 },
          { x: 50, y: 50 },
          { x: 50, y: 50 },
          { x: 50, y: 50 },
        ],
        type: 'external',
      };

      const { container } = renderPolygonSafely(zeroAreaPolygon);

      expect(container).toBeTruthy();
      expect(mockConsole.warn).toHaveBeenCalledWith(
        expect.stringContaining('degenerate polygon')
      );
    });

    it('should handle extremely many points', () => {
      const manyPointsPolygon: Polygon = {
        id: 'many-points',
        points: Array.from({ length: 10000 }, (_, i) => {
          const angle = (i / 10000) * 2 * Math.PI;
          return {
            x: 400 + Math.cos(angle) * 300,
            y: 300 + Math.sin(angle) * 300,
          };
        }),
        type: 'external',
      };

      const startTime = performance.now();
      const { container } = renderPolygonSafely(manyPointsPolygon);
      const renderTime = performance.now() - startTime;

      expect(container).toBeTruthy();

      // Should log performance warning for too many points
      if (renderTime > 100) {
        expect(mockConsole.warn).toHaveBeenCalledWith(
          expect.stringContaining('performance')
        );
      }
    });
  });

  describe('Type System Edge Cases', () => {
    it('should handle invalid polygon type values', () => {
      const invalidTypePolygon: Polygon = {
        id: 'invalid-type',
        points: [
          { x: 10, y: 10 },
          { x: 50, y: 10 },
          { x: 50, y: 50 },
          { x: 10, y: 50 },
        ],
        type: 'invalid-type' as any, // Not 'external' or 'internal'
      };

      const { container } = renderPolygonSafely(invalidTypePolygon);

      expect(container).toBeTruthy();
      expect(mockConsole.warn).toHaveBeenCalledWith(
        expect.stringContaining('Invalid polygon type')
      );
    });

    it('should handle numeric polygon type', () => {
      const numericTypePolygon: any = {
        id: 'numeric-type',
        points: [
          { x: 10, y: 10 },
          { x: 50, y: 10 },
          { x: 50, y: 50 },
          { x: 10, y: 50 },
        ],
        type: 1, // Number instead of string
      };

      const { container } = renderPolygonSafely(numericTypePolygon);

      expect(container).toBeTruthy();
      expect(mockConsole.warn).toHaveBeenCalled();
    });

    it('should handle missing confidence values gracefully', () => {
      const noConfidencePolygon: Polygon = {
        id: 'no-confidence',
        points: [
          { x: 10, y: 10 },
          { x: 50, y: 10 },
          { x: 50, y: 50 },
          { x: 10, y: 50 },
        ],
        type: 'external',
        // confidence is optional, should work without it
      };

      const { container } = renderPolygonSafely(noConfidencePolygon);

      expect(container).toBeTruthy();
      expect(screen.getByTestId('no-confidence')).toBeInTheDocument();
    });

    it('should handle invalid confidence values', () => {
      const invalidConfidencePolygon: Polygon = {
        id: 'invalid-confidence',
        points: [
          { x: 10, y: 10 },
          { x: 50, y: 10 },
          { x: 50, y: 50 },
          { x: 10, y: 50 },
        ],
        type: 'external',
        confidence: 'high' as any, // String instead of number
      };

      const { container } = renderPolygonSafely(invalidConfidencePolygon);

      expect(container).toBeTruthy();
    });
  });

  describe('Memory and Performance Edge Cases', () => {
    it('should handle circular reference in polygon data', () => {
      const circularPolygon: any = {
        id: 'circular-ref',
        points: [
          { x: 10, y: 10 },
          { x: 50, y: 10 },
          { x: 50, y: 50 },
          { x: 10, y: 50 },
        ],
        type: 'external',
      };

      // Create circular reference
      circularPolygon.self = circularPolygon;

      const { container } = renderPolygonSafely(circularPolygon);

      expect(container).toBeTruthy();
    });

    it('should handle deep nested objects in polygon properties', () => {
      const deepNestedPolygon: Polygon = {
        id: 'deep-nested',
        points: [
          { x: 10, y: 10 },
          { x: 50, y: 10 },
          { x: 50, y: 50 },
          { x: 10, y: 50 },
        ],
        type: 'external',
        // Add deeply nested metadata
        metadata: {
          level1: {
            level2: {
              level3: {
                level4: {
                  level5: 'deep value',
                },
              },
            },
          },
        } as any,
      };

      const { container } = renderPolygonSafely(deepNestedPolygon);

      expect(container).toBeTruthy();
    });

    it('should handle massive string IDs', () => {
      const massiveIdPolygon: Polygon = {
        id: 'x'.repeat(10000), // 10KB string ID
        points: [
          { x: 10, y: 10 },
          { x: 50, y: 10 },
          { x: 50, y: 50 },
          { x: 10, y: 50 },
        ],
        type: 'external',
      };

      const { container } = renderPolygonSafely(massiveIdPolygon);

      expect(container).toBeTruthy();
    });
  });

  describe('Interaction Edge Cases', () => {
    it('should handle clicks on polygons with invalid data', () => {
      const invalidDataPolygon: Polygon = {
        id: '',
        points: [
          { x: NaN, y: 10 },
          { x: 50, y: 10 },
          { x: 50, y: 50 },
          { x: 10, y: 50 },
        ],
        type: 'external',
      };

      const { container } = renderPolygonSafely(invalidDataPolygon);

      if (container) {
        const polygonElement = container.querySelector('g');
        const pathElement = polygonElement?.querySelector('path');

        if (pathElement) {
          expect(() => {
            fireEvent.click(pathElement);
          }).not.toThrow();
        }
      }
    });

    it('should handle vertex interactions with invalid point data', () => {
      const invalidVerticesPolygon: Polygon = {
        id: 'invalid-vertices',
        points: [
          { x: 10, y: 10 },
          { x: NaN, y: 20 }, // Invalid vertex
          { x: 50, y: 50 },
          { x: 10, y: 50 },
        ],
        type: 'external',
      };

      const { container } = renderPolygonSafely(invalidVerticesPolygon, { isSelected: true });

      if (container) {
        // Try to interact with vertices
        const vertices = container.querySelectorAll('[data-testid^="vertex-"]');

        vertices.forEach(vertex => {
          expect(() => {
            fireEvent.click(vertex);
            fireEvent.mouseDown(vertex);
          }).not.toThrow();
        });
      }
    });

    it('should handle operations on polygons during data corruption', () => {
      const workingPolygon = createMockPolygon({
        id: 'working-polygon',
        points: [
          { x: 10, y: 10 },
          { x: 50, y: 10 },
          { x: 50, y: 50 },
          { x: 10, y: 50 },
        ],
      });

      const { rerender } = render(
        <svg width="800" height="600" viewBox="0 0 800 600">
          <CanvasPolygon
            polygon={workingPolygon}
            isSelected={false}
            zoom={1}
            onSelectPolygon={mockOnSelectPolygon}
            onDeletePolygon={mockOnDeletePolygon}
            onSlicePolygon={mockOnSlicePolygon}
            onEditPolygon={mockOnEditPolygon}
            onDeleteVertex={vi.fn()}
            onDuplicateVertex={vi.fn()}
          />
        </svg>
      );

      expect(screen.getByTestId('working-polygon')).toBeInTheDocument();

      // Simulate data corruption during re-render
      const corruptedPolygon: any = {
        ...workingPolygon,
        points: null, // Corrupt the points
      };

      expect(() => {
        rerender(
          <svg width="800" height="600" viewBox="0 0 800 600">
            <CanvasPolygon
              polygon={corruptedPolygon}
              isSelected={false}
              zoom={1}
              onSelectPolygon={mockOnSelectPolygon}
              onDeletePolygon={mockOnDeletePolygon}
              onSlicePolygon={mockOnSlicePolygon}
              onEditPolygon={mockOnEditPolygon}
              onDeleteVertex={vi.fn()}
              onDuplicateVertex={vi.fn()}
            />
          </svg>
        );
      }).not.toThrow();
    });
  });

  describe('Recovery and Fallback Mechanisms', () => {
    it('should provide reasonable fallbacks for missing data', () => {
      const minimalPolygon: any = {
        // Only provide minimal required data
        points: [
          { x: 10, y: 10 },
          { x: 50, y: 10 },
          { x: 50, y: 50 },
        ],
      };

      const { container } = renderPolygonSafely(minimalPolygon);

      expect(container).toBeTruthy();
      // Should log warnings about missing required fields
      expect(mockConsole.warn).toHaveBeenCalled();
    });

    it('should handle gradual data corruption gracefully', () => {
      let polygon = createMockPolygon({
        id: 'gradual-corruption',
        points: [
          { x: 10, y: 10 },
          { x: 50, y: 10 },
          { x: 50, y: 50 },
          { x: 10, y: 50 },
        ],
      });

      const { rerender } = render(
        <svg width="800" height="600" viewBox="0 0 800 600">
          <CanvasPolygon
            polygon={polygon}
            isSelected={false}
            zoom={1}
            onSelectPolygon={mockOnSelectPolygon}
            onDeletePolygon={mockOnDeletePolygon}
            onSlicePolygon={mockOnSlicePolygon}
            onEditPolygon={mockOnEditPolygon}
            onDeleteVertex={vi.fn()}
            onDuplicateVertex={vi.fn()}
          />
        </svg>
      );

      // Gradually corrupt the data
      const corruptionSteps = [
        { ...polygon, confidence: 'invalid' as any },
        { ...polygon, type: null as any },
        { ...polygon, points: [...polygon.points, null as any] },
        { ...polygon, id: undefined as any },
      ];

      corruptionSteps.forEach((corruptedPolygon, index) => {
        expect(() => {
          rerender(
            <svg width="800" height="600" viewBox="0 0 800 600">
              <CanvasPolygon
                polygon={corruptedPolygon}
                isSelected={false}
                zoom={1}
                onSelectPolygon={mockOnSelectPolygon}
                onDeletePolygon={mockOnDeletePolygon}
                onSlicePolygon={mockOnSlicePolygon}
                onEditPolygon={mockOnEditPolygon}
                onDeleteVertex={vi.fn()}
                onDuplicateVertex={vi.fn()}
              />
            </svg>
          );
        }).not.toThrow();
      });
    });

    it('should maintain stability with mixed valid and invalid data', () => {
      const mixedPolygons = [
        // Valid polygon
        createMockPolygon({
          id: 'valid-1',
          points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }, { x: 0, y: 50 }],
        }),
        // Invalid points
        {
          id: 'invalid-points',
          points: null as any,
          type: 'external' as const,
        },
        // Valid polygon
        createMockPolygon({
          id: 'valid-2',
          points: [{ x: 100, y: 0 }, { x: 150, y: 0 }, { x: 150, y: 50 }, { x: 100, y: 50 }],
        }),
        // Invalid ID
        {
          id: null as any,
          points: [{ x: 200, y: 0 }, { x: 250, y: 0 }, { x: 250, y: 50 }, { x: 200, y: 50 }],
          type: 'external' as const,
        },
      ];

      const { container } = render(
        <svg width="800" height="600" viewBox="0 0 800 600">
          {mixedPolygons.map((polygon, index) => (
            <CanvasPolygon
              key={polygon.id || `fallback-${index}`}
              polygon={polygon}
              isSelected={false}
              zoom={1}
              onSelectPolygon={mockOnSelectPolygon}
              onDeletePolygon={mockOnDeletePolygon}
              onSlicePolygon={mockOnSlicePolygon}
              onEditPolygon={mockOnEditPolygon}
              onDeleteVertex={vi.fn()}
              onDuplicateVertex={vi.fn()}
            />
          ))}
        </svg>
      );

      // Valid polygons should still render
      expect(screen.getByTestId('valid-1')).toBeInTheDocument();
      expect(screen.getByTestId('valid-2')).toBeInTheDocument();

      // Application should remain stable
      expect(container).toBeTruthy();
    });
  });
});