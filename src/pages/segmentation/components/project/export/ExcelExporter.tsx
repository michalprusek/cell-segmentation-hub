import { logger } from '@/lib/logger';

import React from 'react';
import { SegmentationResult } from '@/lib/segmentation';
import { FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SpheroidMetric } from '@/types';
import { calculateMetrics } from '../../../utils/metricCalculations';
import { isPolygonInsidePolygon } from '@/lib/polygonGeometry';
import { createExcelExport } from '@/services/excelExportService';

interface ExcelExporterProps {
  segmentation: SegmentationResult | null;
  imageName?: string;
}

const ExcelExporter: React.FC<ExcelExporterProps> = ({
  segmentation,
  imageName,
}) => {
  if (!segmentation || !segmentation.polygons) return null;

  const handleExportXlsx = async () => {
    if (!segmentation || !segmentation.polygons) return;

    try {
      // Get only external polygons
      const externalPolygons = segmentation.polygons.filter(
        polygon => polygon.type === 'external'
      );

      // Get all internal polygons
      const allInternalPolygons = segmentation.polygons.filter(
        p => p.type === 'internal'
      );

      // Calculate metrics for each external polygon - filter out invalid polygons
      const validExternalPolygons = externalPolygons.filter(
        (polygon, index) => {
          // Validate polygon points before processing
          if (!polygon.points || polygon.points.length < 3) {
            logger.warn(`Polygon ${index + 1} has invalid points, skipping`);
            return false;
          }
          return true;
        }
      );

      // Calculate metrics for each valid external polygon
      const metricsData: SpheroidMetric[] = validExternalPolygons.map(
        (polygon, index) => {
          // Find internal polygons (holes) that are actually inside this external polygon
          const holes = allInternalPolygons.filter(internal => {
            if (!internal.points || internal.points.length < 3) {
              return false; // Skip invalid internal polygons
            }
            return isPolygonInsidePolygon(internal.points, polygon.points);
          });

          // Calculate metrics with only the holes that are inside this polygon
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
            feretDiameterMaxOrthogonal:
              metrics.FeretDiameterMaxOrthogonalDistance,
            feretDiameterMin: metrics.FeretDiameterMin,
            lengthMajorDiameter: metrics.LengthMajorDiameterThroughCentroid,
            lengthMinorDiameter: metrics.LengthMinorDiameterThroughCentroid,
            solidity: metrics.Solidity,
            sphericity: metrics.Sphericity,
          };
        }
      );

      // Create workbook and worksheet using lazy-loaded ExcelJS
      const excelService = await createExcelExport();
      const workbook = excelService.createWorkbook();
      const worksheet = workbook.addWorksheet('Spheroid Metrics');

      // Add headers
      worksheet.columns = [
        { header: 'Image Name', key: 'imageName', width: 20 },
        { header: 'Contour', key: 'contourNumber', width: 10 },
        { header: 'Area', key: 'area', width: 15 },
        { header: 'Circularity', key: 'circularity', width: 15 },
        { header: 'Compactness', key: 'compactness', width: 15 },
        { header: 'Convexity', key: 'convexity', width: 15 },
        { header: 'Equivalent Diameter', key: 'equivalentDiameter', width: 20 },
        { header: 'Aspect Ratio', key: 'aspectRatio', width: 15 },
        { header: 'Feret Diameter Max', key: 'feretDiameterMax', width: 20 },
        {
          header: 'Feret Diameter Max Orthogonal',
          key: 'feretDiameterMaxOrthogonal',
          width: 25,
        },
        { header: 'Feret Diameter Min', key: 'feretDiameterMin', width: 20 },
        {
          header: 'Length Major Diameter',
          key: 'lengthMajorDiameter',
          width: 20,
        },
        {
          header: 'Length Minor Diameter',
          key: 'lengthMinorDiameter',
          width: 20,
        },
        { header: 'Perimeter', key: 'perimeter', width: 15 },
        { header: 'Solidity', key: 'solidity', width: 15 },
        { header: 'Sphericity', key: 'sphericity', width: 15 },
      ];

      // Add data rows
      metricsData.forEach(metric => {
        worksheet.addRow({
          imageName: metric.imageName,
          contourNumber: metric.contourNumber,
          area: metric.area,
          circularity: metric.circularity,
          compactness: metric.compactness,
          convexity: metric.convexity,
          equivalentDiameter: metric.equivalentDiameter,
          aspectRatio: metric.aspectRatio,
          feretDiameterMax: metric.feretDiameterMax,
          feretDiameterMaxOrthogonal: metric.feretDiameterMaxOrthogonal,
          feretDiameterMin: metric.feretDiameterMin,
          lengthMajorDiameter: metric.lengthMajorDiameter,
          lengthMinorDiameter: metric.lengthMinorDiameter,
          perimeter: metric.perimeter,
          solidity: metric.solidity,
          sphericity: metric.sphericity,
        });
      });

      // Style the header row
      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' },
      };

      // Generate Excel file buffer and download
      const buffer = await excelService.writeBuffer(workbook);
      const blob = excelService.createBlob(buffer);
      const filename = `${imageName || 'spheroid'}_metrics.xlsx`;
      excelService.downloadFile(blob, filename);
    } catch (error) {
      logger.error('Failed to export Excel file:', error);
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
