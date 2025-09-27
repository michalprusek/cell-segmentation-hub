/**
 * End-to-End Tests for Vertex Context Menu Functionality
 * Tests complete user workflows using Playwright-style testing for vertex deletion
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  AllProviders,
} from '@/test-utils/reactTestUtils';
import { Polygon } from '@/lib/segmentation';
import { EditMode } from '../types';
import SegmentationEditor from '../SegmentationEditor';

// Mock browser APIs
Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  value: vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  })),
});

Object.defineProperty(window, 'requestIdleCallback', {
  writable: true,
  value: vi.fn(cb => setTimeout(cb, 1)),
});

Object.defineProperty(window, 'cancelIdleCallback', {
  writable: true,
  value: vi.fn(),
});

// Mock WebGL context
Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  writable: true,
  value: vi.fn().mockImplementation(contextType => {
    if (contextType === 'webgl' || contextType === 'experimental-webgl') {
      return {
        canvas: document.createElement('canvas'),
        drawingBufferWidth: 300,
        drawingBufferHeight: 200,
        getParameter: vi.fn(),
        createShader: vi.fn(),
        shaderSource: vi.fn(),
        compileShader: vi.fn(),
        createProgram: vi.fn(),
        attachShader: vi.fn(),
        linkProgram: vi.fn(),
        useProgram: vi.fn(),
        createBuffer: vi.fn(),
        bindBuffer: vi.fn(),
        bufferData: vi.fn(),
        getAttribLocation: vi.fn(),
        enableVertexAttribArray: vi.fn(),
        vertexAttribPointer: vi.fn(),
        getUniformLocation: vi.fn(),
        uniform2f: vi.fn(),
        uniform1f: vi.fn(),
        clearColor: vi.fn(),
        clear: vi.fn(),
        drawArrays: vi.fn(),
        viewport: vi.fn(),
        VERTEX_SHADER: 35633,
        FRAGMENT_SHADER: 35632,
        ARRAY_BUFFER: 34962,
        STATIC_DRAW: 35044,
        TRIANGLES: 4,
        COLOR_BUFFER_BIT: 16384,
      };
    }
    return null;
  }),
});

// Mock image loading
Object.defineProperty(Image.prototype, 'src', {
  set: function (src) {
    setTimeout(() => {
      this.onload?.();
    }, 0);
  },
});

// Mock toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

// Mock file operations
vi.mock('@/lib/exportUtils', () => ({
  downloadBlob: vi.fn(),
  createCocoExport: vi.fn(() => Promise.resolve(new Blob())),
}));

describe('Vertex Context Menu E2E Tests', () => {
  const testPolygon: Polygon = {
    id: 'test-polygon-1',
    points: [
      { x: 50, y: 50 },
      { x: 150, y: 50 },
      { x: 150, y: 150 },
      { x: 100, y: 200 },
      { x: 50, y: 150 },
    ],
    confidence: 0.95,
    type: 'external',
  };

  const minimumPolygon: Polygon = {
    id: 'min-polygon-1',
    points: [
      { x: 10, y: 10 },
      { x: 60, y: 10 },
      { x: 35, y: 60 },
    ],
    confidence: 0.9,
    type: 'external',
  };

  const defaultProps = {
    imageUrl:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    initialPolygons: [testPolygon],
    onPolygonsChange: vi.fn(),
    onSave: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Complete User Workflow - Happy Path', () => {
    it('successfully completes vertex deletion workflow', async () => {
      const onPolygonsChange = vi.fn();

      render(
        <AllProviders>
          <div style={{ width: '800px', height: '600px' }}>
            <SegmentationEditor
              {...defaultProps}
              onPolygonsChange={onPolygonsChange}
            />
          </div>
        </AllProviders>
      );

      // Wait for editor to load
      await waitFor(
        () => {
          expect(screen.getByTestId('segmentation-editor')).toBeInTheDocument();
        },
        { timeout: 5000 }
      );

      // Step 1: Select the polygon by clicking on it
      const polygonElement = screen.getByTestId(
        'canvas-polygon-test-polygon-1'
      );
      expect(polygonElement).toBeInTheDocument();

      fireEvent.click(polygonElement);

      await waitFor(() => {
        expect(polygonElement).toHaveClass('selected');
      });

      // Step 2: Switch to Edit Vertices mode
      const editVerticesButton = screen.getByRole('button', {
        name: /edit.*vertices/i,
      });
      fireEvent.click(editVerticesButton);

      await waitFor(() => {
        expect(screen.getByTestId('mode-legend')).toHaveTextContent(
          /edit.*vertices/i
        );
      });

      // Step 3: Verify vertices are visible
      const vertices = screen.getAllByTestId(/vertex-.*-test-polygon-1/);
      expect(vertices).toHaveLength(5); // Original 5 vertices

      // Step 4: Right-click on a vertex (vertex index 2)
      const targetVertex = vertices[2];
      fireEvent.contextMenu(targetVertex, {
        clientX: 150,
        clientY: 150,
      });

      // Step 5: Verify context menu appears
      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument();
      });

      const deleteMenuItem = screen.getByRole('menuitem', {
        name: /delete.*vertex/i,
      });
      expect(deleteMenuItem).toBeInTheDocument();
      expect(deleteMenuItem).toHaveClass('text-red-600'); // Destructive styling

      // Step 6: Click delete vertex
      fireEvent.click(deleteMenuItem);

      // Step 7: Verify vertex was deleted
      await waitFor(() => {
        expect(onPolygonsChange).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({
              id: 'test-polygon-1',
              points: expect.arrayContaining([
                { x: 50, y: 50 },
                { x: 150, y: 50 },
                { x: 100, y: 200 }, // Vertex at index 2 (150, 150) should be removed
                { x: 50, y: 150 },
              ]),
            }),
          ])
        );
      });

      // Step 8: Verify polygon remains selected after deletion
      await waitFor(() => {
        const updatedPolygon = screen.getByTestId(
          'canvas-polygon-test-polygon-1'
        );
        expect(updatedPolygon).toHaveClass('selected');
      });

      // Step 9: Verify vertex count decreased
      await waitFor(() => {
        const remainingVertices = screen.getAllByTestId(
          /vertex-.*-test-polygon-1/
        );
        expect(remainingVertices).toHaveLength(4);
      });
    });
  });

  describe('Error Cases and Validation', () => {
    it('prevents deletion when polygon has minimum vertices', async () => {
      const onPolygonsChange = vi.fn();

      render(
        <AllProviders>
          <div style={{ width: '800px', height: '600px' }}>
            <SegmentationEditor
              {...defaultProps}
              initialPolygons={[minimumPolygon]}
              onPolygonsChange={onPolygonsChange}
            />
          </div>
        </AllProviders>
      );

      await waitFor(() => {
        expect(screen.getByTestId('segmentation-editor')).toBeInTheDocument();
      });

      // Select polygon and switch to edit mode
      const polygonElement = screen.getByTestId('canvas-polygon-min-polygon-1');
      fireEvent.click(polygonElement);

      const editVerticesButton = screen.getByRole('button', {
        name: /edit.*vertices/i,
      });
      fireEvent.click(editVerticesButton);

      await waitFor(() => {
        const vertices = screen.getAllByTestId(/vertex-.*-min-polygon-1/);
        expect(vertices).toHaveLength(3);
      });

      // Try to delete a vertex
      const vertices = screen.getAllByTestId(/vertex-.*-min-polygon-1/);
      fireEvent.contextMenu(vertices[1]);

      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument();
      });

      const deleteMenuItem = screen.getByRole('menuitem', {
        name: /delete.*vertex/i,
      });
      fireEvent.click(deleteMenuItem);

      // Should show error message and not delete
      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(
          /minimum.*3.*vertices/i
        );
      });

      // Polygon should still have 3 vertices
      expect(onPolygonsChange).not.toHaveBeenCalled();

      const remainingVertices = screen.getAllByTestId(
        /vertex-.*-min-polygon-1/
      );
      expect(remainingVertices).toHaveLength(3);
    });

    it('shows context menu only in EditVertices mode', async () => {
      render(
        <AllProviders>
          <div style={{ width: '800px', height: '600px' }}>
            <SegmentationEditor {...defaultProps} />
          </div>
        </AllProviders>
      );

      await waitFor(() => {
        expect(screen.getByTestId('segmentation-editor')).toBeInTheDocument();
      });

      // In View mode, right-click on polygon should not show vertex context menu
      const polygonElement = screen.getByTestId(
        'canvas-polygon-test-polygon-1'
      );
      fireEvent.contextMenu(polygonElement);

      // Should not show vertex context menu
      await waitFor(
        () => {
          expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        },
        { timeout: 1000 }
      );

      // Now select polygon and switch to edit mode
      fireEvent.click(polygonElement);

      const editVerticesButton = screen.getByRole('button', {
        name: /edit.*vertices/i,
      });
      fireEvent.click(editVerticesButton);

      await waitFor(() => {
        const vertices = screen.getAllByTestId(/vertex-.*-test-polygon-1/);
        expect(vertices).toHaveLength(5);
      });

      // Now right-click should show context menu
      const vertices = screen.getAllByTestId(/vertex-.*-test-polygon-1/);
      fireEvent.contextMenu(vertices[0]);

      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument();
      });
    });
  });

  describe('Event Isolation and Interference', () => {
    it('prevents polygon deselection during vertex context menu', async () => {
      render(
        <AllProviders>
          <div style={{ width: '800px', height: '600px' }}>
            <SegmentationEditor {...defaultProps} />
          </div>
        </AllProviders>
      );

      await waitFor(() => {
        expect(screen.getByTestId('segmentation-editor')).toBeInTheDocument();
      });

      // Select polygon and enter edit mode
      const polygonElement = screen.getByTestId(
        'canvas-polygon-test-polygon-1'
      );
      fireEvent.click(polygonElement);

      const editVerticesButton = screen.getByRole('button', {
        name: /edit.*vertices/i,
      });
      fireEvent.click(editVerticesButton);

      await waitFor(() => {
        expect(polygonElement).toHaveClass('selected');
      });

      // Right-click on vertex
      const vertices = screen.getAllByTestId(/vertex-.*-test-polygon-1/);
      fireEvent.contextMenu(vertices[1]);

      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument();
      });

      // Polygon should remain selected
      expect(polygonElement).toHaveClass('selected');

      // Close context menu by clicking elsewhere
      fireEvent.click(document.body);

      await waitFor(() => {
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      });

      // Polygon should still be selected
      expect(polygonElement).toHaveClass('selected');
    });

    it('allows slice mode to work with non-vertex right-clicks', async () => {
      render(
        <AllProviders>
          <div style={{ width: '800px', height: '600px' }}>
            <SegmentationEditor {...defaultProps} />
          </div>
        </AllProviders>
      );

      await waitFor(() => {
        expect(screen.getByTestId('segmentation-editor')).toBeInTheDocument();
      });

      // Select polygon
      const polygonElement = screen.getByTestId(
        'canvas-polygon-test-polygon-1'
      );
      fireEvent.click(polygonElement);

      // Switch to slice mode
      const sliceButton = screen.getByRole('button', { name: /slice/i });
      fireEvent.click(sliceButton);

      await waitFor(() => {
        expect(screen.getByTestId('mode-legend')).toHaveTextContent(/slice/i);
      });

      // Right-click on canvas (not on vertex) should work for slice mode
      const canvas = screen.getByTestId('canvas-container');
      fireEvent.contextMenu(canvas, {
        clientX: 200,
        clientY: 200,
      });

      // Should show slice mode instructions, not vertex context menu
      await waitFor(() => {
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      });
    });
  });

  describe('Multiple Vertices and Sequential Operations', () => {
    it('handles multiple vertex deletions in sequence', async () => {
      const onPolygonsChange = vi.fn();

      render(
        <AllProviders>
          <div style={{ width: '800px', height: '600px' }}>
            <SegmentationEditor
              {...defaultProps}
              onPolygonsChange={onPolygonsChange}
            />
          </div>
        </AllProviders>
      );

      await waitFor(() => {
        expect(screen.getByTestId('segmentation-editor')).toBeInTheDocument();
      });

      // Setup: Select polygon and enter edit mode
      const polygonElement = screen.getByTestId(
        'canvas-polygon-test-polygon-1'
      );
      fireEvent.click(polygonElement);

      const editVerticesButton = screen.getByRole('button', {
        name: /edit.*vertices/i,
      });
      fireEvent.click(editVerticesButton);

      // First deletion
      await waitFor(() => {
        const vertices = screen.getAllByTestId(/vertex-.*-test-polygon-1/);
        expect(vertices).toHaveLength(5);
      });

      let vertices = screen.getAllByTestId(/vertex-.*-test-polygon-1/);
      fireEvent.contextMenu(vertices[4]); // Delete last vertex

      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument();
      });

      let deleteMenuItem = screen.getByRole('menuitem', {
        name: /delete.*vertex/i,
      });
      fireEvent.click(deleteMenuItem);

      await waitFor(() => {
        expect(onPolygonsChange).toHaveBeenCalled();
      });

      // Second deletion
      await waitFor(() => {
        vertices = screen.getAllByTestId(/vertex-.*-test-polygon-1/);
        expect(vertices).toHaveLength(4);
      });

      fireEvent.contextMenu(vertices[3]); // Delete new last vertex

      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument();
      });

      deleteMenuItem = screen.getByRole('menuitem', {
        name: /delete.*vertex/i,
      });
      fireEvent.click(deleteMenuItem);

      // Should now have 3 vertices (minimum)
      await waitFor(() => {
        vertices = screen.getAllByTestId(/vertex-.*-test-polygon-1/);
        expect(vertices).toHaveLength(3);
      });

      // Third deletion attempt should fail
      fireEvent.contextMenu(vertices[2]);

      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument();
      });

      deleteMenuItem = screen.getByRole('menuitem', {
        name: /delete.*vertex/i,
      });
      fireEvent.click(deleteMenuItem);

      // Should show error and maintain 3 vertices
      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(
          /minimum.*3.*vertices/i
        );
      });

      vertices = screen.getAllByTestId(/vertex-.*-test-polygon-1/);
      expect(vertices).toHaveLength(3);
    });
  });

  describe('Accessibility and Keyboard Navigation', () => {
    it('supports keyboard navigation in context menu', async () => {
      render(
        <AllProviders>
          <div style={{ width: '800px', height: '600px' }}>
            <SegmentationEditor {...defaultProps} />
          </div>
        </AllProviders>
      );

      await waitFor(() => {
        expect(screen.getByTestId('segmentation-editor')).toBeInTheDocument();
      });

      // Setup
      const polygonElement = screen.getByTestId(
        'canvas-polygon-test-polygon-1'
      );
      fireEvent.click(polygonElement);

      const editVerticesButton = screen.getByRole('button', {
        name: /edit.*vertices/i,
      });
      fireEvent.click(editVerticesButton);

      // Open context menu
      const vertices = screen.getAllByTestId(/vertex-.*-test-polygon-1/);
      fireEvent.contextMenu(vertices[1]);

      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument();
      });

      const deleteMenuItem = screen.getByRole('menuitem', {
        name: /delete.*vertex/i,
      });

      // Should be focusable
      deleteMenuItem.focus();
      expect(document.activeElement).toBe(deleteMenuItem);

      // Should have proper ARIA attributes
      expect(deleteMenuItem).toHaveAttribute('role', 'menuitem');
      expect(deleteMenuItem).toHaveAttribute('tabIndex', '0');

      // Should be activatable with Enter key
      fireEvent.keyDown(deleteMenuItem, { key: 'Enter', code: 'Enter' });
      fireEvent.click(deleteMenuItem); // Simulate the click that happens on Enter

      await waitFor(() => {
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      });
    });

    it('provides proper screen reader labels', async () => {
      render(
        <AllProviders>
          <div style={{ width: '800px', height: '600px' }}>
            <SegmentationEditor {...defaultProps} />
          </div>
        </AllProviders>
      );

      await waitFor(() => {
        expect(screen.getByTestId('segmentation-editor')).toBeInTheDocument();
      });

      // Setup
      const polygonElement = screen.getByTestId(
        'canvas-polygon-test-polygon-1'
      );
      fireEvent.click(polygonElement);

      const editVerticesButton = screen.getByRole('button', {
        name: /edit.*vertices/i,
      });
      fireEvent.click(editVerticesButton);

      // Open context menu
      const vertices = screen.getAllByTestId(/vertex-.*-test-polygon-1/);
      fireEvent.contextMenu(vertices[2]);

      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument();
      });

      // Menu should have proper label
      const menu = screen.getByRole('menu');
      expect(menu).toHaveAttribute('aria-label', 'Vertex options');

      // Delete item should have proper content
      const deleteMenuItem = screen.getByRole('menuitem', {
        name: /delete.*vertex/i,
      });
      expect(deleteMenuItem).toHaveTextContent('Delete Vertex');

      // Should have destructive styling for screen readers
      expect(deleteMenuItem).toHaveClass('text-red-600');
    });
  });

  describe('Performance Under Load', () => {
    it('handles complex polygon with many vertices efficiently', async () => {
      // Create polygon with many vertices
      const complexPolygon: Polygon = {
        id: 'complex-polygon',
        points: Array.from({ length: 20 }, (_, i) => ({
          x: 100 + Math.cos((i / 20) * 2 * Math.PI) * 80,
          y: 100 + Math.sin((i / 20) * 2 * Math.PI) * 80,
        })),
        confidence: 0.9,
        type: 'external',
      };

      const startTime = performance.now();

      render(
        <AllProviders>
          <div style={{ width: '800px', height: '600px' }}>
            <SegmentationEditor
              {...defaultProps}
              initialPolygons={[complexPolygon]}
            />
          </div>
        </AllProviders>
      );

      await waitFor(() => {
        expect(screen.getByTestId('segmentation-editor')).toBeInTheDocument();
      });

      const renderTime = performance.now() - startTime;
      expect(renderTime).toBeLessThan(1000); // Should render quickly

      // Setup
      const polygonElement = screen.getByTestId(
        'canvas-polygon-complex-polygon'
      );
      fireEvent.click(polygonElement);

      const editVerticesButton = screen.getByRole('button', {
        name: /edit.*vertices/i,
      });
      fireEvent.click(editVerticesButton);

      // Should render all vertices efficiently
      await waitFor(() => {
        const vertices = screen.getAllByTestId(/vertex-.*-complex-polygon/);
        expect(vertices).toHaveLength(20);
      });

      // Context menu should work smoothly even with many vertices
      const vertices = screen.getAllByTestId(/vertex-.*-complex-polygon/);
      fireEvent.contextMenu(vertices[10]);

      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument();
      });

      const deleteMenuItem = screen.getByRole('menuitem', {
        name: /delete.*vertex/i,
      });
      fireEvent.click(deleteMenuItem);

      await waitFor(() => {
        const remainingVertices = screen.getAllByTestId(
          /vertex-.*-complex-polygon/
        );
        expect(remainingVertices).toHaveLength(19);
      });
    });
  });

  describe('Cross-Browser Compatibility Simulation', () => {
    it('handles different event coordinates correctly', async () => {
      render(
        <AllProviders>
          <div style={{ width: '800px', height: '600px' }}>
            <SegmentationEditor {...defaultProps} />
          </div>
        </AllProviders>
      );

      await waitFor(() => {
        expect(screen.getByTestId('segmentation-editor')).toBeInTheDocument();
      });

      // Setup
      const polygonElement = screen.getByTestId(
        'canvas-polygon-test-polygon-1'
      );
      fireEvent.click(polygonElement);

      const editVerticesButton = screen.getByRole('button', {
        name: /edit.*vertices/i,
      });
      fireEvent.click(editVerticesButton);

      // Test different coordinate systems (simulate browser differences)
      const vertices = screen.getAllByTestId(/vertex-.*-test-polygon-1/);

      // Test with different clientX/Y values
      const coordinateTests = [
        { clientX: 100, clientY: 100 },
        { clientX: 0, clientY: 0 },
        { clientX: 800, clientY: 600 },
      ];

      for (const coords of coordinateTests) {
        fireEvent.contextMenu(vertices[1], coords);

        await waitFor(() => {
          expect(screen.getByRole('menu')).toBeInTheDocument();
        });

        // Close menu
        fireEvent.click(document.body);

        await waitFor(() => {
          expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        });
      }
    });
  });
});
