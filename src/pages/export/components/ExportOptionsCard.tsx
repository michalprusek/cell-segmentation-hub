
import React from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { Card, CardHeader, CardContent, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

interface ExportOptionsCardProps {
  includeMetadata: boolean;
  setIncludeMetadata: (value: boolean) => void;
  includeSegmentation: boolean;
  setIncludeSegmentation: (value: boolean) => void;
  includeObjectMetrics: boolean;
  setIncludeObjectMetrics: (value: boolean) => void;
  handleExportMetricsAsXlsx: () => void;
  getSelectedCount: () => number;
  isExporting: boolean;
}

const ExportOptionsCard: React.FC<ExportOptionsCardProps> = ({
  includeMetadata,
  setIncludeMetadata,
  includeSegmentation,
  setIncludeSegmentation,
  includeObjectMetrics,
  setIncludeObjectMetrics,
  handleExportMetricsAsXlsx,
  getSelectedCount,
  isExporting
}) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Možnosti exportu</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-center space-x-2">
            <Checkbox 
              id="include-metadata" 
              checked={includeMetadata} 
              onCheckedChange={() => setIncludeMetadata(!includeMetadata)} 
            />
            <Label htmlFor="include-metadata">Zahrnout metadata</Label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox 
              id="include-segmentation" 
              checked={includeSegmentation} 
              onCheckedChange={() => setIncludeSegmentation(!includeSegmentation)} 
            />
            <Label htmlFor="include-segmentation">Zahrnout segmentaci</Label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox 
              id="include-object-metrics" 
              checked={includeObjectMetrics} 
              onCheckedChange={() => setIncludeObjectMetrics(!includeObjectMetrics)} 
            />
            <Label htmlFor="include-object-metrics">Zahrnout metriky objektů</Label>
          </div>
          
          {includeObjectMetrics && (
            <div className="mt-4">
              <Button
                variant="outline"
                size="sm"
                className="flex items-center w-full"
                onClick={handleExportMetricsAsXlsx}
                disabled={getSelectedCount() === 0 || isExporting}
              >
                <FileSpreadsheet className="mr-2 h-4 w-4" />
                Exportovat pouze metriky (XLSX)
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default ExportOptionsCard;
