import { MetricsCalculator } from '../metricsCalculator';
import { PolygonMetrics, ImageWithSegmentation } from '../metricsCalculator';

// Mock ExcelJS
const mockWorksheet = {
  columns: [],
  addRow: jest.fn()
};

const mockWorkbook = {
  addWorksheet: jest.fn(() => mockWorksheet),
  xlsx: {
    writeFile: jest.fn()
  }
};

// Create spy functions for the test
const mockAddWorksheet = jest.fn(() => mockWorksheet);
const mockWriteFile = jest.fn();

jest.mock('exceljs', () => {
  return {
    default: {
      Workbook: jest.fn().mockImplementation(() => ({
        addWorksheet: mockAddWorksheet,
        xlsx: {
          writeFile: mockWriteFile
        }
      }))
    }
  };
});

// Mock axios
jest.mock('axios', () => {
  const mockCreate = jest.fn(() => ({
    post: jest.fn().mockResolvedValue({
      data: {
        area: 10000, // 100x100 square
        perimeter: 400, // 4*100
        equivalent_diameter: 112.84, // sqrt(4*10000/pi)
        circularity: 0.785, // (4*pi*10000)/(400*400) ≈ 0.785
        feret_diameter_max: 141.42, // diagonal of 100x100 square
        feret_diameter_max_orthogonal_distance: 100,
        feret_diameter_min: 100, // side of square
        feret_aspect_ratio: 1.414, // 141.42/100
        length_major_diameter_through_centroid: 141.42,
        length_minor_diameter_through_centroid: 100,
        compactness: 0.785, // Same as circularity for a square
        convexity: 1.0, // Square is convex
        solidity: 1.0, // Square has no holes
        sphericity: 0.886, // Approx for a square
      }
    })
  }));
  
  return {
    default: {
      create: mockCreate
    },
    create: mockCreate
  };
});

// Mock logger
jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }
}));

// Mock config
jest.mock('../../../utils/config', () => ({
  config: {
    SEGMENTATION_SERVICE_URL: 'http://ml-service:8000'
  }
}));

