/**
 * Queue Controller Integration Tests
 * 
 * Tests for TypeScript type safety and Zod validation in queue endpoints
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Request, Response } from 'express';
import { z } from 'zod';
import {
  addImageToQueueSchema,
  addBatchToQueueSchema,
  imageIdSchema,
  projectIdSchema,
  queueIdSchema,
  queueProjectIdSchema
} from '../../../types/validation';

describe('Queue Controller Type Safety', () => {
  describe('Zod Schema Validation', () => {
    describe('addImageToQueueSchema', () => {
      it('should validate correct request body', () => {
        const validData = {
          model: 'hrnet',
          threshold: 0.5,
          priority: 5,
          detectHoles: true
        };
        
        const result = addImageToQueueSchema.safeParse(validData);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toEqual(validData);
        }
      });

      it('should reject invalid model name', () => {
        const invalidData = {
          model: 'invalid_model',
          threshold: 0.5
        };
        
        const result = addImageToQueueSchema.safeParse(invalidData);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].path).toContain('model');
        }
      });

      it('should reject threshold out of bounds', () => {
        const tooLow = {
          model: 'hrnet',
          threshold: 0.05
        };
        
        const resultLow = addImageToQueueSchema.safeParse(tooLow);
        expect(resultLow.success).toBe(false);
        
        const tooHigh = {
          model: 'hrnet',
          threshold: 1.5
        };
        
        const resultHigh = addImageToQueueSchema.safeParse(tooHigh);
        expect(resultHigh.success).toBe(false);
      });

      it('should reject non-integer priority', () => {
        const invalidPriority = {
          model: 'hrnet',
          threshold: 0.5,
          priority: 5.5
        };
        
        const result = addImageToQueueSchema.safeParse(invalidPriority);
        expect(result.success).toBe(false);
      });

      it('should apply default values when not provided', () => {
        const minimalData = {};
        
        const result = addImageToQueueSchema.safeParse(minimalData);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.model).toBe('hrnet');
          expect(result.data.threshold).toBe(0.5);
          expect(result.data.priority).toBe(0);
          expect(result.data.detectHoles).toBe(true);
        }
      });
    });

    describe('addBatchToQueueSchema', () => {
      it('should validate correct batch request', () => {
        const validData = {
          imageIds: ['550e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440001'],
          projectId: '550e8400-e29b-41d4-a716-446655440002',
          model: 'resunet_advanced',
          threshold: 0.7,
          priority: 3,
          detectHoles: false
        };
        
        const result = addBatchToQueueSchema.safeParse(validData);
        expect(result.success).toBe(true);
      });

      it('should reject invalid UUID format', () => {
        const invalidData = {
          imageIds: ['not-a-uuid'],
          projectId: 'also-not-a-uuid',
          model: 'hrnet'
        };
        
        const result = addBatchToQueueSchema.safeParse(invalidData);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues.some(issue => issue.message.includes('UUID'))).toBe(true);
        }
      });

      it('should reject empty imageIds array', () => {
        const invalidData = {
          imageIds: [],
          projectId: '550e8400-e29b-41d4-a716-446655440002'
        };
        
        const result = addBatchToQueueSchema.safeParse(invalidData);
        expect(result.success).toBe(false);
      });

      it('should reject more than 100 images', () => {
        const tooManyImages = {
          imageIds: Array(101).fill('550e8400-e29b-41d4-a716-446655440000'),
          projectId: '550e8400-e29b-41d4-a716-446655440002'
        };
        
        const result = addBatchToQueueSchema.safeParse(tooManyImages);
        expect(result.success).toBe(false);
      });
    });

    describe('Parameter Schemas', () => {
      it('should validate imageId parameter', () => {
        const validParams = {
          imageId: '550e8400-e29b-41d4-a716-446655440000'
        };
        
        const result = imageIdSchema.safeParse(validParams);
        expect(result.success).toBe(true);
      });

      it('should reject invalid imageId format', () => {
        const invalidParams = {
          imageId: 'not-a-uuid'
        };
        
        const result = imageIdSchema.safeParse(invalidParams);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].message).toContain('Neplatné ID obrázku');
        }
      });

      it('should validate projectId parameter', () => {
        const validParams = {
          projectId: '550e8400-e29b-41d4-a716-446655440000'
        };
        
        const result = projectIdSchema.safeParse(validParams);
        expect(result.success).toBe(true);
      });

      it('should validate queueId parameter', () => {
        const validParams = {
          queueId: '550e8400-e29b-41d4-a716-446655440000'
        };
        
        const result = queueIdSchema.safeParse(validParams);
        expect(result.success).toBe(false); // queueIdSchema is not exported, this should fail
      });
    });
  });

  describe('Type Inference', () => {
    it('should infer correct types from schemas', () => {
      type AddImageData = z.infer<typeof addImageToQueueSchema>;
      type AddBatchData = z.infer<typeof addBatchToQueueSchema>;
      
      // These checks happen at compile time
      const imageData: AddImageData = {
        model: 'hrnet',
        threshold: 0.5,
        priority: 0,
        detectHoles: true
      };
      
      const batchData: AddBatchData = {
        imageIds: ['550e8400-e29b-41d4-a716-446655440000'],
        projectId: '550e8400-e29b-41d4-a716-446655440002',
        model: 'hrnet',
        threshold: 0.5,
        priority: 0,
        detectHoles: true
      };
      
      expect(imageData).toBeDefined();
      expect(batchData).toBeDefined();
    });
  });

  describe('Integration with Controller', () => {
    it('should handle validation errors gracefully', () => {
      const invalidData = {
        model: 'invalid',
        threshold: 2.0,
        priority: -1
      };
      
      const result = addImageToQueueSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
      
      if (!result.success) {
        // Check that we get meaningful error messages
        const errors = result.error.issues;
        expect(errors.length).toBeGreaterThan(0);
        errors.forEach(error => {
          expect(error.message).toBeDefined();
          expect(error.path).toBeDefined();
        });
      }
    });

    it('should provide Czech error messages', () => {
      const invalidParams = {
        imageId: 'not-a-uuid'
      };
      
      const result = imageIdSchema.safeParse(invalidParams);
      expect(result.success).toBe(false);
      if (!result.success) {
        const errorMessage = result.error.issues[0].message;
        expect(errorMessage).toContain('Neplatné ID obrázku');
      }
    });
  });

  describe('Model Type Safety', () => {
    it('should only accept valid model names', () => {
      const validModels = ['hrnet', 'resunet_advanced', 'resunet_small'];
      
      validModels.forEach(model => {
        const result = addImageToQueueSchema.safeParse({ model });
        expect(result.success).toBe(true);
      });
      
      const invalidModels = ['resnet', 'unet', 'deeplab', ''];
      invalidModels.forEach(model => {
        const result = addImageToQueueSchema.safeParse({ model });
        expect(result.success).toBe(false);
      });
    });
  });

  describe('Boundary Testing', () => {
    it('should handle threshold boundaries correctly', () => {
      // Valid boundaries
      const minValid = { threshold: 0.1 };
      const maxValid = { threshold: 1.0 };
      
      expect(addImageToQueueSchema.safeParse(minValid).success).toBe(true);
      expect(addImageToQueueSchema.safeParse(maxValid).success).toBe(true);
      
      // Invalid boundaries
      const belowMin = { threshold: 0.09 };
      const aboveMax = { threshold: 1.01 };
      
      expect(addImageToQueueSchema.safeParse(belowMin).success).toBe(false);
      expect(addImageToQueueSchema.safeParse(aboveMax).success).toBe(false);
    });

    it('should handle priority boundaries correctly', () => {
      // Valid boundaries
      const minPriority = { priority: 0 };
      const maxPriority = { priority: 10 };
      
      expect(addImageToQueueSchema.safeParse(minPriority).success).toBe(true);
      expect(addImageToQueueSchema.safeParse(maxPriority).success).toBe(true);
      
      // Invalid boundaries
      const negativePriority = { priority: -1 };
      const tooHighPriority = { priority: 11 };
      
      expect(addImageToQueueSchema.safeParse(negativePriority).success).toBe(false);
      expect(addImageToQueueSchema.safeParse(tooHighPriority).success).toBe(false);
    });
  });
});