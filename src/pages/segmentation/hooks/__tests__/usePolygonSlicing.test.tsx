import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import React from 'react';
import { usePolygonSlicing } from '../usePolygonSlicing';
import { EditMode } from '../../types';
import {
  createMockInteractionState,
  mockBrowserAPIs,
} from '@/test-utils/reactTestUtils';
import {
  createTestPolygons,
  createTestPolygonObjects,
} from '@/test-utils/polygonTestUtils';
import type { Polygon, Point } from '@/lib/segmentation';

// Mock external dependencies
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: vi.fn(() => ({
    t: (key: string) => key, // Return the key for testing
  })),
  LanguageProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/lib/polygonSlicing', () => ({
  slicePolygon: vi.fn(),
  validateSliceLine: vi.fn(),
}));

vi.mock('@/lib/errorUtils', () => ({
  getLocalizedErrorMessage: vi.fn((key: string) => key),
}));

import { slicePolygon, validateSliceLine } from '@/lib/polygonSlicing';

describe('usePolygonSlicing', () => {
  let testPolygons: ReturnType<typeof createTestPolygons>;
  let testPolygonObjects: ReturnType<typeof createTestPolygonObjects>;
  let mockProps: {
    polygons: Polygon[];
    selectedPolygonId: string | null;
    tempPoints: Point[];
    interactionState: any;
    setSelectedPolygonId: vi.Mock;
    setTempPoints: vi.Mock;
    setInteractionState: vi.Mock;
    setEditMode: vi.Mock;
    updatePolygons: vi.Mock;
  };

  beforeEach(() => {
    // Setup browser APIs for testing
    mockBrowserAPIs();

    testPolygons = createTestPolygons();
    testPolygonObjects = createTestPolygonObjects();

    mockProps = {
      polygons: [testPolygonObjects.squarePolygon],
      selectedPolygonId: testPolygonObjects.squarePolygon.id,
      tempPoints: [],
      interactionState: createMockInteractionState(),
      setSelectedPolygonId: vi.fn(),
      setTempPoints: vi.fn(),
      setInteractionState: vi.fn(),
      setEditMode: vi.fn(),
      updatePolygons: vi.fn(),
    };

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('hook initialization', () => {
    it('should return a valid hook object', () => {
      const { result } = renderHook(() => usePolygonSlicing(mockProps));

      expect(result.current).not.toBeNull();
      expect(result.current).toBeDefined();
      expect(typeof result.current).toBe('object');
      expect(typeof result.current.handleSliceAction).toBe('function');
      expect(typeof result.current.startSlicing).toBe('function');
      expect(typeof result.current.cancelSlicing).toBe('function');
      expect(typeof result.current.handleSlicePointClick).toBe('function');
    });
  });

  describe('handleSliceAction', () => {
    it('should successfully slice a polygon with valid slice line', () => {
      const mockSlicedPolygons = [
        { ...testPolygonObjects.squarePolygon, id: 'slice-1' },
        { ...testPolygonObjects.squarePolygon, id: 'slice-2' },
      ];

      // Mock successful validation and slicing
      (validateSliceLine as any).mockReturnValue({ isValid: true });
      (slicePolygon as any).mockReturnValue(mockSlicedPolygons);

      const slicePoints: Point[] = [
        { x: -10, y: 50 },
        { x: 110, y: 50 },
      ];

      const propsWithTempPoints = {
        ...mockProps,
        tempPoints: slicePoints,
      };

      const { result } = renderHook(() =>
        usePolygonSlicing(propsWithTempPoints)
      );

      let sliceResult: boolean;
      act(() => {
        sliceResult = result.current.handleSliceAction();
      });

      expect(sliceResult!).toBe(true);
      expect(validateSliceLine).toHaveBeenCalledWith(
        testPolygonObjects.squarePolygon,
        slicePoints[0],
        slicePoints[1]
      );
      expect(slicePolygon).toHaveBeenCalledWith(
        testPolygonObjects.squarePolygon,
        slicePoints[0],
        slicePoints[1]
      );
      expect(mockProps.updatePolygons).toHaveBeenCalledWith(mockSlicedPolygons);
      expect(mockProps.setSelectedPolygonId).toHaveBeenCalledWith(null);
      expect(mockProps.setTempPoints).toHaveBeenCalledWith([]);
      expect(mockProps.setEditMode).toHaveBeenCalledWith(EditMode.View);
    });

    it('should fail when no polygon is selected', () => {
      const propsWithoutSelection = {
        ...mockProps,
        selectedPolygonId: null,
        tempPoints: [
          { x: 0, y: 0 },
          { x: 100, y: 100 },
        ],
      };

      const { result } = renderHook(() =>
        usePolygonSlicing(propsWithoutSelection)
      );

      let sliceResult: boolean;
      act(() => {
        sliceResult = result.current.handleSliceAction();
      });

      expect(sliceResult!).toBe(false);
      expect(validateSliceLine).not.toHaveBeenCalled();
      expect(slicePolygon).not.toHaveBeenCalled();
    });

    it('should fail when insufficient temp points provided', () => {
      const propsWithOnePoint = {
        ...mockProps,
        tempPoints: [{ x: 50, y: 50 }],
      };

      const { result } = renderHook(() => usePolygonSlicing(propsWithOnePoint));

      let sliceResult: boolean;
      act(() => {
        sliceResult = result.current.handleSliceAction();
      });

      expect(sliceResult!).toBe(false);
      expect(validateSliceLine).not.toHaveBeenCalled();
    });

    it('should fail when polygon is not found', () => {
      const propsWithInvalidId = {
        ...mockProps,
        selectedPolygonId: 'nonexistent-polygon',
        tempPoints: [
          { x: 0, y: 0 },
          { x: 100, y: 100 },
        ],
      };

      const { result } = renderHook(() =>
        usePolygonSlicing(propsWithInvalidId)
      );

      let sliceResult: boolean;
      act(() => {
        sliceResult = result.current.handleSliceAction();
      });

      expect(sliceResult!).toBe(false);
      expect(validateSliceLine).not.toHaveBeenCalled();
    });

    it('should fail when slice line validation fails', () => {
      (validateSliceLine as any).mockReturnValue({
        isValid: false,
        reason: 'Invalid slice line',
      });

      const propsWithTempPoints = {
        ...mockProps,
        tempPoints: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ], // Too short
      };

      const { result } = renderHook(() =>
        usePolygonSlicing(propsWithTempPoints)
      );

      let sliceResult: boolean;
      act(() => {
        sliceResult = result.current.handleSliceAction();
      });

      expect(sliceResult!).toBe(false);
      expect(validateSliceLine).toHaveBeenCalled();
      expect(slicePolygon).not.toHaveBeenCalled();
    });

    it('should fail when slicing operation returns null', () => {
      (validateSliceLine as any).mockReturnValue({ isValid: true });
      (slicePolygon as any).mockReturnValue(null); // Failed slice

      const propsWithTempPoints = {
        ...mockProps,
        tempPoints: [
          { x: -10, y: 50 },
          { x: 110, y: 50 },
        ],
      };

      const { result } = renderHook(() =>
        usePolygonSlicing(propsWithTempPoints)
      );

      let sliceResult: boolean;
      act(() => {
        sliceResult = result.current.handleSliceAction();
      });

      expect(sliceResult!).toBe(false);
      expect(slicePolygon).toHaveBeenCalled();
      expect(mockProps.updatePolygons).not.toHaveBeenCalled();
    });

    it('should handle provided temp points parameter', () => {
      const mockSlicedPolygons = [
        { ...testPolygonObjects.squarePolygon, id: 'slice-1' },
        { ...testPolygonObjects.squarePolygon, id: 'slice-2' },
      ];

      (validateSliceLine as any).mockReturnValue({ isValid: true });
      (slicePolygon as any).mockReturnValue(mockSlicedPolygons);

      const providedPoints: Point[] = [
        { x: -10, y: 25 },
        { x: 110, y: 75 },
      ];

      const { result } = renderHook(() => usePolygonSlicing(mockProps));

      let sliceResult: boolean;
      act(() => {
        sliceResult = result.current.handleSliceAction(providedPoints);
      });

      expect(sliceResult!).toBe(true);
      expect(validateSliceLine).toHaveBeenCalledWith(
        testPolygonObjects.squarePolygon,
        providedPoints[0],
        providedPoints[1]
      );
    });

    it('should preserve multiple polygons when slicing one', () => {
      const secondPolygon = { ...testPolygonObjects.trianglePolygon };
      const propsWithMultiplePolygons = {
        ...mockProps,
        polygons: [testPolygonObjects.squarePolygon, secondPolygon],
        tempPoints: [
          { x: -10, y: 50 },
          { x: 110, y: 50 },
        ],
      };

      const mockSlicedPolygons = [
        { ...testPolygonObjects.squarePolygon, id: 'slice-1' },
        { ...testPolygonObjects.squarePolygon, id: 'slice-2' },
      ];

      (validateSliceLine as any).mockReturnValue({ isValid: true });
      (slicePolygon as any).mockReturnValue(mockSlicedPolygons);

      const { result } = renderHook(() =>
        usePolygonSlicing(propsWithMultiplePolygons)
      );

      act(() => {
        result.current.handleSliceAction();
      });

      expect(mockProps.updatePolygons).toHaveBeenCalledWith([
        secondPolygon, // Original triangle preserved
        ...mockSlicedPolygons, // New sliced polygons
      ]);
    });
  });

  describe('startSlicing', () => {
    it('should start slicing mode correctly', () => {
      const { result } = renderHook(() => usePolygonSlicing(mockProps));

      const polygonId = 'polygon-1';

      act(() => {
        result.current.startSlicing(polygonId);
      });

      expect(mockProps.setEditMode).toHaveBeenCalledWith(EditMode.Slice);
      expect(mockProps.setTempPoints).toHaveBeenCalledWith([]);
      expect(mockProps.setSelectedPolygonId).toHaveBeenCalledWith(polygonId);
      expect(mockProps.setInteractionState).toHaveBeenCalledWith(
        expect.objectContaining({
          sliceStartPoint: null,
        })
      );
    });

    it('should handle multiple start slice calls', () => {
      const { result } = renderHook(() => usePolygonSlicing(mockProps));

      const firstPolygonId = 'polygon-1';
      const secondPolygonId = 'polygon-2';

      act(() => {
        result.current.startSlicing(firstPolygonId);
      });

      act(() => {
        result.current.startSlicing(secondPolygonId);
      });

      // Should use the latest polygon and reset temp points each time
      expect(mockProps.setTempPoints).toHaveBeenLastCalledWith([]);
      expect(mockProps.setSelectedPolygonId).toHaveBeenLastCalledWith(
        secondPolygonId
      );
      expect(mockProps.setInteractionState).toHaveBeenLastCalledWith(
        expect.objectContaining({
          sliceStartPoint: null,
        })
      );
    });
  });

  describe('handleSlicePointClick', () => {
    it('should handle first point click correctly', () => {
      const { result } = renderHook(() => usePolygonSlicing(mockProps));

      const firstPoint: Point = { x: 25, y: 25 };

      let clickResult: boolean;
      act(() => {
        clickResult = result.current.handleSlicePointClick(firstPoint);
      });

      expect(clickResult!).toBe(true);
      expect(mockProps.setTempPoints).toHaveBeenCalledWith([firstPoint]);
      expect(mockProps.setInteractionState).toHaveBeenCalledWith(
        expect.objectContaining({
          sliceStartPoint: firstPoint,
        })
      );
    });

    it('should complete slicing on second point click', () => {
      const mockSlicedPolygons = [
        { ...testPolygonObjects.squarePolygon, id: 'slice-1' },
        { ...testPolygonObjects.squarePolygon, id: 'slice-2' },
      ];

      (validateSliceLine as any).mockReturnValue({ isValid: true });
      (slicePolygon as any).mockReturnValue(mockSlicedPolygons);

      const firstPoint = { x: 0, y: 50 };
      const propsWithFirstPoint = {
        ...mockProps,
        tempPoints: [firstPoint],
        interactionState: createMockInteractionState({
          sliceStartPoint: firstPoint,
        }),
      };

      const { result } = renderHook(() =>
        usePolygonSlicing(propsWithFirstPoint)
      );

      const secondPoint: Point = { x: 100, y: 50 };

      let clickResult: boolean;
      act(() => {
        clickResult = result.current.handleSlicePointClick(secondPoint);
      });

      expect(clickResult!).toBe(true);
      expect(mockProps.setTempPoints).toHaveBeenCalledWith([
        firstPoint,
        secondPoint,
      ]);
      expect(validateSliceLine).toHaveBeenCalledWith(
        testPolygonObjects.squarePolygon,
        firstPoint,
        secondPoint
      );
    });

    it('should fail when no polygon is selected', () => {
      const propsWithoutSelection = {
        ...mockProps,
        selectedPolygonId: null,
      };

      const { result } = renderHook(() =>
        usePolygonSlicing(propsWithoutSelection)
      );

      let clickResult: boolean;
      act(() => {
        clickResult = result.current.handleSlicePointClick({ x: 25, y: 25 });
      });

      expect(clickResult!).toBe(false);
    });

    it('should return false when max points reached', () => {
      const propsWithTwoPoints = {
        ...mockProps,
        tempPoints: [
          { x: 0, y: 50 },
          { x: 100, y: 50 },
        ],
      };

      const { result } = renderHook(() =>
        usePolygonSlicing(propsWithTwoPoints)
      );

      let clickResult: boolean;
      act(() => {
        clickResult = result.current.handleSlicePointClick({ x: 50, y: 25 });
      });

      expect(clickResult!).toBe(false);
    });
  });

  describe('cancelSlicing', () => {
    it('should cancel slicing and reset state', () => {
      const propsInSliceMode = {
        ...mockProps,
        tempPoints: [
          { x: 0, y: 50 },
          { x: 50, y: 50 },
        ],
        interactionState: createMockInteractionState({
          sliceStartPoint: { x: 0, y: 50 },
        }),
      };

      const { result } = renderHook(() => usePolygonSlicing(propsInSliceMode));

      act(() => {
        result.current.cancelSlicing();
      });

      expect(mockProps.setEditMode).toHaveBeenCalledWith(EditMode.View);
      expect(mockProps.setTempPoints).toHaveBeenCalledWith([]);
      expect(mockProps.setInteractionState).toHaveBeenCalledWith(
        expect.objectContaining({
          sliceStartPoint: null,
        })
      );
    });

    it('should be safe to call when not in slicing mode', () => {
      const { result } = renderHook(() => usePolygonSlicing(mockProps));

      expect(() => {
        act(() => {
          result.current.cancelSlicing();
        });
      }).not.toThrow();

      expect(mockProps.setEditMode).toHaveBeenCalledWith(EditMode.View);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle missing language translations gracefully', () => {
      const propsWithTempPoints = {
        ...mockProps,
        tempPoints: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      };

      (validateSliceLine as any).mockReturnValue({
        isValid: false,
        reason: 'Test reason',
      });

      const { result } = renderHook(() =>
        usePolygonSlicing(propsWithTempPoints)
      );

      expect(() => {
        act(() => {
          result.current.handleSliceAction();
        });
      }).not.toThrow();
    });

    it('should handle invalid polygon data', () => {
      const propsWithInvalidPolygon = {
        ...mockProps,
        polygons: [{ id: 'invalid', points: [], type: 'external' } as Polygon],
        selectedPolygonId: 'invalid',
        tempPoints: [
          { x: 0, y: 0 },
          { x: 100, y: 100 },
        ],
      };

      (validateSliceLine as any).mockReturnValue({ isValid: true });
      (slicePolygon as any).mockReturnValue(null);

      const { result } = renderHook(() =>
        usePolygonSlicing(propsWithInvalidPolygon)
      );

      let sliceResult: boolean;
      act(() => {
        sliceResult = result.current.handleSliceAction();
      });

      expect(sliceResult!).toBe(false);
    });

    it('should handle extreme coordinate values', () => {
      const extremePoints: Point[] = [
        { x: -Infinity, y: 0 },
        { x: Infinity, y: 0 },
      ];

      (validateSliceLine as any).mockReturnValue({
        isValid: false,
        reason: 'Invalid coordinates',
      });

      const propsWithExtremePoints = {
        ...mockProps,
        tempPoints: extremePoints,
      };

      const { result } = renderHook(() =>
        usePolygonSlicing(propsWithExtremePoints)
      );

      let sliceResult: boolean;
      act(() => {
        sliceResult = result.current.handleSliceAction();
      });

      expect(sliceResult!).toBe(false);
      expect(validateSliceLine).toHaveBeenCalledWith(
        testPolygonObjects.squarePolygon,
        extremePoints[0],
        extremePoints[1]
      );
    });

    it('should handle NaN coordinates', () => {
      const invalidPoints: Point[] = [
        { x: NaN, y: 50 },
        { x: 100, y: NaN },
      ];

      (validateSliceLine as any).mockReturnValue({
        isValid: false,
        reason: 'NaN coordinates',
      });

      const propsWithNaNPoints = {
        ...mockProps,
        tempPoints: invalidPoints,
      };

      const { result } = renderHook(() =>
        usePolygonSlicing(propsWithNaNPoints)
      );

      expect(() => {
        act(() => {
          result.current.handleSliceAction();
        });
      }).not.toThrow();
    });
  });

  describe('Integration with State Management', () => {
    it('should properly integrate with interaction state updates', () => {
      const { result } = renderHook(() => usePolygonSlicing(mockProps));

      const polygonId = 'polygon-1';

      act(() => {
        result.current.startSlicing(polygonId);
      });

      // Should call setInteractionState with proper update
      expect(mockProps.setInteractionState).toHaveBeenCalledWith(
        expect.objectContaining({
          ...mockProps.interactionState,
          sliceStartPoint: null,
        })
      );
    });

    it('should maintain polygon order during replacement', () => {
      const polygonA = { ...testPolygonObjects.squarePolygon, id: 'A' };
      const polygonB = { ...testPolygonObjects.trianglePolygon, id: 'B' };
      const polygonC = { ...testPolygonObjects.complexPolygon, id: 'C' };

      const propsWithOrderedPolygons = {
        ...mockProps,
        polygons: [polygonA, polygonB, polygonC],
        selectedPolygonId: 'B', // Select middle polygon
        tempPoints: [
          { x: 0, y: 0 },
          { x: 100, y: 100 },
        ],
      };

      const mockSlicedPolygons = [
        { ...polygonB, id: 'B1' },
        { ...polygonB, id: 'B2' },
      ];

      (validateSliceLine as any).mockReturnValue({ isValid: true });
      (slicePolygon as any).mockReturnValue(mockSlicedPolygons);

      const { result } = renderHook(() =>
        usePolygonSlicing(propsWithOrderedPolygons)
      );

      act(() => {
        result.current.handleSliceAction();
      });

      // Should preserve original order and replace selected polygon
      expect(mockProps.updatePolygons).toHaveBeenCalledWith([
        polygonA,
        polygonC,
        ...mockSlicedPolygons,
      ]);
    });
  });

  describe('Performance Considerations', () => {
    it('should handle rapid slice attempts efficiently', () => {
      const { result } = renderHook(() => usePolygonSlicing(mockProps));

      (validateSliceLine as any).mockReturnValue({
        isValid: false,
        reason: 'Too fast',
      });

      const startTime = performance.now();

      // Attempt many rapid slice operations
      for (let i = 0; i < 100; i++) {
        act(() => {
          result.current.startSlicing('polygon-1');
          result.current.handleSlicePointClick({ x: i, y: i });
          result.current.handleSlicePointClick({ x: i + 50, y: i + 50 });
        });
      }

      const endTime = performance.now();
      expect(endTime - startTime).toBeLessThan(100); // Should be efficient
    });

    it('should not leak memory during repeated operations', () => {
      const { result, unmount } = renderHook(() =>
        usePolygonSlicing(mockProps)
      );

      // Perform operations that might create closures or listeners
      for (let i = 0; i < 50; i++) {
        act(() => {
          result.current.startSlicing('polygon-1');
          result.current.cancelSlicing();
        });
      }

      // Should not throw on unmount
      expect(() => unmount()).not.toThrow();
    });
  });
});
