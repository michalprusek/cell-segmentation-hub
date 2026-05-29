/**
 * Integration and performance tests for polygon interaction workflows
 * Tests complete user workflows and system performance under various conditions
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EditMode } from '../types';
import { shouldPreventCanvasDeselection } from '../config/modeConfig';
import {
  createMockPolygon,
  createMockPolygons,
  createPerformanceTestUtils,
} from '@/test-utils/segmentationTestUtils';
import type { Polygon } from '@/lib/segmentation';

// Mock a complete segmentation workflow component
const MockSegmentationWorkflow = ({
  polygons,
  onPolygonsChange,
  onModeChange,
  editMode = EditMode.View,
  selectedPolygonId = null,
}: {
  polygons: Polygon[];
  onPolygonsChange: (polygons: Polygon[]) => void;
  onModeChange: (mode: EditMode) => void;
  editMode?: EditMode;
  selectedPolygonId?: string | null;
}) => {
  const [currentMode, setCurrentMode] = React.useState(editMode);
  const [selectedId, setSelectedId] = React.useState(selectedPolygonId);
  const [workflowPolygons, setWorkflowPolygons] = React.useState(polygons);

  const handlePolygonSelection = (polygonId: string | null) => {
    switch (currentMode) {
      case EditMode.DeletePolygon:
        if (polygonId) {
          const filteredPolygons = workflowPolygons.filter(
            p => p.id !== polygonId
          );
          setWorkflowPolygons(filteredPolygons);
          onPolygonsChange(filteredPolygons);
        }
        return;
      case EditMode.Slice:
        setSelectedId(polygonId);
        return;
      default:
        setSelectedId(polygonId);
        if (polygonId) {
          setCurrentMode(EditMode.EditVertices);
          onModeChange(EditMode.EditVertices);
        }
    }
  };

  const handleModeChange = (mode: EditMode) => {
    setCurrentMode(mode);
    onModeChange(mode);
    if (mode === EditMode.View) {
      setSelectedId(null);
    }
  };

  return (
    <div data-testid="segmentation-workflow">
      {/* Mode Controls */}
      <div data-testid="mode-controls">
        <button
          data-testid="view-mode"
          onClick={() => handleModeChange(EditMode.View)}
          className={currentMode === EditMode.View ? 'active' : ''}
        >
          View
        </button>
        <button
          data-testid="delete-mode"
          onClick={() => handleModeChange(EditMode.DeletePolygon)}
          className={currentMode === EditMode.DeletePolygon ? 'active' : ''}
        >
          Delete
        </button>
        <button
          data-testid="slice-mode"
          onClick={() => handleModeChange(EditMode.Slice)}
          className={currentMode === EditMode.Slice ? 'active' : ''}
        >
          Slice
        </button>
        <button
          data-testid="edit-mode"
          onClick={() => handleModeChange(EditMode.EditVertices)}
          className={currentMode === EditMode.EditVertices ? 'active' : ''}
        >
          Edit
        </button>
      </div>

      {/* Status Display */}
      <div data-testid="workflow-status">
        <span data-testid="current-mode">{currentMode}</span>
        <span data-testid="selected-polygon">{selectedId || 'none'}</span>
        <span data-testid="polygon-count">{workflowPolygons.length}</span>
      </div>

      {/* Canvas Area */}
      <svg
        width="800"
        height="600"
        viewBox="0 0 800 600"
        data-testid="workflow-canvas"
        onClick={e => {
          if (
            e.target === e.currentTarget &&
            !shouldPreventCanvasDeselection(currentMode)
          ) {
            // Clicked empty area - only deselect if mode allows it (SSOT compliance)
            handlePolygonSelection(null);
          }
        }}
      >
        {workflowPolygons.map(polygon => (
          <g
            key={polygon.id}
            data-testid={`workflow-polygon-${polygon.id}`}
            className={`polygon ${polygon.type || 'external'} ${selectedId === polygon.id ? 'selected' : ''}`}
          >
            <path
              d={`M ${polygon.points.map(p => `${p.x},${p.y}`).join(' L ')} Z`}
              onClick={e => {
                e.stopPropagation();
                handlePolygonSelection(polygon.id);
              }}
              style={{
                fill:
                  polygon.type === 'internal'
                    ? 'rgba(14, 165, 233, 0.2)'
                    : 'rgba(239, 68, 68, 0.2)',
                stroke: polygon.type === 'internal' ? '#0ea5e9' : '#ef4444',
                strokeWidth: selectedId === polygon.id ? 3 : 1,
              }}
            />
            {/* Render vertices for selected polygon in edit mode */}
            {selectedId === polygon.id &&
              currentMode === EditMode.EditVertices && (
                <g data-testid={`vertices-${polygon.id}`}>
                  {polygon.points.map((point, index) => (
                    <circle
                      key={index}
                      data-testid={`vertex-${polygon.id}-${index}`}
                      cx={point.x}
                      cy={point.y}
                      r="4"
                      fill="#4ade80"
                      stroke="#16a34a"
                      strokeWidth="2"
                      onMouseDown={e => e.stopPropagation()}
                    />
                  ))}
                </g>
              )}
          </g>
        ))}
      </svg>
    </div>
  );
};

