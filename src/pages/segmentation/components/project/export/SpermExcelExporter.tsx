import React, { useState } from 'react';
import { FileSpreadsheet, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SegmentationResult } from '@/lib/segmentation';
import { calculatePolylineLength } from '../../../utils/metricCalculations';
import { createExcelExport } from '@/services/excelExportService';
import { useLanguage } from '@/contexts/exports';

interface SpermExcelExporterProps {
  segmentation: SegmentationResult | null;
  imageName?: string;
}

const SpermExcelExporter: React.FC<SpermExcelExporterProps> = ({
  segmentation,
  imageName,
}) => {
  const { t } = useLanguage();
  const [calibration, setCalibration] = useState<string>('');
  const [isExporting, setIsExporting] = useState(false);

  if (!segmentation || !segmentation.polygons) return null;

  // Get only polylines
  const polylines = segmentation.polygons.filter(
    p => p.geometry === 'polyline'
  );

  if (polylines.length === 0) return null;

  // Group by instanceId
  const instanceGroups = new Map<string, typeof polylines>();
  for (const polyline of polylines) {
    const instanceId = polyline.instanceId || 'unassigned';
    if (!instanceGroups.has(instanceId)) {
      instanceGroups.set(instanceId, []);
    }
    instanceGroups.get(instanceId)!.push(polyline);
  }

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const excelService = await createExcelExport();
      const workbook = excelService.createWorkbook();
      const sheet = workbook.addWorksheet('Sperm Metrics');

      const calibrationFactor = calibration ? parseFloat(calibration) : undefined;
      const hasCalibration = calibrationFactor && calibrationFactor > 0;

      // Header row
      const headers = [
        'Image Name',
        'Instance ID',
        'Head Length (px)',
        ...(hasCalibration ? ['Head Length (um)'] : []),
        'Midpiece Length (px)',
        ...(hasCalibration ? ['Midpiece Length (um)'] : []),
        'Tail Length (px)',
        ...(hasCalibration ? ['Tail Length (um)'] : []),
        'Total Length (px)',
        ...(hasCalibration ? ['Total Length (um)'] : []),
      ];

      const headerRow = sheet.addRow(headers);
      headerRow.font = { bold: true };
      headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' },
      };
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };

      // Data rows
      for (const [instanceId, parts] of instanceGroups) {
        const headPolyline = parts.find(p => p.partClass === 'head');
        const midpiecePolyline = parts.find(p => p.partClass === 'midpiece');
        const tailPolyline = parts.find(p => p.partClass === 'tail');

        const headLengthPx = headPolyline
          ? calculatePolylineLength(headPolyline.points)
          : 0;
        const midpieceLengthPx = midpiecePolyline
          ? calculatePolylineLength(midpiecePolyline.points)
          : 0;
        const tailLengthPx = tailPolyline
          ? calculatePolylineLength(tailPolyline.points)
          : 0;
        const totalLengthPx = headLengthPx + midpieceLengthPx + tailLengthPx;

        const row = [
          imageName || 'unknown',
          instanceId,
          parseFloat(headLengthPx.toFixed(2)),
          ...(hasCalibration
            ? [parseFloat((headLengthPx * calibrationFactor).toFixed(2))]
            : []),
          parseFloat(midpieceLengthPx.toFixed(2)),
          ...(hasCalibration
            ? [parseFloat((midpieceLengthPx * calibrationFactor).toFixed(2))]
            : []),
          parseFloat(tailLengthPx.toFixed(2)),
          ...(hasCalibration
            ? [parseFloat((tailLengthPx * calibrationFactor).toFixed(2))]
            : []),
          parseFloat(totalLengthPx.toFixed(2)),
          ...(hasCalibration
            ? [parseFloat((totalLengthPx * calibrationFactor).toFixed(2))]
            : []),
        ];

        sheet.addRow(row);
      }

      // Auto-fit columns
      sheet.columns.forEach(column => {
        if (column.values) {
          let maxLength = 10;
          column.values.forEach(val => {
            if (val) {
              const length = val.toString().length;
              if (length > maxLength) maxLength = length;
            }
          });
          column.width = Math.min(maxLength + 2, 30);
        }
      });

      const buffer = await excelService.writeBuffer(workbook);
      const blob = excelService.createBlob(buffer as ArrayBuffer);
      const filename = `sperm_metrics_${imageName || 'export'}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      excelService.downloadFile(blob, filename);
    } catch (error) {
      console.error('Failed to export sperm metrics:', error);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="text-sm text-gray-600 dark:text-gray-400">
        {t('sperm.export.description')}
      </div>

      {/* Calibration input */}
      <div className="flex items-end gap-3">
        <div className="flex-1 max-w-xs">
          <Label htmlFor="calibration" className="text-xs">
            {t('sperm.export.calibration')}
          </Label>
          <Input
            id="calibration"
            type="number"
            min="0"
            step="0.001"
            placeholder="e.g. 0.065"
            value={calibration}
            onChange={e => setCalibration(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
        <span className="text-xs text-gray-500 pb-2">um/px</span>
      </div>

      {/* Summary */}
      <div className="text-xs text-gray-500 dark:text-gray-400">
        {instanceGroups.size} {t('sperm.export.instances')}, {polylines.length}{' '}
        {t('sperm.export.polylines')}
      </div>

      {/* Export button */}
      <Button
        variant="default"
        size="sm"
        onClick={handleExport}
        disabled={isExporting}
        className="text-xs"
      >
        {isExporting ? (
          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
        ) : (
          <FileSpreadsheet className="h-4 w-4 mr-1" />
        )}
        {t('sperm.export.button')}
      </Button>
    </div>
  );
};

export default SpermExcelExporter;
