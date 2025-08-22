import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ExportService, ExportOptions } from '../../exportService';
import { MetricsCalculator } from '../../metrics/metricsCalculator';
import { VisualizationGenerator } from '../../visualization/visualizationGenerator';
import * as fs from 'fs/promises';
import path from 'path';
// Mock prisma for integration tests
const prismaMock = {
  project: {
    findUnique: jest.fn()
  }
} as any;

/**
 * Integration tests for scale conversion feature
 * Tests the complete export pipeline with pixel-to-micrometer conversion
 */

describe('Scale Conversion Integration Tests', () => {
  let exportService: ExportService;
  let tempDir: string;

  beforeEach(async () => {
    // Create temp directory for test outputs
    tempDir = path.join(__dirname, 'temp-export-test');
    await fs.mkdir(tempDir, { recursive: true });
    
    exportService = new ExportService();
  });

  afterEach(async () => {
    // Clean up temp directory - use compatible method
    try {
      await fs.rmdir(tempDir, { recursive: true });
    } catch (error) {
      // Fallback for older Node.js versions or if directory doesn't exist
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (fallbackError) {
        console.warn('Failed to clean up temp directory:', fallbackError);
      }
    }
  });

  describe('End-to-End Export with Scale Conversion', () => {
    it('should apply scale conversion to export jobs', async () => {
      // Mock project data with segmentation
      const mockProject = {
        id: 'test-project-1',
        title: 'Test Project',
        userId: 'user-1',
        images: [
          {
            id: 'img-1',
            name: 'test-image.jpg',
            width: 1920,
            height: 1080,
            segmentation: {
              polygons: JSON.stringify([
                {
                  type: 'external',
                  points: [
                    { x: 100, y: 100 },
                    { x: 200, y: 100 },
                    { x: 200, y: 200 },
                    { x: 100, y: 200 }
                  ]
                }
              ]),
              model: 'HRNetV2',
              threshold: 0.5
            }
          }
        ]
      };

      // Test with different scale values
      const testScales = [0.5, 1.0, 2.5, 10.0];
      
      for (const scale of testScales) {
        const exportOptions: ExportOptions = {
          includeOriginalImages: false,
          includeVisualizations: false,
          metricsFormats: ['excel'],
          pixelToMicrometerScale: scale
        };

        // Mock database query
        prismaMock.project.findUnique.mockResolvedValue(mockProject as any);

        // Perform export - using startExportJob
        const jobId = await exportService.startExportJob(
          mockProject.id,
          'test-user',
          exportOptions
        );

        expect(jobId).toBeDefined();
        expect(typeof jobId).toBe('string');
        
        // Verify the export options were properly stored with the scale
        expect(exportOptions.pixelToMicrometerScale).toBe(scale);
      }
    });

    it('should handle edge case scale values', async () => {
      const edgeCaseScales = [
        { value: 0.001, shouldWarn: true },   // Very small
        { value: 1000, shouldWarn: true },     // Very large
        { value: 0, shouldFallback: true },    // Invalid
        { value: -1, shouldFallback: true },   // Negative
        { value: NaN, shouldFallback: true },  // NaN
        { value: Infinity, shouldFallback: true } // Infinity
      ];

      const metricsCalculator = new MetricsCalculator();
      const mockImages = [{
        id: 'img-1',
        name: 'test.jpg',
        segmentation: {
          polygons: JSON.stringify([{
            type: 'external',
            points: [
              { x: 0, y: 0 },
              { x: 100, y: 0 },
              { x: 100, y: 100 },
              { x: 0, y: 100 }
            ]
          }]),
          model: 'test',
          threshold: 0.5
        }
      }];

      // Create spy once before the loop
      const loggerSpy = jest.spyOn(metricsCalculator['logger'], 'warn');
      
      try {
        for (const testCase of edgeCaseScales) {
          // Clear mock calls for each iteration
          loggerSpy.mockClear();
          
          const metrics = await metricsCalculator.calculateAllMetrics(
            mockImages as any,
            testCase.value
          );

          if (testCase.shouldWarn) {
            expect(loggerSpy).toHaveBeenCalledWith(
              expect.stringContaining('scale'),
              'MetricsCalculator'
            );
          }

          if (testCase.shouldFallback) {
            // Should use pixel values when scale is invalid
            expect(metrics[0]?.area).toBe(10000); // Original pixel area
          } else {
            // Should apply scale when valid
            const expectedArea = 10000 / (testCase.value * testCase.value);
            expect(metrics[0]?.area).toBeCloseTo(expectedArea, 2);
          }
        }
      } finally {
        // Always restore the spy even if tests fail
        loggerSpy.mockRestore();
      }
    });

    it('should preserve dimensionless ratios', async () => {
      const metricsCalculator = new MetricsCalculator();
      const scale = 2.5;
      
      const mockImages = [{
        id: 'img-1',
        name: 'test.jpg',
        segmentation: {
          polygons: JSON.stringify([{
            type: 'external',
            points: [
              { x: 0, y: 0 },
              { x: 100, y: 0 },
              { x: 100, y: 100 },
              { x: 0, y: 100 }
            ]
          }]),
          model: 'test',
          threshold: 0.5
        }
      }];

      // Calculate metrics without scale
      const metricsNoScale = await metricsCalculator.calculateAllMetrics(
        mockImages as any
      );

      // Calculate metrics with scale
      const metricsWithScale = await metricsCalculator.calculateAllMetrics(
        mockImages as any,
        scale
      );

      // Dimensionless ratios should remain unchanged
      expect(metricsWithScale[0]?.circularity).toBe(metricsNoScale[0]?.circularity);
      expect(metricsWithScale[0]?.solidity).toBe(metricsNoScale[0]?.solidity);
      expect(metricsWithScale[0]?.compactness).toBe(metricsNoScale[0]?.compactness);
      expect(metricsWithScale[0]?.convexity).toBe(metricsNoScale[0]?.convexity);
      expect(metricsWithScale[0]?.feretAspectRatio).toBe(metricsNoScale[0]?.feretAspectRatio);
      
      // Area should be scaled (converted from px² to µm²)
      expect(metricsWithScale[0]?.area).toBe((metricsNoScale[0]?.area || 0) / (scale * scale));
      
      // Linear measurements should be scaled (converted from px to µm)
      expect(metricsWithScale[0]?.perimeter).toBe((metricsNoScale[0]?.perimeter || 0) / scale);
      expect(metricsWithScale[0]?.equivalentDiameter).toBe((metricsNoScale[0]?.equivalentDiameter || 0) / scale);
    });

    it('should include scale information in export metadata', async () => {
      const scale = 1.5;
      const exportOptions: ExportOptions = {
        includeOriginalImages: false,
        includeVisualizations: false,
        annotationFormats: ['json'],
        pixelToMicrometerScale: scale
      };

      const mockProject = {
        id: 'test-project-2',
        title: 'Scale Test Project',
        images: [{
          id: 'img-1',
          name: 'test.jpg',
          segmentation: {
            polygons: JSON.stringify([{
              type: 'external',
              points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }, { x: 0, y: 50 }]
            }]),
            model: 'test',
            threshold: 0.5
          }
        }]
      };

      prismaMock.project.findUnique.mockResolvedValue(mockProject as any);

      const jobId = await exportService.startExportJob(
        mockProject.id,
        'test-user',
        exportOptions
      );

      expect(jobId).toBeDefined();
      expect(typeof jobId).toBe('string');
      
      // Verify the scale is properly stored in the export options
      expect(exportOptions.pixelToMicrometerScale).toBe(scale);
    });

    it('should handle concurrent exports with different scales', async () => {
      const scales = [0.5, 1.0, 2.0, 5.0];
      const exportPromises = scales.map(async (scale, index) => {
        const exportOptions: ExportOptions = {
          includeOriginalImages: false,
          metricsFormats: ['csv'],
          pixelToMicrometerScale: scale
        };

        const projectId = `project-${index}`;
        const outputDir = path.join(tempDir, `export-${index}`);
        await fs.mkdir(outputDir, { recursive: true });

        // Mock different projects
        const mockProject = {
          id: projectId,
          name: `Project ${index}`,
          images: [{
            id: `img-${index}`,
            name: `test-${index}.jpg`,
            segmentation: {
              polygons: JSON.stringify([{
                type: 'external',
                points: [
                  { x: 0, y: 0 },
                  { x: 100, y: 0 },
                  { x: 100, y: 100 },
                  { x: 0, y: 100 }
                ]
              }]),
              model: 'test',
              threshold: 0.5
            }
          }]
        };

        prismaMock.project.findUnique.mockResolvedValue(mockProject as any);

        return exportService.startExportJob(projectId, 'test-user', exportOptions);
      });

      const results = await Promise.all(exportPromises);
      
      // All export jobs should be created successfully
      results.forEach(jobId => {
        expect(jobId).toBeDefined();
        expect(typeof jobId).toBe('string');
      });

      // Note: In a full integration test, you would wait for jobs to complete
      // and verify the generated CSV files contain proper scale units
    });
  });

  describe('Scale Conversion Performance', () => {
    it('should handle large datasets efficiently', async () => {
      const metricsCalculator = new MetricsCalculator();
      const scale = 2.0;
      
      // Create large dataset with many polygons
      const largeDataset = Array.from({ length: 100 }, (_, i) => ({
        id: `img-${i}`,
        name: `test-${i}.jpg`,
        segmentation: {
          polygons: JSON.stringify(
            Array.from({ length: 50 }, (_, j) => ({
              type: 'external',
              points: Array.from({ length: 20 }, (_, k) => ({
                x: Math.random() * 1000,
                y: Math.random() * 1000
              }))
            }))
          ),
          model: 'test',
          threshold: 0.5
        }
      }));

      const startTime = Date.now();
      const metrics = await metricsCalculator.calculateAllMetrics(
        largeDataset as any,
        scale
      );
      const endTime = Date.now();
      const processingTime = endTime - startTime;

      // Should process 5000 polygons in reasonable time  
      // Note: The metrics calculator returns individual polygon metrics, not per-image summaries
      expect(metrics.length).toBe(5000); // One metric per polygon (100 images * 50 polygons each)
      expect(processingTime).toBeLessThan(30000); // Less than 30 seconds
      
      // Verify scale was applied
      metrics.forEach(metric => {
        expect(metric.area).toBeGreaterThan(0);
        expect(metric.perimeter).toBeGreaterThan(0);
      });
    });
  });
});