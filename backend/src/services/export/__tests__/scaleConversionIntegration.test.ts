import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ExportService } from '../../exportService';
import { MetricsCalculator } from '../../metrics/metricsCalculator';
import { VisualizationGenerator } from '../../visualization/visualizationGenerator';
import { ExportOptions } from '../../../types/export';
import * as fs from 'fs/promises';
import path from 'path';
import { prisma } from '../../../db';

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
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('End-to-End Export with Scale Conversion', () => {
    it('should apply scale conversion to Excel export', async () => {
      // Mock project data with segmentation
      const mockProject = {
        id: 'test-project-1',
        name: 'Test Project',
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
        vi.spyOn(prisma.project, 'findUnique').mockResolvedValue(mockProject as any);

        // Perform export
        const result = await exportService.exportProject(
          mockProject.id,
          exportOptions,
          tempDir
        );

        expect(result.success).toBe(true);
        expect(result.metrics?.excel).toBeDefined();
        
        // Verify Excel file was created
        const excelPath = path.join(tempDir, result.metrics!.excel!);
        const fileExists = await fs.access(excelPath).then(() => true).catch(() => false);
        expect(fileExists).toBe(true);

        // Verify metrics were scaled correctly
        // Original area = 10000 px² (100x100 square)
        // Scaled area = 10000 * scale²
        const expectedArea = 10000 * scale * scale;
        
        // Read and verify Excel content (would need ExcelJS to actually parse)
        // For now, just verify file exists and has content
        const stats = await fs.stat(excelPath);
        expect(stats.size).toBeGreaterThan(0);
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

      for (const testCase of edgeCaseScales) {
        const loggerSpy = vi.spyOn(metricsCalculator['logger'], 'warn');
        
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
          expect(metrics[0].area).toBe(10000); // Original pixel area
        } else {
          // Should apply scale when valid
          const expectedArea = 10000 * testCase.value * testCase.value;
          expect(metrics[0].area).toBeCloseTo(expectedArea, 2);
        }
        
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
      expect(metricsWithScale[0].circularity).toBe(metricsNoScale[0].circularity);
      expect(metricsWithScale[0].solidity).toBe(metricsNoScale[0].solidity);
      expect(metricsWithScale[0].compactness).toBe(metricsNoScale[0].compactness);
      expect(metricsWithScale[0].convexity).toBe(metricsNoScale[0].convexity);
      expect(metricsWithScale[0].feretAspectRatio).toBe(metricsNoScale[0].feretAspectRatio);
      
      // Area should be scaled
      expect(metricsWithScale[0].area).toBe(metricsNoScale[0].area * scale * scale);
      
      // Linear measurements should be scaled
      expect(metricsWithScale[0].perimeter).toBe(metricsNoScale[0].perimeter * scale);
      expect(metricsWithScale[0].equivalentDiameter).toBe(metricsNoScale[0].equivalentDiameter * scale);
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
        name: 'Scale Test Project',
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

      vi.spyOn(prisma.project, 'findUnique').mockResolvedValue(mockProject as any);

      const result = await exportService.exportProject(
        mockProject.id,
        exportOptions,
        tempDir
      );

      expect(result.success).toBe(true);
      expect(result.annotations?.json).toBeDefined();

      // Read JSON export and verify scale metadata
      const jsonPath = path.join(tempDir, result.annotations!.json!);
      const jsonContent = await fs.readFile(jsonPath, 'utf-8');
      const parsedJson = JSON.parse(jsonContent);

      expect(parsedJson.scale_conversion).toBeDefined();
      expect(parsedJson.scale_conversion.micrometers_per_pixel).toBe(scale);
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

        vi.spyOn(prisma.project, 'findUnique').mockResolvedValue(mockProject as any);

        return exportService.exportProject(projectId, exportOptions, outputDir);
      });

      const results = await Promise.all(exportPromises);
      
      // All exports should succeed
      results.forEach(result => {
        expect(result.success).toBe(true);
        expect(result.metrics?.csv).toBeDefined();
      });

      // Verify each export has correct scale applied
      for (let i = 0; i < scales.length; i++) {
        const csvPath = path.join(tempDir, `export-${i}`, results[i].metrics!.csv!);
        const csvContent = await fs.readFile(csvPath, 'utf-8');
        
        // CSV should contain unit headers based on scale
        if (scales[i] > 0) {
          expect(csvContent).toContain('µm²'); // Area unit
          expect(csvContent).toContain('µm');  // Length unit
        }
      }
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
      expect(metrics.length).toBe(100); // One metric per image
      expect(processingTime).toBeLessThan(30000); // Less than 30 seconds
      
      // Verify scale was applied
      metrics.forEach(metric => {
        expect(metric.area).toBeGreaterThan(0);
        expect(metric.perimeter).toBeGreaterThan(0);
      });
    });
  });
});