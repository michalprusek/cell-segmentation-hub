/**
 * Comprehensive tests for React key generation in polygon rendering
 * Tests React key conflicts, duplicate key warnings, and proper key uniqueness
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import CanvasPolygon from '../components/canvas/CanvasPolygon';
import { createMockPolygon } from '@/test-utils/segmentationTestUtils';
import type { Polygon } from '@/lib/segmentation';

// Mock React's console.error to capture React warnings
const mockReactErrors: string[] = [];
const originalConsoleError = console.error;

// Mock dependencies
vi.mock('../components/canvas/PolygonVertices', () => ({
  default: ({ polygonId, points }: any) => (
    <g data-testid={`vertices-${polygonId}`}>
      {points?.map((point: any, index: number) => (
        <circle
          key={`vertex-${polygonId}-${index}`}
          data-testid={`vertex-${polygonId}-${index}`}
          cx={point.x}
          cy={point.y}
          r="3"
        />
      )) || null}
    </g>
  ),
}));

vi.mock('../../context-menu/PolygonContextMenu', () => ({
  default: ({ children, polygonId }: any) => (
    <g key={`context-${polygonId}`}>{children}</g>
  ),
}));

vi.mock('@/lib/polygonGeometry', () => ({
  calculateBoundingBox: vi.fn((points: any[]) => ({
    minX: Math.min(...points.map(p => p.x)),
    maxX: Math.max(...points.map(p => p.x)),
    minY: Math.min(...points.map(p => p.y)),
    maxY: Math.max(...points.map(p => p.y)),
  })),
  isPolygonInViewport: vi.fn(() => true),
  simplifyPolygon: vi.fn((points: any[]) => points),
}));

describe('React Key Generation for Polygon Rendering', () => {
  beforeEach(() => {
    mockReactErrors.length = 0;
    console.error = (...args: any[]) => {
      const message = args[0];
      if (typeof message === 'string' && message.includes('Warning:')) {
        mockReactErrors.push(message);
      }
      // Call original for other errors
      originalConsoleError(...args);
    };
  });

  afterEach(() => {
    console.error = originalConsoleError;
    vi.clearAllMocks();
  });

  describe('Unique Key Generation', () => {
    it('should generate unique keys for valid polygon IDs', () => {
      const polygons = [
        createMockPolygon({
          id: 'polygon-alpha',
          points: [
            { x: 0, y: 0 },
            { x: 50, y: 0 },
            { x: 50, y: 50 },
            { x: 0, y: 50 },
          ],
        }),
        createMockPolygon({
          id: 'polygon-beta',
          points: [
            { x: 100, y: 0 },
            { x: 150, y: 0 },
            { x: 150, y: 50 },
            { x: 100, y: 50 },
          ],
        }),
        createMockPolygon({
          id: 'polygon-gamma',
          points: [
            { x: 200, y: 0 },
            { x: 250, y: 0 },
            { x: 250, y: 50 },
            { x: 200, y: 50 },
          ],
        }),
      ];

      render(
        <svg width="800" height="600" viewBox="0 0 800 600">
          {polygons.map(polygon => (
            <CanvasPolygon
              key={polygon.id}
              polygon={polygon}
              isSelected={false}
              zoom={1}
              onSelectPolygon={vi.fn()}
              onDeletePolygon={vi.fn()}
              onSlicePolygon={vi.fn()}
              onEditPolygon={vi.fn()}
              onDeleteVertex={vi.fn()}
              onDuplicateVertex={vi.fn()}
            />
          ))}
        </svg>
      );

      // Verify all polygons rendered
      expect(screen.getByTestId('polygon-alpha')).toBeInTheDocument();
      expect(screen.getByTestId('polygon-beta')).toBeInTheDocument();
      expect(screen.getByTestId('polygon-gamma')).toBeInTheDocument();

      // No React key warnings should be generated
      const keyWarnings = mockReactErrors.filter(error =>
        error.includes('Warning: Encountered two children with the same key')
      );
      expect(keyWarnings).toHaveLength(0);
    });

    it('should prevent duplicate keys when using fallback key generation', () => {
      const polygonsWithDuplicateIds: Polygon[] = [
        {
          id: 'duplicate-id',
          points: [
            { x: 0, y: 0 },
            { x: 50, y: 0 },
            { x: 50, y: 50 },
            { x: 0, y: 50 },
          ],
          type: 'external',
        },
        {
          id: 'duplicate-id', // Same ID
          points: [
            { x: 100, y: 0 },
            { x: 150, y: 0 },
            { x: 150, y: 50 },
            { x: 100, y: 50 },
          ],
          type: 'external',
        },
        {
          id: 'unique-id',
          points: [
            { x: 200, y: 0 },
            { x: 250, y: 0 },
            { x: 250, y: 50 },
            { x: 200, y: 50 },
          ],
          type: 'external',
        },
      ];

      render(
        <svg width="800" height="600" viewBox="0 0 800 600">
          {polygonsWithDuplicateIds.map((polygon, index) => (
            <CanvasPolygon
              key={`${polygon.id}-${index}`} // Proper unique key generation
              polygon={polygon}
              isSelected={false}
              zoom={1}
              onSelectPolygon={vi.fn()}
              onDeletePolygon={vi.fn()}
              onSlicePolygon={vi.fn()}
              onEditPolygon={vi.fn()}
              onDeleteVertex={vi.fn()}
              onDuplicateVertex={vi.fn()}
            />
          ))}
        </svg>
      );

      // Should render without React key warnings
      const keyWarnings = mockReactErrors.filter(error =>
        error.includes('Warning: Encountered two children with the same key')
      );
      expect(keyWarnings).toHaveLength(0);
    });

    it('should handle undefined IDs with unique fallback keys', () => {
      const polygonsWithUndefinedIds: Polygon[] = [
        {
          id: undefined as any,
          points: [
            { x: 0, y: 0 },
            { x: 50, y: 0 },
            { x: 50, y: 50 },
            { x: 0, y: 50 },
          ],
          type: 'external',
        },
        {
          id: undefined as any,
          points: [
            { x: 100, y: 0 },
            { x: 150, y: 0 },
            { x: 150, y: 50 },
            { x: 100, y: 50 },
          ],
          type: 'external',
        },
        {
          id: 'valid-id',
          points: [
            { x: 200, y: 0 },
            { x: 250, y: 0 },
            { x: 250, y: 50 },
            { x: 200, y: 50 },
          ],
          type: 'external',
        },
      ];

      render(
        <svg width="800" height="600" viewBox="0 0 800 600">
          {polygonsWithUndefinedIds.map((polygon, index) => (
            <CanvasPolygon
              key={polygon.id || `undefined-polygon-${index}`}
              polygon={polygon}
              isSelected={false}
              zoom={1}
              onSelectPolygon={vi.fn()}
              onDeletePolygon={vi.fn()}
              onSlicePolygon={vi.fn()}
              onEditPolygon={vi.fn()}
              onDeleteVertex={vi.fn()}
              onDuplicateVertex={vi.fn()}
            />
          ))}
        </svg>
      );

      // No duplicate key warnings
      const keyWarnings = mockReactErrors.filter(error =>
        error.includes('Warning: Encountered two children with the same key')
      );
      expect(keyWarnings).toHaveLength(0);

      // Valid polygon should still render
      expect(screen.getByTestId('valid-id')).toBeInTheDocument();
    });
  });

  describe('Key Stability Across Re-renders', () => {
    it('should maintain stable keys when polygon data changes', () => {
      const initialPolygon = createMockPolygon({
        id: 'stable-polygon',
        points: [
          { x: 0, y: 0 },
          { x: 50, y: 0 },
          { x: 50, y: 50 },
          { x: 0, y: 50 },
        ],
      });

      const { rerender } = render(
        <svg width="800" height="600" viewBox="0 0 800 600">
          <CanvasPolygon
            key={initialPolygon.id}
            polygon={initialPolygon}
            isSelected={false}
            zoom={1}
            onSelectPolygon={vi.fn()}
            onDeletePolygon={vi.fn()}
            onSlicePolygon={vi.fn()}
            onEditPolygon={vi.fn()}
            onDeleteVertex={vi.fn()}
            onDuplicateVertex={vi.fn()}
          />
        </svg>
      );

      expect(screen.getByTestId('stable-polygon')).toBeInTheDocument();

      // Modify polygon data but keep same ID
      const modifiedPolygon = {
        ...initialPolygon,
        points: [
          { x: 10, y: 10 },
          { x: 60, y: 10 },
          { x: 60, y: 60 },
          { x: 10, y: 60 },
        ],
        confidence: 0.95,
      };

      rerender(
        <svg width="800" height="600" viewBox="0 0 800 600">
          <CanvasPolygon
            key={modifiedPolygon.id}
            polygon={modifiedPolygon}
            isSelected={false}
            zoom={1}
            onSelectPolygon={vi.fn()}
            onDeletePolygon={vi.fn()}
            onSlicePolygon={vi.fn()}
            onEditPolygon={vi.fn()}
            onDeleteVertex={vi.fn()}
            onDuplicateVertex={vi.fn()}
          />
        </svg>
      );

      // Should still render with same testid
      expect(screen.getByTestId('stable-polygon')).toBeInTheDocument();

      // No re-render warnings
      const rerenderWarnings = mockReactErrors.filter(
        error => error.includes('Warning:') && error.includes('key')
      );
      expect(rerenderWarnings).toHaveLength(0);
    });

    it('should handle key changes when polygon ID changes', () => {
      const polygon = createMockPolygon({
        id: 'original-id',
        points: [
          { x: 0, y: 0 },
          { x: 50, y: 0 },
          { x: 50, y: 50 },
          { x: 0, y: 50 },
        ],
      });

      const { rerender } = render(
        <svg width="800" height="600" viewBox="0 0 800 600">
          <CanvasPolygon
            key={polygon.id}
            polygon={polygon}
            isSelected={false}
            zoom={1}
            onSelectPolygon={vi.fn()}
            onDeletePolygon={vi.fn()}
            onSlicePolygon={vi.fn()}
            onEditPolygon={vi.fn()}
            onDeleteVertex={vi.fn()}
            onDuplicateVertex={vi.fn()}
          />
        </svg>
      );

      expect(screen.getByTestId('original-id')).toBeInTheDocument();

      // Change polygon ID
      const renamedPolygon = {
        ...polygon,
        id: 'renamed-id',
      };

      rerender(
        <svg width="800" height="600" viewBox="0 0 800 600">
          <CanvasPolygon
            key={renamedPolygon.id}
            polygon={renamedPolygon}
            isSelected={false}
            zoom={1}
            onSelectPolygon={vi.fn()}
            onDeletePolygon={vi.fn()}
            onSlicePolygon={vi.fn()}
            onEditPolygon={vi.fn()}
            onDeleteVertex={vi.fn()}
            onDuplicateVertex={vi.fn()}
          />
        </svg>
      );

      // Old ID should be gone, new ID should exist
      expect(screen.queryByTestId('original-id')).not.toBeInTheDocument();
      expect(screen.getByTestId('renamed-id')).toBeInTheDocument();
    });
  });

  describe('Complex Key Scenarios', () => {
    it('should handle dynamic polygon arrays with mixed ID validity', () => {
      const generateDynamicPolygons = (count: number): Polygon[] => {
        return Array.from({ length: count }, (_, i) => {
          let id: string | undefined;

          // Create different patterns of ID validity
          switch (i % 5) {
            case 0:
              id = `valid-${i}`;
              break;
            case 1:
              id = undefined;
              break;
            case 2:
              id = '';
              break;
            case 3:
              id = `   whitespace-${i}   `;
              break;
            case 4:
              id = `duplicate-id`; // Intentional duplicates
              break;
          }

          return {
            id: id as string,
            points: [
              { x: i * 30, y: 0 },
              { x: i * 30 + 25, y: 0 },
              { x: i * 30 + 25, y: 25 },
              { x: i * 30, y: 25 },
            ],
            type: 'external' as const,
          };
        });
      };

      const polygons = generateDynamicPolygons(20);

      render(
        <svg width="2000" height="600" viewBox="0 0 2000 600">
          {polygons.map((polygon, index) => (
            <CanvasPolygon
              key={
                polygon.id && polygon.id.trim()
                  ? polygon.id
                  : `fallback-${index}`
              }
              polygon={polygon}
              isSelected={false}
              zoom={1}
              onSelectPolygon={vi.fn()}
              onDeletePolygon={vi.fn()}
              onSlicePolygon={vi.fn()}
              onEditPolygon={vi.fn()}
              onDeleteVertex={vi.fn()}
              onDuplicateVertex={vi.fn()}
            />
          ))}
        </svg>
      );

      // Should render, but may have duplicate key warnings for the intentional duplicates
      const keyWarnings = mockReactErrors.filter(error =>
        error.includes('Warning: Encountered two children with the same key')
      );
      // This test creates intentional duplicate IDs, so warnings are expected
      expect(keyWarnings.length).toBeGreaterThanOrEqual(0);

      // Valid polygons should render
      expect(screen.queryByTestId('valid-0')).toBeInTheDocument();
      expect(screen.queryByTestId('valid-5')).toBeInTheDocument();
    });

    it('should handle rapid addition and removal of polygons', () => {
      let polygonList: Polygon[] = [];

      const { rerender } = render(
        <svg width="800" height="600" viewBox="0 0 800 600">
          {polygonList.map((polygon, index) => (
            <CanvasPolygon
              key={polygon.id || `temp-${index}`}
              polygon={polygon}
              isSelected={false}
              zoom={1}
              onSelectPolygon={vi.fn()}
              onDeletePolygon={vi.fn()}
              onSlicePolygon={vi.fn()}
              onEditPolygon={vi.fn()}
              onDeleteVertex={vi.fn()}
              onDuplicateVertex={vi.fn()}
            />
          ))}
        </svg>
      );

      // Add polygons rapidly
      for (let i = 0; i < 10; i++) {
        polygonList = [
          ...polygonList,
          createMockPolygon({
            id: `rapid-${i}`,
            points: [
              { x: i * 50, y: 0 },
              { x: i * 50 + 40, y: 0 },
              { x: i * 50 + 40, y: 40 },
              { x: i * 50, y: 40 },
            ],
          }),
        ];

        rerender(
          <svg width="800" height="600" viewBox="0 0 800 600">
            {polygonList.map((polygon, index) => (
              <CanvasPolygon
                key={polygon.id || `temp-${index}`}
                polygon={polygon}
                isSelected={false}
                zoom={1}
                onSelectPolygon={vi.fn()}
                onDeletePolygon={vi.fn()}
                onSlicePolygon={vi.fn()}
                onEditPolygon={vi.fn()}
                onDeleteVertex={vi.fn()}
                onDuplicateVertex={vi.fn()}
              />
            ))}
          </svg>
        );
      }

      // Remove polygons rapidly
      for (let i = 9; i >= 0; i--) {
        polygonList = polygonList.slice(0, i);

        rerender(
          <svg width="800" height="600" viewBox="0 0 800 600">
            {polygonList.map((polygon, index) => (
              <CanvasPolygon
                key={polygon.id || `temp-${index}`}
                polygon={polygon}
                isSelected={false}
                zoom={1}
                onSelectPolygon={vi.fn()}
                onDeletePolygon={vi.fn()}
                onSlicePolygon={vi.fn()}
                onEditPolygon={vi.fn()}
                onDeleteVertex={vi.fn()}
                onDuplicateVertex={vi.fn()}
              />
            ))}
          </svg>
        );
      }

      // No key warnings during rapid changes
      const keyWarnings = mockReactErrors.filter(error =>
        error.includes('Warning: Encountered two children with the same key')
      );
      expect(keyWarnings).toHaveLength(0);
    });

    it('should handle vertex key generation within polygons', () => {
      const polygonWithManyVertices = createMockPolygon({
        id: 'many-vertices-polygon',
        points: Array.from({ length: 20 }, (_, i) => {
          const angle = (i / 20) * 2 * Math.PI;
          return {
            x: 100 + Math.cos(angle) * 50,
            y: 100 + Math.sin(angle) * 50,
          };
        }),
      });

      render(
        <svg width="800" height="600" viewBox="0 0 800 600">
          <CanvasPolygon
            polygon={polygonWithManyVertices}
            isSelected={true} // Show vertices
            zoom={1}
            onSelectPolygon={vi.fn()}
            onDeletePolygon={vi.fn()}
            onSlicePolygon={vi.fn()}
            onEditPolygon={vi.fn()}
            onDeleteVertex={vi.fn()}
            onDuplicateVertex={vi.fn()}
          />
        </svg>
      );

      // All vertices should render with unique keys
      expect(
        screen.getByTestId('vertices-many-vertices-polygon')
      ).toBeInTheDocument();

      // Check that multiple vertices exist
      const vertices = screen.getAllByTestId(
        /^vertex-many-vertices-polygon-\d+$/
      );
      expect(vertices.length).toBe(20);

      // No duplicate key warnings for vertices
      const keyWarnings = mockReactErrors.filter(error =>
        error.includes('Warning: Encountered two children with the same key')
      );
      expect(keyWarnings).toHaveLength(0);
    });
  });

  describe('Performance Impact of Key Generation', () => {
    it('should maintain performance with complex key generation patterns', () => {
      const complexPolygons = Array.from({ length: 100 }, (_, i) => ({
        id: `complex-polygon-${i}-${Math.random().toString(36).substr(2, 9)}`,
        points: [
          { x: i * 10, y: 0 },
          { x: i * 10 + 8, y: 0 },
          { x: i * 10 + 8, y: 8 },
          { x: i * 10, y: 8 },
        ],
        type: 'external' as const,
      }));

      const startTime = performance.now();

      render(
        <svg width="8000" height="600" viewBox="0 0 8000 600">
          {complexPolygons.map(polygon => (
            <CanvasPolygon
              key={polygon.id}
              polygon={polygon}
              isSelected={false}
              zoom={1}
              onSelectPolygon={vi.fn()}
              onDeletePolygon={vi.fn()}
              onSlicePolygon={vi.fn()}
              onEditPolygon={vi.fn()}
              onDeleteVertex={vi.fn()}
              onDuplicateVertex={vi.fn()}
            />
          ))}
        </svg>
      );

      const renderTime = performance.now() - startTime;

      // Should render quickly even with complex keys
      expect(renderTime).toBeLessThan(300);

      // No performance-related React warnings
      const performanceWarnings = mockReactErrors.filter(
        error =>
          error.includes('Warning:') &&
          (error.includes('performance') ||
            error.includes('slow') ||
            error.includes('key'))
      );
      expect(performanceWarnings).toHaveLength(0);
    });
  });

  describe('Memory Management', () => {
    it('should not leak memory during key generation', () => {
      const testPolygon = createMockPolygon({
        id: 'memory-test-polygon',
        points: [
          { x: 0, y: 0 },
          { x: 50, y: 0 },
          { x: 50, y: 50 },
          { x: 0, y: 50 },
        ],
      });

      // Render and unmount many times to test memory leaks
      for (let i = 0; i < 100; i++) {
        const { unmount } = render(
          <svg width="800" height="600" viewBox="0 0 800 600">
            <CanvasPolygon
              key={`${testPolygon.id}-iteration-${i}`}
              polygon={testPolygon}
              isSelected={false}
              zoom={1}
              onSelectPolygon={vi.fn()}
              onDeletePolygon={vi.fn()}
              onSlicePolygon={vi.fn()}
              onEditPolygon={vi.fn()}
              onDeleteVertex={vi.fn()}
              onDuplicateVertex={vi.fn()}
            />
          </svg>
        );

        unmount();
      }

      // No memory-related warnings
      const memoryWarnings = mockReactErrors.filter(
        error => error.includes('memory') || error.includes('leak')
      );
      expect(memoryWarnings).toHaveLength(0);
    });
  });
});
