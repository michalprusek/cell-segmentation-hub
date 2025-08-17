import React from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { Card, CardHeader, CardContent, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useLanguage } from '@/contexts/LanguageContext';

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
  isExporting,
}) => {
  const { t } = useLanguage();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('exportDialog.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="include-metadata"
              checked={includeMetadata}
              onCheckedChange={() => setIncludeMetadata(!includeMetadata)}
            />
            <Label htmlFor="include-metadata">
              {t('exportDialog.includeMetadata')}
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="include-segmentation"
              checked={includeSegmentation}
              onCheckedChange={() =>
                setIncludeSegmentation(!includeSegmentation)
              }
            />
            <Label htmlFor="include-segmentation">
              {t('exportDialog.includeSegmentation')}
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="include-object-metrics"
              checked={includeObjectMetrics}
              onCheckedChange={() =>
                setIncludeObjectMetrics(!includeObjectMetrics)
              }
            />
            <Label htmlFor="include-object-metrics">
              {t('exportDialog.includeObjectMetrics')}
            </Label>
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
                {t('exportDialog.exportMetricsOnly')}
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default ExportOptionsCard;
