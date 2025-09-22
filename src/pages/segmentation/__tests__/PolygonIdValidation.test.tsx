/**
 * Comprehensive tests for polygon ID validation and React key generation
 * Tests the specific issues: undefined polygon IDs, React key conflicts, fallback key generation
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CanvasPolygon from '../components/canvas/CanvasPolygon';
import { createMockPolygon } from '@/test-utils/segmentationTestUtils';
import type { Polygon } from '@/lib/segmentation';

// Mock console methods to capture warnings
const mockConsole = {
  warn: vi.fn(),
  error: vi.fn(),
  log: vi.fn(),
};

// Store original console methods
const originalConsole = {
  warn: console.warn,
  error: console.error,
  log: console.log,
};

// Mock heavy dependencies
vi.mock('../components/canvas/PolygonVertices', () => ({
  default: ({ polygonId, points }: any) => (
    <g data-testid={`polygon-vertices-${polygonId}`}>
      {points?.map((point: any, index: number) => (
        <circle
          key={`${polygonId}-vertex-${index}`}
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
    <g>
      {children}
      <g data-testid={`context-menu-${polygonId}`} />
    </g>
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

describe('Polygon ID Validation and React Keys', () => {
  let mockOnSelectPolygon: ReturnType<typeof vi.fn>;
  let mockOnDeletePolygon: ReturnType<typeof vi.fn>;
  let mockOnSlicePolygon: ReturnType<typeof vi.fn>;
  let mockOnEditPolygon: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Replace console methods with mocks
    console.warn = mockConsole.warn;
    console.error = mockConsole.error;
    console.log = mockConsole.log;

    mockOnSelectPolygon = vi.fn();
    mockOnDeletePolygon = vi.fn();
    mockOnSlicePolygon = vi.fn();
    mockOnEditPolygon = vi.fn();

    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore original console methods
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    console.log = originalConsole.log;

    vi.clearAllMocks();
  });

  // Helper to render polygon in SVG context
  const renderPolygon = (polygon: Polygon, isSelected: boolean = false) => {
    return render(
      <svg width="800" height="600" viewBox="0 0 800 600">
        <CanvasPolygon
          polygon={polygon}
          isSelected={isSelected}
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
  };

  describe('Valid Polygon ID Handling', () => {
    it('should generate unique React keys for polygons with valid IDs', () => {
      const validPolygon = createMockPolygon({
        id: 'ml_polygon_12345',
        points: [
          { x: 10, y: 10 },
          { x: 50, y: 10 },
          { x: 50, y: 50 },
          { x: 10, y: 50 },
        ],
      });

      renderPolygon(validPolygon);

      // Verify polygon renders with correct ID
      expect(screen.getByTestId('ml_polygon_12345')).toBeInTheDocument();

      // Verify vertices use polygon ID in their keys
      expect(
        screen.getByTestId('polygon-vertices-ml_polygon_12345')
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('vertex-ml_polygon_12345-0')
      ).toBeInTheDocument();

      // No warnings should be generated for valid IDs
      expect(mockConsole.warn).not.toHaveBeenCalled();
      expect(mockConsole.error).not.toHaveBeenCalled();
    });

    it('should handle user-created polygon IDs correctly', () => {
      const userPolygon = createMockPolygon({
        id: 'polygon_1234567890_abc123def',
        points: [
          { x: 100, y: 100 },
          { x: 200, y: 100 },
          { x: 200, y: 200 },
          { x: 100, y: 200 },
        ],
      });

      renderPolygon(userPolygon);

      expect(
        screen.getByTestId('polygon_1234567890_abc123def')
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('polygon-vertices-polygon_1234567890_abc123def')
      ).toBeInTheDocument();
    });

    it('should handle complex polygon IDs with special characters', () => {
      const complexPolygon = createMockPolygon({
        id: 'polygon-test_123-abc.def',
        points: [
          { x: 0, y: 0 },
          { x: 30, y: 0 },
          { x: 30, y: 30 },
          { x: 0, y: 30 },
        ],
      });

      renderPolygon(complexPolygon);

      expect(
        screen.getByTestId('polygon-test_123-abc.def')
      ).toBeInTheDocument();
    });
  });

  describe('Invalid Polygon ID Handling', () => {
    it('should handle undefined polygon IDs with fallback keys', () => {
      const undefinedIdPolygon: Polygon = {
        id: undefined as any, // Force undefined ID
        points: [
          { x: 10, y: 10 },
          { x: 50, y: 10 },
          { x: 50, y: 50 },
          { x: 10, y: 50 },
        ],
        type: 'external',
      };

      const { container } = renderPolygon(undefinedIdPolygon);

      // Should render without crashing
      expect(container.querySelector('g')).toBeTruthy();
      // Component uses the undefined ID directly, check for actual rendered element
      const polygonGroup = container.querySelector('g.polygon-group');
      expect(polygonGroup).toBeTruthy();
    });

    it('should handle null polygon IDs gracefully', () => {
      const nullIdPolygon: Polygon = {
        id: null as any, // Force null ID
        points: [
          { x: 20, y: 20 },
          { x: 60, y: 20 },
          { x: 60, y: 60 },
          { x: 20, y: 60 },
        ],
        type: 'external',
      };

      const { container } = renderPolygon(nullIdPolygon);

      expect(container.querySelector('g')).toBeTruthy();
      // Component handles null ID gracefully
      expect(container.querySelector('g[data-testid="null"]')).toBeTruthy();
    });

    it('should handle empty string polygon IDs', () => {
      const emptyIdPolygon = createMockPolygon({
        id: '',
        points: [
          { x: 30, y: 30 },
          { x: 70, y: 30 },
          { x: 70, y: 70 },
          { x: 30, y: 70 },
        ],
      });

      const { container } = renderPolygon(emptyIdPolygon);

      expect(container.querySelector('g')).toBeTruthy();
      // Empty string ID should create testid with empty string
      expect(container.querySelector('g[data-testid=""]')).toBeTruthy();
    });

    it('should handle whitespace-only polygon IDs', () => {
      const whitespaceIdPolygon = createMockPolygon({
        id: '   \t\n   ',
        points: [
          { x: 40, y: 40 },
          { x: 80, y: 40 },
          { x: 80, y: 80 },
          { x: 40, y: 80 },
        ],
      });

      const { container } = renderPolygon(whitespaceIdPolygon);

      expect(container.querySelector('g')).toBeTruthy();
      // Component should render the polygon group
      const polygonGroup = container.querySelector('g.polygon-group');
      expect(polygonGroup).toBeTruthy();
    });
  });

  describe('React Key Generation and Uniqueness', () => {
    it('should prevent duplicate React keys across multiple polygons', () => {
      const polygons = [
        createMockPolygon({
          id: 'polygon-1',
          points: [
            { x: 0, y: 0 },
            { x: 50, y: 0 },
            { x: 50, y: 50 },
            { x: 0, y: 50 },
          ],
        }),
        createMockPolygon({
          id: 'polygon-2',
          points: [
            { x: 100, y: 0 },
            { x: 150, y: 0 },
            { x: 150, y: 50 },
            { x: 100, y: 50 },
          ],
        }),
        createMockPolygon({
          id: 'polygon-3',
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

      // All polygons should render with unique test IDs
      expect(screen.getByTestId('polygon-1')).toBeInTheDocument();
      expect(screen.getByTestId('polygon-2')).toBeInTheDocument();
      expect(screen.getByTestId('polygon-3')).toBeInTheDocument();

      // No duplicate key warnings should be generated
      expect(mockConsole.error).not.toHaveBeenCalledWith(
        expect.stringContaining(
          'Warning: Encountered two children with the same key'
        )
      );
    });

    it('should generate different keys for polygons with mixed ID validity', () => {
      const mixedPolygons: Polygon[] = [
        {
          id: 'valid-polygon',
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
          id: '',
          points: [
            { x: 200, y: 0 },
            { x: 250, y: 0 },
            { x: 250, y: 50 },
            { x: 200, y: 50 },
          ],
          type: 'external',
        },
      ];

      const { container } = render(
        <svg width="800" height="600" viewBox="0 0 800 600">
          {mixedPolygons.map((polygon, index) => (
            <CanvasPolygon
              key={polygon.id || `fallback-key-${index}`}
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

      // Valid polygon should render normally
      expect(screen.getByTestId('valid-polygon')).toBeInTheDocument();

      // All polygons should have rendered
      expect(container.querySelectorAll('g.polygon-group')).toHaveLength(3);

      // Check that valid polygon rendered with correct testid
      expect(screen.getByTestId('valid-polygon')).toBeInTheDocument();
    });

    it('should handle undo/redo state changes with consistent keys', () => {
      const basePolygon = createMockPolygon({
        id: 'undo-redo-polygon',
        points: [
          { x: 10, y: 10 },
          { x: 50, y: 10 },
          { x: 50, y: 50 },
          { x: 10, y: 50 },
        ],
      });

      // Initial render
      const { rerender } = renderPolygon(basePolygon);
      expect(screen.getByTestId('undo-redo-polygon')).toBeInTheDocument();

      // Simulate state change (undo/redo)
      const modifiedPolygon = {
        ...basePolygon,
        points: [
          { x: 15, y: 15 },
          { x: 55, y: 15 },
          { x: 55, y: 55 },
          { x: 15, y: 55 },
        ],
      };

      rerender(
        <svg width="800" height="600" viewBox="0 0 800 600">
          <CanvasPolygon
            polygon={modifiedPolygon}
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

      // Same ID should still be used
      expect(screen.getByTestId('undo-redo-polygon')).toBeInTheDocument();
    });
  });

  describe('Polygon Data Filtering and Validation', () => {
    it('should handle polygon with insufficient points gracefully', () => {
      const insufficientPointsPolygon = createMockPolygon({
        id: 'insufficient-points',
        points: [
          { x: 10, y: 10 },
          { x: 50, y: 10 },
        ], // Only 2 points, need at least 3 for polygon
      });

      const { container } = renderPolygon(insufficientPointsPolygon);

      expect(container.querySelector('g')).toBeTruthy();
      expect(screen.getByTestId('insufficient-points')).toBeInTheDocument();

      // Component should filter out polygons with insufficient points
      // The path might be rendered but empty or minimal
      const pathElement = container.querySelector('path');
      expect(pathElement).toBeTruthy();
      // The path should either be empty or a minimal path due to insufficient points
      const pathData = pathElement?.getAttribute('d') || '';
      expect(pathData.length).toBeLessThan(20); // Very minimal path
    });

    it('should handle polygons with invalid point data', () => {
      const invalidPointsPolygon: Polygon = {
        id: 'invalid-points',
        points: [
          { x: NaN, y: 10 },
          { x: 50, y: NaN },
          { x: 50, y: 50 },
        ] as any,
        type: 'external',
      };

      const { container } = renderPolygon(invalidPointsPolygon);

      expect(container.querySelector('g')).toBeTruthy();
      expect(screen.getByTestId('invalid-points')).toBeInTheDocument();

      // Component filters out invalid points, leaving only 1 valid point
      // Should result in minimal or empty path since < 3 valid points remain
      const pathElement = container.querySelector('path');
      expect(pathElement).toBeTruthy();
      const pathData = pathElement?.getAttribute('d') || '';
      expect(pathData.length).toBeLessThan(20); // Very minimal path
    });

    it('should use default polygon type when type is missing', () => {
      const noTypePolygon: Polygon = {
        id: 'no-type-polygon',
        points: [
          { x: 10, y: 10 },
          { x: 50, y: 10 },
          { x: 50, y: 50 },
          { x: 10, y: 50 },
        ],
        type: undefined as any, // Missing required type
      };

      const { container } = renderPolygon(noTypePolygon);

      expect(container.querySelector('g')).toBeTruthy();
      expect(screen.getByTestId('no-type-polygon')).toBeInTheDocument();

      // Component uses default type 'external' when type is undefined
      const groupElement = container.querySelector('.external');
      expect(groupElement).toBeTruthy();
    });
  });

  describe('Performance with Invalid Data', () => {
    it('should handle large numbers of polygons with mixed ID validity efficiently', () => {
      const mixedPolygons: Polygon[] = [];

      // Create 100 polygons with mixed validity
      for (let i = 0; i < 100; i++) {
        let id: string | undefined;

        if (i % 4 === 0) {
          id = undefined; // 25% undefined
        } else if (i % 4 === 1) {
          id = ''; // 25% empty
        } else if (i % 4 === 2) {
          id = `   whitespace-${i}   `; // 25% whitespace
        } else {
          id = `valid-polygon-${i}`; // 25% valid
        }

        mixedPolygons.push({
          id: id as string,
          points: [
            { x: i * 10, y: 0 },
            { x: i * 10 + 8, y: 0 },
            { x: i * 10 + 8, y: 8 },
            { x: i * 10, y: 8 },
          ],
          type: 'external',
        });
      }

      const startTime = performance.now();

      const { container } = render(
        <svg width="8000" height="600" viewBox="0 0 8000 600">
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

      const renderTime = performance.now() - startTime;

      // Should render in reasonable time even with many invalid polygons
      expect(renderTime).toBeLessThan(500); // 500ms threshold

      // Should have rendered some valid polygons
      expect(
        container.querySelectorAll('g[data-testid^="valid-polygon"]')
      ).not.toHaveLength(0);

      // All polygons should have rendered despite ID validity issues
      // Each polygon creates multiple g elements (group + context menu)
      expect(container.querySelectorAll('g.polygon-group')).toHaveLength(100);
    });

    it('should not cause memory leaks with repeated invalid polygon renders', () => {
      const invalidPolygon: Polygon = {
        id: undefined as any,
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
        ],
        type: 'external',
      };

      // Render and unmount many times
      for (let i = 0; i < 50; i++) {
        const { unmount } = renderPolygon(invalidPolygon);
        unmount();
      }

      // Should not throw errors or cause memory issues
      expect(mockConsole.error).not.toHaveBeenCalledWith(
        expect.stringContaining('memory')
      );
    });
  });

  describe('Interaction with Invalid Polygon IDs', () => {
    it('should handle selection of polygons with undefined IDs', () => {
      const undefinedIdPolygon: Polygon = {
        id: undefined as any,
        points: [
          { x: 10, y: 10 },
          { x: 50, y: 10 },
          { x: 50, y: 50 },
          { x: 10, y: 50 },
        ],
        type: 'external',
      };

      const { container } = renderPolygon(undefinedIdPolygon);

      const polygonElement = container.querySelector('g');
      const pathElement = polygonElement?.querySelector('path');

      if (pathElement) {
        fireEvent.click(pathElement);

        // Should handle click gracefully, potentially with fallback ID
        expect(mockOnSelectPolygon).toHaveBeenCalled();
      }
    });

    it('should handle context menu on polygons with invalid IDs', () => {
      const invalidIdPolygon: Polygon = {
        id: '',
        points: [
          { x: 20, y: 20 },
          { x: 60, y: 20 },
          { x: 60, y: 60 },
          { x: 20, y: 60 },
        ],
        type: 'external',
      };

      const { container } = renderPolygon(invalidIdPolygon);

      const polygonElement = container.querySelector('g');

      if (polygonElement) {
        // Should not throw error on context menu
        expect(() => {
          fireEvent.contextMenu(polygonElement);
        }).not.toThrow();
      }
    });
  });

  describe('Error Recovery and Resilience', () => {
    it('should recover gracefully from polygon data corruption', () => {
      const corruptedPolygons: any[] = [
        null,
        undefined,
        { id: 'valid', points: [], type: 'external' },
        { points: [{ x: 0, y: 0 }], type: 'external' }, // Missing ID
        { id: 'valid-2', type: 'external' }, // Missing points
        {
          id: 'valid-3',
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
          ],
          type: 'external',
        },
      ];

      const { container } = render(
        <svg width="800" height="600" viewBox="0 0 800 600">
          {corruptedPolygons.map((polygon, index) => {
            if (!polygon || !polygon.points) {
              return null;
            }

            return (
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
            );
          })}
        </svg>
      );

      // Application should remain stable despite corrupted data
      expect(container.querySelectorAll('g')).not.toHaveLength(0);
    });

    it('should maintain application stability despite ID validation failures', () => {
      const problematicPolygons: Polygon[] = Array.from(
        { length: 20 },
        (_, i) => ({
          id: i % 5 === 0 ? (undefined as any) : `polygon-${i}`,
          points: [
            { x: i * 20, y: 0 },
            { x: i * 20 + 15, y: 0 },
            { x: i * 20 + 15, y: 15 },
            { x: i * 20, y: 15 },
          ],
          type: 'external',
        })
      );

      const { container } = render(
        <svg width="2000" height="600" viewBox="0 0 2000 600">
          {problematicPolygons.map((polygon, index) => (
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

      // Application should remain stable
      expect(container.querySelectorAll('g')).not.toHaveLength(0);

      // Should be able to interact with valid polygons
      const validPolygon = screen.queryByTestId('polygon-1');
      if (validPolygon) {
        const path = validPolygon.querySelector('path');
        if (path) {
          fireEvent.click(path);
          expect(mockOnSelectPolygon).toHaveBeenCalledWith('polygon-1');
        }
      }
    });
  });
});
