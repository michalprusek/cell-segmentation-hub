
import React from 'react';
import { SegmentationResult } from '@/lib/segmentation';
import { FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { utils, writeFile } from 'xlsx';
import { SpheroidMetric } from '@/types';
import { calculateMetrics } from '../../../utils/metricCalculations';

interface ExcelExporterProps {
  segmentation: SegmentationResult | null;
  imageName?: string;
}

const ExcelExporter: React.FC<ExcelExporterProps> = ({ segmentation, imageName }) => {
  if (!segmentation || !segmentation.polygons) return null;
  
  const handleExportXlsx = () => {
    if (!segmentation || !segmentation.polygons) return;
    
    // Get only external polygons
    const externalPolygons = segmentation.polygons.filter(polygon => polygon.type === 'external');
    
    // Calculate metrics for each external polygon
    const metricsData: SpheroidMetric[] = externalPolygons.map((polygon, index) => {
      // Find internal polygons (holes) related to this external polygon
      const holes = segmentation.polygons.filter(p => p.type === 'internal');
      
      // Calculate metrics with holes considered
      const metrics = calculateMetrics(polygon, holes);
      
      return {
        imageId: segmentation.id || '',
        imageName: imageName || 'unnamed',
        contourNumber: index + 1,
        area: metrics.Area,
        perimeter: metrics.Perimeter,
        circularity: metrics.Circularity,
        compactness: metrics.Compactness,
        convexity: metrics.Convexity,
        equivalentDiameter: metrics.EquivalentDiameter,
        aspectRatio: metrics.FeretAspectRatio,
        feretDiameterMax: metrics.FeretDiameterMax,
        feretDiameterMaxOrthogonal: metrics.FeretDiameterMaxOrthogonalDistance,
        feretDiameterMin: metrics.FeretDiameterMin,
        lengthMajorDiameter: metrics.LengthMajorDiameterThroughCentroid,
        lengthMinorDiameter: metrics.LengthMinorDiameterThroughCentroid,
        solidity: metrics.Solidity,
        sphericity: metrics.Sphericity
      };
    });
    
    // Create worksheet
    const worksheet = utils.json_to_sheet(metricsData.map(metric => ({
      'Image Name': metric.imageName,
      'Contour': metric.contourNumber,
      'Area': metric.area,
      'Circularity': metric.circularity,
      'Compactness': metric.compactness,
      'Convexity': metric.convexity,
      'Equivalent Diameter': metric.equivalentDiameter,
      'Aspect Ratio': metric.aspectRatio,
      'Feret Diameter Max': metric.feretDiameterMax,
      'Feret Diameter Max Orthogonal': metric.feretDiameterMaxOrthogonal,
      'Feret Diameter Min': metric.feretDiameterMin,
      'Length Major Diameter': metric.lengthMajorDiameter,
      'Length Minor Diameter': metric.lengthMinorDiameter,
      'Perimeter': metric.perimeter,
      'Solidity': metric.solidity,
      'Sphericity': metric.sphericity
    })));
    
    // Set column widths
    const colWidths = [
      { wch: 15 }, // Image Name
      { wch: 8 },  // Contour
      { wch: 10 }, // Area
      { wch: 10 }, // Circularity
      { wch: 10 }, // Compactness
      { wch: 10 }, // Convexity
      { wch: 18 }, // Equivalent Diameter
      { wch: 10 }, // Aspect Ratio
      { wch: 16 }, // Feret Diameter Max
      { wch: 25 }, // Feret Diameter Max Orthogonal
      { wch: 16 }, // Feret Diameter Min
      { wch: 20 }, // Length Major Diameter
      { wch: 20 }, // Length Minor Diameter
      { wch: 10 }, // Perimeter
      { wch: 10 }, // Solidity
      { wch: 10 }  // Sphericity
    ];
    
    worksheet['!cols'] = colWidths;
    
    // Create workbook
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, worksheet, 'Spheroid Metrics');
    
    // Download
    const filename = `${imageName || 'spheroid'}_metrics.xlsx`;
    writeFile(workbook, filename);
  };
  
  return (
    <Button 
      variant="default" 
      size="sm" 
      onClick={handleExportXlsx}
      className="text-xs"
    >
      <FileSpreadsheet className="h-4 w-4 mr-1" />
      Exportovat všechny metriky jako XLSX
    </Button>
  );
};

export default ExcelExporter;
