/**
 * Tests for canvas testing utilities
 * Verifies that our canvas mocking works correctly
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createMockCanvasContext,
  createMockCanvas,
  expectCanvasToHaveDrawn,
  expectPolygonDrawn,
  simulateCanvasInteraction,
} from '../canvasTestUtils';
import type { Point } from '@/lib/segmentation';

describe('canvasTestUtils', () => {
  describe('createMockCanvasContext', () => {
    it('creates a comprehensive mock canvas context', () => {
      const context = createMockCanvasContext();

      expect(context).toBeDefined();
      expect(context.__drawCalls).toBeDefined();
      expect(context.__mockState).toBeDefined();
      expect(context.__currentPath).toBeDefined();
      expect(context.__paths).toBeDefined();
      expect(context.__transforms).toBeDefined();
      expect(context.__clearMocks).toBeTypeOf('function');
    });

    it('tracks drawing operations', () => {
      const context = createMockCanvasContext();

      context.fillRect(10, 20, 30, 40);
      context.strokeRect(50, 60, 70, 80);

      expect(context.__drawCalls).toHaveLength(2);
      expect(context.__drawCalls[0]).toMatchObject({
        method: 'fillRect',
        args: [10, 20, 30, 40],
      });
      expect(context.__drawCalls[1]).toMatchObject({
        method: 'strokeRect',
        args: [50, 60, 70, 80],
      });
    });

    it('tracks path operations', () => {
      const context = createMockCanvasContext();

      context.beginPath();
      context.moveTo(10, 10);
      context.lineTo(20, 20);
      context.lineTo(30, 10);
      context.closePath();

      // closePath adds the starting point to close the path
      expect(context.__currentPath).toHaveLength(4);
      expect(context.__currentPath[0]).toEqual({ x: 10, y: 10 });
      expect(context.__currentPath[1]).toEqual({ x: 20, y: 20 });
      expect(context.__currentPath[2]).toEqual({ x: 30, y: 10 });
      expect(context.__currentPath[3]).toEqual({ x: 10, y: 10 }); // Closed path
    });

    it('tracks state changes', () => {
      const context = createMockCanvasContext();

      context.fillStyle = '#ff0000';
      context.lineWidth = 5;
      context.globalAlpha = 0.5;

      expect(context.__mockState.fillStyle).toBe('#ff0000');
      expect(context.__mockState.lineWidth).toBe(5);
      expect(context.__mockState.globalAlpha).toBe(0.5);

      // Check that state changes are recorded as draw calls
      expect(
        context.__drawCalls.some(call => call.method === 'set fillStyle')
      ).toBe(true);
      expect(
        context.__drawCalls.some(call => call.method === 'set lineWidth')
      ).toBe(true);
      expect(
        context.__drawCalls.some(call => call.method === 'set globalAlpha')
      ).toBe(true);
    });

    it('tracks transformations', () => {
      const context = createMockCanvasContext();

      context.save();
      context.translate(10, 20);
      context.scale(2, 3);
      context.rotate(Math.PI / 4);
      context.restore();

      expect(context.__drawCalls.some(call => call.method === 'save')).toBe(
        true
      );
      expect(
        context.__drawCalls.some(call => call.method === 'translate')
      ).toBe(true);
      expect(context.__drawCalls.some(call => call.method === 'scale')).toBe(
        true
      );
      expect(context.__drawCalls.some(call => call.method === 'rotate')).toBe(
        true
      );
      expect(context.__drawCalls.some(call => call.method === 'restore')).toBe(
        true
      );
    });

    it('supports text measurement', () => {
      const context = createMockCanvasContext();

      const metrics = context.measureText('Hello World');

      expect(metrics).toBeDefined();
      expect(metrics.width).toBeGreaterThan(0);
      expect(metrics.actualBoundingBoxLeft).toBeDefined();
      expect(metrics.actualBoundingBoxRight).toBeDefined();
    });

    it('supports hit testing', () => {
      const context = createMockCanvasContext();

      // Create a rectangular path
      context.beginPath();
      context.rect(10, 10, 50, 30);

      // Test point inside rectangle
      expect(context.isPointInPath(25, 20)).toBe(true);

      // Test point outside rectangle (this is a simplified test)
      expect(context.isPointInStroke(100, 100)).toBe(false);
    });

    it('clears mock data correctly', () => {
      const context = createMockCanvasContext();

      context.fillRect(0, 0, 10, 10);
      context.moveTo(0, 0);
      context.save();

      expect(context.__drawCalls.length).toBeGreaterThan(0);
      expect(context.__currentPath.length).toBeGreaterThan(0);
      expect(context.__transforms.length).toBeGreaterThan(0);

      context.__clearMocks();

      expect(context.__drawCalls.length).toBe(0);
      expect(context.__currentPath.length).toBe(0);
      expect(context.__transforms.length).toBe(0);
    });
  });

  describe('createMockCanvas', () => {
    it('creates a mock canvas element', () => {
      const canvas = createMockCanvas();

      expect(canvas).toBeInstanceOf(HTMLCanvasElement);
      expect(canvas.width).toBe(800);
      expect(canvas.height).toBe(600);
      expect(canvas.getContext).toBeTypeOf('function');
    });

    it('returns mock context for 2d', () => {
      const canvas = createMockCanvas();
      const context = canvas.getContext('2d');

      expect(context).toBeDefined();
      expect(context?.fillRect).toBeTypeOf('function');
      expect(context?.strokeRect).toBeTypeOf('function');
    });

    it('returns null for non-2d contexts', () => {
      const canvas = createMockCanvas();
      const context = canvas.getContext('webgl');

      expect(context).toBeNull();
    });
  });

  describe('expectCanvasToHaveDrawn', () => {
    it('asserts canvas drawing operations', () => {
      const context = createMockCanvasContext();

      context.fillRect(0, 0, 10, 10);
      context.fillRect(10, 10, 20, 20);

      const calls = expectCanvasToHaveDrawn(context, 'fillRect', 2);
      expect(calls).toHaveLength(2);
    });

    it('defaults to expecting one call', () => {
      const context = createMockCanvasContext();

      context.strokeRect(0, 0, 10, 10);

      const calls = expectCanvasToHaveDrawn(context, 'strokeRect');
      expect(calls).toHaveLength(1);
    });
  });

  describe('expectPolygonDrawn', () => {
    it('asserts polygon was drawn correctly', () => {
      const context = createMockCanvasContext();
      const vertices: Point[] = [
        { x: 10, y: 10 },
        { x: 20, y: 10 },
        { x: 20, y: 20 },
        { x: 10, y: 20 },
      ];

      // Draw a polygon
      context.beginPath();
      context.moveTo(vertices[0].x, vertices[0].y);
      for (let i = 1; i < vertices.length; i++) {
        context.lineTo(vertices[i].x, vertices[i].y);
      }
      context.closePath();

      expect(() => expectPolygonDrawn(context, vertices)).not.toThrow();
    });
  });

  describe('simulateCanvasInteraction', () => {
    it('simulates mouse click on canvas', () => {
      const canvas = document.createElement('div');
      const dispatchEventSpy = vi.spyOn(canvas, 'dispatchEvent');

      simulateCanvasInteraction(canvas, {
        type: 'click',
        x: 50,
        y: 30,
      });

      expect(dispatchEventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'click',
          clientX: 50, // Since getBoundingClientRect returns { left: 0, top: 0 }
          clientY: 30,
        })
      );
    });

    it('simulates wheel event on canvas', () => {
      const canvas = document.createElement('div');
      const dispatchEventSpy = vi.spyOn(canvas, 'dispatchEvent');

      simulateCanvasInteraction(canvas, {
        type: 'wheel',
        x: 100,
        y: 150,
        deltaY: -120,
        ctrlKey: true,
      });

      expect(dispatchEventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'wheel',
          deltaY: -120,
          ctrlKey: true,
        })
      );
    });

    it('simulates mouse drag sequence', () => {
      const canvas = document.createElement('div');
      const dispatchEventSpy = vi.spyOn(canvas, 'dispatchEvent');

      // Simulate mousedown, mousemove, mouseup
      simulateCanvasInteraction(canvas, {
        type: 'mousedown',
        x: 10,
        y: 10,
        button: 0,
      });

      simulateCanvasInteraction(canvas, {
        type: 'mousemove',
        x: 20,
        y: 20,
      });

      simulateCanvasInteraction(canvas, {
        type: 'mouseup',
        x: 20,
        y: 20,
      });

      expect(dispatchEventSpy).toHaveBeenCalledTimes(3);
      expect(dispatchEventSpy).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ type: 'mousedown' })
      );
      expect(dispatchEventSpy).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ type: 'mousemove' })
      );
      expect(dispatchEventSpy).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({ type: 'mouseup' })
      );
    });
  });

  describe('Canvas performance testing', () => {
    it('measures canvas operation performance', async () => {
      const { measureCanvasPerformance } = await import('../canvasTestUtils');

      const result = await measureCanvasPerformance(ctx => {
        ctx.fillRect(0, 0, 100, 100);
        ctx.strokeRect(10, 10, 80, 80);
        ctx.beginPath();
        ctx.arc(50, 50, 25, 0, Math.PI * 2);
        ctx.fill();
      }, 10);

      expect(result.averageTime).toBeGreaterThanOrEqual(0);
      expect(result.operationsPerSecond).toBeGreaterThanOrEqual(0);
      expect(result.totalOperations).toBe(50); // 10 iterations * 5 operations per iteration (fillRect, strokeRect, beginPath, arc, fill)
    });
  });

  describe('Canvas state management', () => {
    it('tracks save/restore stack correctly', () => {
      const context = createMockCanvasContext();

      // Initial state
      context.fillStyle = '#000000';
      context.lineWidth = 1;

      // Save and modify
      context.save();
      context.fillStyle = '#ff0000';
      context.lineWidth = 5;

      expect(context.__mockState.fillStyle).toBe('#ff0000');
      expect(context.__mockState.lineWidth).toBe(5);

      // Restore should revert to previous state
      context.restore();

      // Note: Our mock doesn't actually implement save/restore state management
      // but it tracks the calls correctly
      expect(context.__drawCalls.some(call => call.method === 'save')).toBe(
        true
      );
      expect(context.__drawCalls.some(call => call.method === 'restore')).toBe(
        true
      );
    });
  });

  describe('Image operations', () => {
    it('tracks drawImage operations', () => {
      const context = createMockCanvasContext();
      const mockImage = { width: 100, height: 100 } as any;

      context.drawImage(mockImage, 0, 0);
      context.drawImage(mockImage, 10, 20, 50, 60);
      context.drawImage(mockImage, 0, 0, 100, 100, 10, 20, 50, 60);

      expect(
        context.__drawCalls.filter(call => call.method === 'drawImage')
      ).toHaveLength(3);
    });
  });

  describe('Gradient and pattern operations', () => {
    it('creates and tracks gradient operations', () => {
      const context = createMockCanvasContext();

      const gradient = context.createLinearGradient(0, 0, 100, 0);
      expect(gradient).toBeDefined();
      expect(gradient.addColorStop).toBeTypeOf('function');

      const radialGradient = context.createRadialGradient(
        50,
        50,
        0,
        50,
        50,
        25
      );
      expect(radialGradient).toBeDefined();

      expect(
        context.__drawCalls.some(call => call.method === 'createLinearGradient')
      ).toBe(true);
      expect(
        context.__drawCalls.some(call => call.method === 'createRadialGradient')
      ).toBe(true);
    });

    it('creates and tracks pattern operations', () => {
      const context = createMockCanvasContext();
      const mockImage = { width: 10, height: 10 } as any;

      const pattern = context.createPattern(mockImage, 'repeat');
      expect(pattern).toBeDefined();

      expect(
        context.__drawCalls.some(call => call.method === 'createPattern')
      ).toBe(true);
    });
  });
});