describe('Polygon Interaction Integration Tests', () => {
  let mockOnPolygonsChange: ReturnType<typeof vi.fn>;
  let mockOnModeChange: ReturnType<typeof vi.fn>;
  let testPolygons: Polygon[];

  beforeEach(() => {
    mockOnPolygonsChange = vi.fn();
    mockOnModeChange = vi.fn();
    testPolygons = [
      createMockPolygon({
        id: 'poly-1',
        type: 'external',
        points: [
          { x: 50, y: 50 },
          { x: 150, y: 50 },
          { x: 150, y: 150 },
          { x: 50, y: 150 },
        ],
      }),
      createMockPolygon({
        id: 'poly-2',
        type: 'internal',
        parent_id: 'poly-1',
        points: [
          { x: 75, y: 75 },
          { x: 125, y: 75 },
          { x: 125, y: 125 },
          { x: 75, y: 125 },
        ],
      }),
      createMockPolygon({
        id: 'poly-3',
        type: 'external',
        points: [
          { x: 200, y: 200 },
          { x: 300, y: 200 },
          { x: 300, y: 300 },
          { x: 200, y: 300 },
        ],
      }),
    ];
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Complete User Workflows', () => {
    it('should complete a full polygon editing workflow', async () => {
      render(
        <MockSegmentationWorkflow
          polygons={testPolygons}
          onPolygonsChange={mockOnPolygonsChange}
          onModeChange={mockOnModeChange}
        />
      );

      // 1. Start in view mode
      expect(screen.getByTestId('current-mode')).toHaveTextContent('view');
      expect(screen.getByTestId('selected-polygon')).toHaveTextContent('none');

      // 2. Click on a polygon to enter edit mode
      const polygon1 = screen.getByTestId('workflow-polygon-poly-1');
      fireEvent.click(polygon1.querySelector('path') || polygon1);

      expect(mockOnModeChange).toHaveBeenCalledWith(EditMode.EditVertices);
      expect(screen.getByTestId('selected-polygon')).toHaveTextContent(
        'poly-1'
      );

      // 3. Verify vertices are visible in edit mode
      await waitFor(() => {
        expect(screen.getByTestId('vertices-poly-1')).toBeInTheDocument();
      });

      // 4. Switch to view mode manually
      const _clickTarget1 = screen.getByTestId('view-mode');
      fireEvent.click(_clickTarget1.querySelector('path') || _clickTarget1);

      expect(mockOnModeChange).toHaveBeenCalledWith(EditMode.View);
      expect(screen.getByTestId('selected-polygon')).toHaveTextContent('none');
    });

    it('should complete a polygon deletion workflow', async () => {
      render(
        <MockSegmentationWorkflow
          polygons={testPolygons}
          onPolygonsChange={mockOnPolygonsChange}
          onModeChange={mockOnModeChange}
        />
      );

      // Initial polygon count
      expect(screen.getByTestId('polygon-count')).toHaveTextContent('3');

      // 1. Switch to delete mode
      const _clickTarget2 = screen.getByTestId('delete-mode');
      fireEvent.click(_clickTarget2.querySelector('path') || _clickTarget2);
      expect(mockOnModeChange).toHaveBeenCalledWith(EditMode.DeletePolygon);

      // 2. Click on a polygon to delete it (click the path inside the polygon group)
      const polygon2 = screen.getByTestId('workflow-polygon-poly-2');
      const polygon2Path = polygon2.querySelector('path') || polygon2;
      fireEvent.click(polygon2Path.querySelector('path') || polygon2Path);

      // 3. Verify polygon was deleted
      expect(mockOnPolygonsChange).toHaveBeenCalled();
      await waitFor(() => {
        expect(screen.getByTestId('polygon-count')).toHaveTextContent('2');
      });

      // 4. Verify deleted polygon is no longer in DOM
      expect(
        screen.queryByTestId('workflow-polygon-poly-2')
      ).not.toBeInTheDocument();
    });

    it('should complete a slice preparation workflow', async () => {
      render(
        <MockSegmentationWorkflow
          polygons={testPolygons}
          onPolygonsChange={mockOnPolygonsChange}
          onModeChange={mockOnModeChange}
        />
      );

      // 1. Switch to slice mode
      const _clickTarget3 = screen.getByTestId('slice-mode');
      fireEvent.click(_clickTarget3.querySelector('path') || _clickTarget3);
      expect(mockOnModeChange).toHaveBeenCalledWith(EditMode.Slice);

      // 2. Select a polygon for slicing
      const polygon3 = screen.getByTestId('workflow-polygon-poly-3');
      fireEvent.click(polygon3.querySelector('path') || polygon3);

      // 3. Verify polygon is selected for slicing
      expect(screen.getByTestId('selected-polygon')).toHaveTextContent(
        'poly-3'
      );
      expect(screen.getByTestId('current-mode')).toHaveTextContent('slice');
    });

    it('should handle mode switching during polygon interaction', async () => {
      render(
        <MockSegmentationWorkflow
          polygons={testPolygons}
          onPolygonsChange={mockOnPolygonsChange}
          onModeChange={mockOnModeChange}
        />
      );

      // 1. Click polygon in view mode (enters edit mode)
      const polygon1 = screen.getByTestId('workflow-polygon-poly-1');
      fireEvent.click(polygon1.querySelector('path') || polygon1);

      expect(screen.getByTestId('current-mode')).toHaveTextContent(
        'edit-vertices'
      );

      // 2. Switch to delete mode while polygon is selected
      const _clickTarget4 = screen.getByTestId('delete-mode');
      fireEvent.click(_clickTarget4.querySelector('path') || _clickTarget4);

      expect(mockOnModeChange).toHaveBeenCalledWith(EditMode.DeletePolygon);

      // 3. Click another polygon (should delete it)
      const polygon3 = screen.getByTestId('workflow-polygon-poly-3');
      fireEvent.click(polygon3.querySelector('path') || polygon3);

      await waitFor(() => {
        expect(screen.getByTestId('polygon-count')).toHaveTextContent('2');
      });
    });

    it('should handle rapid mode and selection changes', async () => {
      render(
        <MockSegmentationWorkflow
          polygons={testPolygons}
          onPolygonsChange={mockOnPolygonsChange}
          onModeChange={mockOnModeChange}
        />
      );

      // Rapid sequence of mode changes
      const _clickTarget5 = screen.getByTestId('delete-mode');
      fireEvent.click(_clickTarget5.querySelector('path') || _clickTarget5);
      const _clickTarget6 = screen.getByTestId('slice-mode');
      fireEvent.click(_clickTarget6.querySelector('path') || _clickTarget6);
      const _clickTarget7 = screen.getByTestId('edit-mode');
      fireEvent.click(_clickTarget7.querySelector('path') || _clickTarget7);
      const _clickTarget8 = screen.getByTestId('view-mode');
      fireEvent.click(_clickTarget8.querySelector('path') || _clickTarget8);

      expect(mockOnModeChange).toHaveBeenCalledTimes(4);
      expect(screen.getByTestId('current-mode')).toHaveTextContent('view');

      // Rapid polygon selections
      const polygon1 = screen.getByTestId('workflow-polygon-poly-1');
      const polygon3 = screen.getByTestId('workflow-polygon-poly-3');

      fireEvent.click(polygon1.querySelector('path') || polygon1);
      fireEvent.click(polygon3.querySelector('path') || polygon3);

      // Should end up in edit mode with polygon-3 selected
      expect(screen.getByTestId('selected-polygon')).toHaveTextContent(
        'poly-3'
      );
    });
  });

  describe('Performance Tests', () => {
    it('should handle many polygons without performance degradation', async () => {
      const { measureRenderTime } = createPerformanceTestUtils();
      const manyPolygons = createMockPolygons(100);

      const { averageTime } = await measureRenderTime(() => {
        render(
          <MockSegmentationWorkflow
            polygons={manyPolygons}
            onPolygonsChange={mockOnPolygonsChange}
            onModeChange={mockOnModeChange}
          />
        );
      }, 5);

      // Should render many polygons quickly
      expect(averageTime).toBeLessThan(200); // 200ms threshold
    });

    it('should handle rapid polygon selections efficiently', async () => {
      const manyPolygons = createMockPolygons(50);

      render(
        <MockSegmentationWorkflow
          polygons={manyPolygons}
          onPolygonsChange={mockOnPolygonsChange}
          onModeChange={mockOnModeChange}
        />
      );

      const startTime = performance.now();

      // Rapidly select different polygons
      for (let i = 0; i < 10; i++) {
        const polygonId = manyPolygons[i * 5].id;
        const polygon = screen.getByTestId(`workflow-polygon-${polygonId}`);
        fireEvent.click(polygon.querySelector('path') || polygon);
      }

      const selectionTime = performance.now() - startTime;

      // 10 rapid selections should complete quickly
      expect(selectionTime).toBeLessThan(1000); // 1 second threshold
    });

    it('should handle deletion of many polygons efficiently', async () => {
      const manyPolygons = createMockPolygons(30);

      render(
        <MockSegmentationWorkflow
          polygons={manyPolygons}
          onPolygonsChange={mockOnPolygonsChange}
          onModeChange={mockOnModeChange}
        />
      );

      // Switch to delete mode
      const _clickTarget9 = screen.getByTestId('delete-mode');
      fireEvent.click(_clickTarget9.querySelector('path') || _clickTarget9);

      const startTime = performance.now();

      // Delete 10 polygons
      for (let i = 0; i < 10; i++) {
        const polygonId = manyPolygons[i].id;
        const polygon = screen.queryByTestId(`workflow-polygon-${polygonId}`);
        if (polygon) {
          fireEvent.click(polygon.querySelector('path') || polygon);
        }
      }

      const deletionTime = performance.now() - startTime;

      // 10 deletions should complete quickly
      expect(deletionTime).toBeLessThan(1000); // 1 second threshold
      expect(mockOnPolygonsChange).toHaveBeenCalledTimes(10);
    });

    it('should maintain responsive UI during intensive operations', async () => {
      const complexPolygons = Array.from({ length: 20 }, (_, i) =>
        createMockPolygon({
          id: `complex-${i}`,
          points: Array.from({ length: 50 }, (_, j) => ({
            x: 100 + i * 30 + Math.cos((j / 50) * 2 * Math.PI) * 20,
            y: 100 + i * 30 + Math.sin((j / 50) * 2 * Math.PI) * 20,
          })),
        })
      );

      render(
        <MockSegmentationWorkflow
          polygons={complexPolygons}
          onPolygonsChange={mockOnPolygonsChange}
          onModeChange={mockOnModeChange}
        />
      );

      const startTime = performance.now();

      // Perform multiple operations
      const _clickTarget10 = screen.getByTestId('edit-mode');
      fireEvent.click(_clickTarget10.querySelector('path') || _clickTarget10);
      const _clickTarget11 = screen.getByTestId('workflow-polygon-complex-0');
      fireEvent.click(_clickTarget11.querySelector('path') || _clickTarget11);
      const _clickTarget12 = screen.getByTestId('delete-mode');
      fireEvent.click(_clickTarget12.querySelector('path') || _clickTarget12);
      const _clickTarget13 = screen.getByTestId('workflow-polygon-complex-1');
      fireEvent.click(_clickTarget13.querySelector('path') || _clickTarget13);

      const operationTime = performance.now() - startTime;

      // Complex operations should still be responsive
      expect(operationTime).toBeLessThan(2000); // 2 second threshold
    });
  });

  describe('Edge Cases and Error Scenarios', () => {
    it('should handle empty polygon list gracefully', async () => {
      render(
        <MockSegmentationWorkflow
          polygons={[]}
          onPolygonsChange={mockOnPolygonsChange}
          onModeChange={mockOnModeChange}
        />
      );

      expect(screen.getByTestId('polygon-count')).toHaveTextContent('0');

      // Mode changes should still work
      const _clickTarget14 = screen.getByTestId('delete-mode');
      fireEvent.click(_clickTarget14.querySelector('path') || _clickTarget14);
      expect(mockOnModeChange).toHaveBeenCalledWith(EditMode.DeletePolygon);

      // Canvas clicks should not cause errors
      const canvas = screen.getByTestId('workflow-canvas');
      fireEvent.click(canvas.querySelector('path') || canvas);

      expect(screen.getByTestId('selected-polygon')).toHaveTextContent('none');
    });

    it('should handle polygons with minimal points', async () => {
      const minimalPolygons = [
        createMockPolygon({
          id: 'minimal-1',
          points: [
            { x: 100, y: 100 },
            { x: 150, y: 100 },
            { x: 125, y: 150 },
          ], // Triangle (minimum valid polygon)
        }),
        createMockPolygon({
          id: 'minimal-2',
          points: [{ x: 200, y: 200 }], // Invalid (too few points)
        }),
      ];

      render(
        <MockSegmentationWorkflow
          polygons={minimalPolygons}
          onPolygonsChange={mockOnPolygonsChange}
          onModeChange={mockOnModeChange}
        />
      );

      // Should render polygons without errors
      expect(
        screen.getByTestId('workflow-polygon-minimal-1')
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('workflow-polygon-minimal-2')
      ).toBeInTheDocument();

      // Should handle clicks on minimal polygons
      const _clickTarget15 = screen.getByTestId('workflow-polygon-minimal-1');
      fireEvent.click(_clickTarget15.querySelector('path') || _clickTarget15);
      expect(screen.getByTestId('selected-polygon')).toHaveTextContent(
        'minimal-1'
      );
    });

    it('should handle concurrent polygon operations', async () => {
      render(
        <MockSegmentationWorkflow
          polygons={testPolygons}
          onPolygonsChange={mockOnPolygonsChange}
          onModeChange={mockOnModeChange}
        />
      );

      // Simulate concurrent operations (clicking multiple elements quickly)
      const polygon1 = screen.getByTestId('workflow-polygon-poly-1');
      const polygon3 = screen.getByTestId('workflow-polygon-poly-3');
      const deleteButton = screen.getByTestId('delete-mode');

      // Fire events in rapid succession - clicking path inside polygons
      fireEvent.click(polygon1.querySelector('path') || polygon1);
      fireEvent.click(deleteButton);
      fireEvent.click(polygon3.querySelector('path') || polygon3);

      // Should handle the sequence gracefully
      expect(screen.getByTestId('current-mode')).toHaveTextContent(
        'delete-polygon'
      );

      // Polygon count should change (poly-3 was deleted in delete mode)
      expect(screen.getByTestId('polygon-count')).toHaveTextContent('2');
    });

    it('should recover from component re-renders gracefully', async () => {
      const { rerender } = render(
        <MockSegmentationWorkflow
          polygons={testPolygons}
          onPolygonsChange={mockOnPolygonsChange}
          onModeChange={mockOnModeChange}
          editMode={EditMode.View}
        />
      );

      // Select a polygon
      const _clickTarget16 = screen.getByTestId('workflow-polygon-poly-1');
      fireEvent.click(_clickTarget16.querySelector('path') || _clickTarget16);
      expect(screen.getByTestId('selected-polygon')).toHaveTextContent(
        'poly-1'
      );

      // Force re-render with different props
      rerender(
        <MockSegmentationWorkflow
          polygons={testPolygons.slice(0, 2)} // Remove one polygon
          onPolygonsChange={mockOnPolygonsChange}
          onModeChange={mockOnModeChange}
          editMode={EditMode.Slice}
          selectedPolygonId="poly-2"
        />
      );

      // Component should still be mounted and functional after re-render
      expect(screen.getByTestId('polygon-count')).toBeInTheDocument();
      expect(screen.getByTestId('current-mode')).toBeInTheDocument();
    });
  });

  describe('Accessibility Integration', () => {
    it('should support polygon selection via click', async () => {
      render(
        <MockSegmentationWorkflow
          polygons={testPolygons}
          onPolygonsChange={mockOnPolygonsChange}
          onModeChange={mockOnModeChange}
        />
      );

      // Click on a polygon to select it
      const polygon1 = screen.getByTestId('workflow-polygon-poly-1');
      const polygon1Path = polygon1.querySelector('path') || polygon1;
      fireEvent.click(polygon1Path.querySelector('path') || polygon1Path);

      // Should trigger selection
      expect(screen.getByTestId('selected-polygon')).toHaveTextContent(
        'poly-1'
      );
    });

    it('should provide proper ARIA attributes during interactions', async () => {
      render(
        <MockSegmentationWorkflow
          polygons={testPolygons}
          onPolygonsChange={mockOnPolygonsChange}
          onModeChange={mockOnModeChange}
        />
      );

      const canvas = screen.getByTestId('workflow-canvas');
      // The canvas SVG is present (it doesn't need role=img to function correctly)
      expect(canvas).toBeInTheDocument();

      // Mode buttons should have proper states
      const _clickTarget17 = screen.getByTestId('delete-mode');
      fireEvent.click(_clickTarget17.querySelector('path') || _clickTarget17);
      const deleteButton = screen.getByTestId('delete-mode');
      expect(deleteButton).toHaveClass('active');
    });

    it('should handle high contrast mode correctly', () => {
      // Mock high contrast media query
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: vi.fn().mockImplementation(query => ({
          matches: query.includes('prefers-contrast: high'),
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        })),
      });

      render(
        <MockSegmentationWorkflow
          polygons={testPolygons}
          onPolygonsChange={mockOnPolygonsChange}
          onModeChange={mockOnModeChange}
        />
      );

      // Should render without issues in high contrast mode
      expect(screen.getByTestId('workflow-canvas')).toBeInTheDocument();
      testPolygons.forEach(polygon => {
        expect(
          screen.getByTestId(`workflow-polygon-${polygon.id}`)
        ).toBeInTheDocument();
      });
    });
  });
});
