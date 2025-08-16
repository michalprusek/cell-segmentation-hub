
import React from 'react';
import { SegmentationResult } from '@/lib/segmentation';
import { FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import * as XLSX from 'xlsx';
import { SpheroidMetric } from '@/types';
import { calculateMetrics } from '../../../utils/metricCalculations';

interface ExcelExporterProps {
  segmentation: SegmentationResult | null;
  imageName?: string;
}

const ExcelExporter: React.FC<ExcelExporterProps> = ({ segmentation, imageName }) => {
  if (!segmentation || !segmentation.polygons) return null;
  
  const handleExportXlsx = async () => {
    if (!segmentation || !segmentation.polygons) return;
    
    try {
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
      
      // Create workbook and worksheet using SheetJS
      const workbook = XLSX.utils.book_new();
      
      // Prepare data with headers
      const worksheetData = [
        [
          'Image Name',
          'Contour',
          'Area',
          'Circularity',
          'Compactness',
          'Convexity',
          'Equivalent Diameter',
          'Aspect Ratio',
          'Feret Diameter Max',
          'Feret Diameter Max Orthogonal',
          'Feret Diameter Min',
          'Length Major Diameter',
          'Length Minor Diameter',
          'Perimeter',
          'Solidity',
          'Sphericity'
        ],
        ...metricsData.map(metric => [
          metric.imageName,
          metric.contourNumber,
          metric.area,
          metric.circularity,
          metric.compactness,
          metric.convexity,
          metric.equivalentDiameter,
          metric.aspectRatio,
          metric.feretDiameterMax,
          metric.feretDiameterMaxOrthogonal,
          metric.feretDiameterMin,
          metric.lengthMajorDiameter,
          metric.lengthMinorDiameter,
          metric.perimeter,
          metric.solidity,
          metric.sphericity
        ])
      ];
      
      // Create worksheet
      const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
      
      // Add worksheet to workbook
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Spheroid Metrics');
      
      // Download file
      const filename = `${imageName || 'spheroid'}_metrics.xlsx`;
      XLSX.writeFile(workbook, filename);
      
    } catch (error) {
      console.error('Failed to export Excel file:', error);
      // You could add a toast notification here if available in the project
      // toast.error('Failed to export Excel file. Please try again.');
      alert('Failed to export Excel file. Please try again.');
      throw error; // Re-throw for any caller handling
    }
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