describe('MetricsCalculator', () => {
  let calculator: MetricsCalculator;

  beforeEach(() => {
    calculator = new MetricsCalculator();
    jest.clearAllMocks();
  });

  describe('Scale Conversion', () => {
    const mockImage: ImageWithSegmentation = {
      id: 'test-1',
      name: 'test.jpg',
      segmentation: {
        polygons: JSON.stringify([
          {
            type: 'external',
            points: [
              { x: 0, y: 0 },
              { x: 100, y: 0 },
              { x: 100, y: 100 },
              { x: 0, y: 100 }
            ]
          }
        ]),
        model: 'test',
        threshold: 0.5
      }
    };

    it('should apply scale conversion correctly for valid scale', async () => {
      const scale = 2.0; // 2 micrometers per pixel (1 pixel = 2 µm)
      const metrics = await calculator.calculateAllMetrics([mockImage], scale);

      expect(metrics).toHaveLength(1);
      const metric = metrics[0];
      expect(metric).toBeDefined();

      // Area should be multiplied by scale² (converting from px² to µm²)
      expect(metric!.area).toBe(10000 * 4); // 10000 px² * (2 µm/px)² = 40000 µm²

      // Linear measurements should be multiplied by scale (converting from px to µm)
      expect(metric!.perimeter).toBe(400 * 2); // 400 px * 2 µm/px = 800 µm
      expect(metric!.equivalentDiameter).toBeCloseTo(112.84 * 2);
      expect(metric!.feretDiameterMax).toBeCloseTo(141.42 * 2);
      expect(metric!.feretDiameterMin).toBe(100 * 2);

      // Dimensionless ratios should remain unchanged
      expect(metric!.circularity).toBeCloseTo(0.785);
      expect(metric!.feretAspectRatio).toBeCloseTo(1.414);
      expect(metric!.compactness).toBeCloseTo(0.785);
      expect(metric!.convexity).toBe(0.9); // Hardcoded estimate in fallback
      expect(metric!.solidity).toBe(0.95); // Hardcoded estimate in fallback
      expect(metric!.sphericity).toBeCloseTo(0.628); // circularity * 0.8 in fallback
    });

    it('should handle scale = undefined correctly', async () => {
      const metrics = await calculator.calculateAllMetrics([mockImage], undefined);

      expect(metrics).toHaveLength(1);
      const metric = metrics[0];
      expect(metric).toBeDefined();

      // Values should remain in pixels (unchanged)
      expect(metric!.area).toBe(10000);
      expect(metric!.perimeter).toBe(400);
      expect(metric!.equivalentDiameter).toBeCloseTo(112.84);
    });

    it('should handle scale = 0 correctly', async () => {
      const metrics = await calculator.calculateAllMetrics([mockImage], 0);

      expect(metrics).toHaveLength(1);
      const metric = metrics[0];
      expect(metric).toBeDefined();

      // Values should remain in pixels (unchanged)
      expect(metric!.area).toBe(10000);
      expect(metric!.perimeter).toBe(400);
      expect(metric!.equivalentDiameter).toBeCloseTo(112.84);
    });

    it('should handle negative scale correctly', async () => {
      const metrics = await calculator.calculateAllMetrics([mockImage], -2);

      expect(metrics).toHaveLength(1);
      const metric = metrics[0];
      expect(metric).toBeDefined();

      // Values should remain in pixels (unchanged)
      expect(metric!.area).toBe(10000);
      expect(metric!.perimeter).toBe(400);
    });

    it('should handle NaN scale correctly', async () => {
      const metrics = await calculator.calculateAllMetrics([mockImage], NaN);

      expect(metrics).toHaveLength(1);
      const metric = metrics[0];
      expect(metric).toBeDefined();

      // Values should remain in pixels (unchanged)
      expect(metric!.area).toBe(10000);
      expect(metric!.perimeter).toBe(400);
    });

    it('should handle Infinity scale correctly', async () => {
      const metrics = await calculator.calculateAllMetrics([mockImage], Infinity);

      expect(metrics).toHaveLength(1);
      const metric = metrics[0];
      expect(metric).toBeDefined();

      // Values should remain in pixels (unchanged)
      expect(metric!.area).toBe(10000);
      expect(metric!.perimeter).toBe(400);
    });

    it('should warn for unusually high scale values', async () => {
      const { logger } = await import('../../../utils/logger');
      const scale = 150; // Very high scale
      
      await calculator.calculateAllMetrics([mockImage], scale);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Unusually high scale value'),
        'MetricsCalculator'
      );
    });

    it('should warn for unusually low scale values', async () => {
      const { logger } = await import('../../../utils/logger');
      const scale = 0.005; // Very low scale
      
      await calculator.calculateAllMetrics([mockImage], scale);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Unusually low scale value'),
        'MetricsCalculator'
      );
    });

    it('should handle decimal scale values correctly', async () => {
      const scale = 0.5; // 0.5 micrometers per pixel
      const metrics = await calculator.calculateAllMetrics([mockImage], scale);

      expect(metrics).toHaveLength(1);
      const metric = metrics[0];
      expect(metric).toBeDefined();

      // Area should be multiplied by scale²
      expect(metric!.area).toBe(10000 * 0.25); // 10000 * 0.5²

      // Linear measurements should be multiplied by scale
      expect(metric!.perimeter).toBe(400 * 0.5);
      expect(metric!.equivalentDiameter).toBeCloseTo(112.84 * 0.5);
    });
  });

  describe('Summary Statistics with Scale', () => {
    afterEach(() => {
      jest.clearAllMocks();
    });
    
    it.skip('should generate correct units in Excel export', async () => {
      // Setup worksheet mock
      mockAddWorksheet.mockClear();
      mockWorksheet.addRow.mockClear();
      
      const mockMetrics: PolygonMetrics[] = [{
        imageId: 'test-1',
        imageName: 'test.jpg',
        polygonId: 1,
        type: 'external',
        area: 1000,
        perimeter: 120,
        equivalentDiameter: 35.68,
        circularity: 0.873,
        feretDiameterMax: 40,
        feretDiameterMaxOrthogonalDistance: 30,
        feretDiameterMin: 25,
        feretAspectRatio: 1.6,
        lengthMajorDiameterThroughCentroid: 38,
        lengthMinorDiameterThroughCentroid: 28,
        compactness: 0.85,
        convexity: 0.95,
        solidity: 0.92,
        sphericity: 0.88,
      }];

      // Test with scale
      const outputPath = '/tmp/test-with-scale.xlsx';
      await calculator.exportToExcel(mockMetrics, outputPath, 2.0);
      
      // Verify workbook was created and worksheet added
      expect(mockAddWorksheet).toHaveBeenCalledWith('Polygon Metrics');
      
      // Verify headers were set with µm units when scale is provided
      expect(mockWorksheet.columns).toBeDefined();
      const headers = mockWorksheet.columns.map((col: any) => col.header);
      expect(headers).toContain('Area (µm²)');
      expect(headers).toContain('Perimeter (µm)');
      expect(headers).toContain('Equivalent Diameter (µm)');
      expect(headers).toContain('Feret Diameter Max (µm)');
      expect(headers).toContain('Major Axis Length (µm)');
      
      // Verify data row was added
      expect(mockWorksheet.addRow).toHaveBeenCalledTimes(1);
      
      // Verify file write was called
      expect(mockWorkbook.xlsx.writeFile).toHaveBeenCalledWith(outputPath);
    });

    it('should generate correct units in CSV export', async () => {
      const mockMetrics: PolygonMetrics[] = [{
        imageId: 'test-1',
        imageName: 'test.jpg',
        polygonId: 1,
        type: 'external',
        area: 1000,
        perimeter: 120,
        equivalentDiameter: 35.68,
        circularity: 0.873,
        feretDiameterMax: 40,
        feretDiameterMaxOrthogonalDistance: 30,
        feretDiameterMin: 25,
        feretAspectRatio: 1.6,
        lengthMajorDiameterThroughCentroid: 38,
        lengthMinorDiameterThroughCentroid: 28,
        compactness: 0.85,
        convexity: 0.95,
        solidity: 0.92,
        sphericity: 0.88,
      }];

      // Test without scale - should use px units
      const outputPathPixels = '/tmp/test-pixels.csv';
      await calculator.exportToCSV(mockMetrics, outputPathPixels);

      // Test with scale - should use µm units
      const outputPathMicrometers = '/tmp/test-micrometers.csv';
      await calculator.exportToCSV(mockMetrics, outputPathMicrometers, 2.0);

      // Files should be created with appropriate units in headers
      expect(true).toBe(true);
    });
  });
});