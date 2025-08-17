import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import {
  Download,
  FileImage,
  FileJson,
  FileSpreadsheet,
  Package,
  Settings,
  Palette,
  FileText,
  Archive,
  WifiOff,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { useAdvancedExport } from './hooks/useAdvancedExport';
import { useLanguage } from '@/contexts/LanguageContext';
import { ProjectImage } from '@/types';

interface AdvancedExportDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
  images: ProjectImage[];
  selectedImageIds?: string[];
}

export const AdvancedExportDialog: React.FC<AdvancedExportDialogProps> = ({
  open,
  onClose,
  projectId,
  projectName,
  images,
  selectedImageIds,
}) => {
  const { t } = useLanguage();
  const {
    exportOptions,
    updateExportOptions,
    startExport,
    exportProgress,
    exportStatus,
    isExporting,
    cancelExport,
    triggerDownload,
    completedJobId,
    wsConnected,
    currentJob,
  } = useAdvancedExport(projectId);

  const [activeTab, setActiveTab] = useState('general');

  // Set default selected images
  useEffect(() => {
    if (selectedImageIds) {
      updateExportOptions({ selectedImageIds });
    }
  }, [selectedImageIds, updateExportOptions]);

  const handleExport = async () => {
    try {
      await startExport(projectName);
      toast.success(t('toast.exportCompleted'));
      onClose();
    } catch (error) {
      toast.error(t('toast.exportFailed'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            {t('export.advancedOptions')}
          </DialogTitle>
          <DialogDescription>
            {t('export.configureSettings')}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="general">{t('export.general')}</TabsTrigger>
            <TabsTrigger value="visualization">{t('export.visualization')}</TabsTrigger>
            <TabsTrigger value="formats">{t('export.formats')}</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileImage className="h-4 w-4" />
                  {t('export.exportContents')}
                </CardTitle>
                <CardDescription>
                  {t('export.selectContent')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="original-images"
                    checked={exportOptions.includeOriginalImages}
                    onCheckedChange={checked =>
                      updateExportOptions({ includeOriginalImages: !!checked })
                    }
                  />
                  <Label htmlFor="original-images">
                    {t('export.includeOriginal')}
                  </Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="visualizations"
                    checked={exportOptions.includeVisualizations}
                    onCheckedChange={checked =>
                      updateExportOptions({ includeVisualizations: !!checked })
                    }
                  />
                  <Label htmlFor="visualizations">
                    {t('export.includeVisualizations')}
                  </Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="documentation"
                    checked={exportOptions.includeDocumentation}
                    onCheckedChange={checked =>
                      updateExportOptions({ includeDocumentation: !!checked })
                    }
                  />
                  <Label htmlFor="documentation">
                    {t('export.includeDocumentation')}
                  </Label>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('export.selectedImages')}</CardTitle>
                <CardDescription>
                  {t('export.imagesSelected', {
                    count: exportOptions.selectedImageIds?.length || images.length,
                    total: images.length
                  })}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-sm text-muted-foreground">
                  {exportOptions.selectedImageIds?.length === 0 ||
                  !exportOptions.selectedImageIds
                    ? 'All images will be exported'
                    : `Exporting ${exportOptions.selectedImageIds.length} selected images`}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="visualization" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Palette className="h-4 w-4" />
                  {t('export.colorSettings')}
                </CardTitle>
                <CardDescription>
                  {t('export.colorSettings')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="show-numbers"
                    checked={exportOptions.visualizationOptions?.showNumbers}
                    onCheckedChange={checked =>
                      updateExportOptions({
                        visualizationOptions: {
                          ...exportOptions.visualizationOptions,
                          showNumbers: !!checked,
                        },
                      })
                    }
                  />
                  <Label htmlFor="show-numbers">{t('export.showNumbers')}</Label>
                </div>

                <div className="space-y-2">
                  <Label>{t('export.strokeColor')}</Label>
                  <div className="flex gap-2">
                    <Input
                      type="color"
                      value={
                        exportOptions.visualizationOptions?.polygonColors
                          ?.external || '#FF0000'
                      }
                      onChange={e =>
                        updateExportOptions({
                          visualizationOptions: {
                            ...exportOptions.visualizationOptions,
                            polygonColors: {
                              ...exportOptions.visualizationOptions
                                ?.polygonColors,
                              external: e.target.value,
                            },
                          },
                        })
                      }
                      className="w-20"
                    />
                    <Input
                      value={
                        exportOptions.visualizationOptions?.polygonColors
                          ?.external || '#FF0000'
                      }
                      onChange={e =>
                        updateExportOptions({
                          visualizationOptions: {
                            ...exportOptions.visualizationOptions,
                            polygonColors: {
                              ...exportOptions.visualizationOptions
                                ?.polygonColors,
                              external: e.target.value,
                            },
                          },
                        })
                      }
                      className="flex-1"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>{t('export.backgroundColor')}</Label>
                  <div className="flex gap-2">
                    <Input
                      type="color"
                      value={
                        exportOptions.visualizationOptions?.polygonColors
                          ?.internal || '#0000FF'
                      }
                      onChange={e =>
                        updateExportOptions({
                          visualizationOptions: {
                            ...exportOptions.visualizationOptions,
                            polygonColors: {
                              ...exportOptions.visualizationOptions
                                ?.polygonColors,
                              internal: e.target.value,
                            },
                          },
                        })
                      }
                      className="w-20"
                    />
                    <Input
                      value={
                        exportOptions.visualizationOptions?.polygonColors
                          ?.internal || '#0000FF'
                      }
                      onChange={e =>
                        updateExportOptions({
                          visualizationOptions: {
                            ...exportOptions.visualizationOptions,
                            polygonColors: {
                              ...exportOptions.visualizationOptions
                                ?.polygonColors,
                              internal: e.target.value,
                            },
                          },
                        })
                      }
                      className="flex-1"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>
                    {t('export.strokeWidth')}:{' '}
                    {exportOptions.visualizationOptions?.strokeWidth || 2}px
                  </Label>
                  <Slider
                    value={[
                      exportOptions.visualizationOptions?.strokeWidth || 2,
                    ]}
                    onValueChange={([value]) =>
                      updateExportOptions({
                        visualizationOptions: {
                          ...exportOptions.visualizationOptions,
                          strokeWidth: value,
                        },
                      })
                    }
                    min={1}
                    max={10}
                    step={1}
                  />
                </div>

                <div className="space-y-2">
                  <Label>
                    {t('export.fontSize')}:{' '}
                    {exportOptions.visualizationOptions?.fontSize || 24}px
                  </Label>
                  <Slider
                    value={[exportOptions.visualizationOptions?.fontSize || 24]}
                    onValueChange={([value]) =>
                      updateExportOptions({
                        visualizationOptions: {
                          ...exportOptions.visualizationOptions,
                          fontSize: value,
                        },
                      })
                    }
                    min={10}
                    max={30}
                    step={2}
                  />
                </div>

                <div className="space-y-2">
                  <Label>
                    Transparency:{' '}
                    {Math.round(
                      (exportOptions.visualizationOptions?.transparency ||
                        0.3) * 100
                    )}
                    %
                  </Label>
                  <Slider
                    value={[
                      (exportOptions.visualizationOptions?.transparency ||
                        0.3) * 100,
                    ]}
                    onValueChange={([value]) =>
                      updateExportOptions({
                        visualizationOptions: {
                          ...exportOptions.visualizationOptions,
                          transparency: value / 100,
                        },
                      })
                    }
                    min={0}
                    max={100}
                    step={10}
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="formats" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileJson className="h-4 w-4" />
                  {t('export.exportFormats')}
                </CardTitle>
                <CardDescription>
                  {t('export.exportFormats')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="coco-format"
                    checked={exportOptions.annotationFormats?.includes('coco')}
                    onCheckedChange={checked => {
                      const formats = exportOptions.annotationFormats || [];
                      updateExportOptions({
                        annotationFormats: checked
                          ? [...formats, 'coco']
                          : formats.filter(f => f !== 'coco'),
                      });
                    }}
                  />
                  <Label htmlFor="coco-format">
                    {t('export.includeCocoFormat')}
                  </Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="yolo-format"
                    checked={exportOptions.annotationFormats?.includes('yolo')}
                    onCheckedChange={checked => {
                      const formats = exportOptions.annotationFormats || [];
                      updateExportOptions({
                        annotationFormats: checked
                          ? [...formats, 'yolo']
                          : formats.filter(f => f !== 'yolo'),
                      });
                    }}
                  />
                  <Label htmlFor="yolo-format">
                    YOLO format
                  </Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="json-format"
                    checked={exportOptions.annotationFormats?.includes('json')}
                    onCheckedChange={checked => {
                      const formats = exportOptions.annotationFormats || [];
                      updateExportOptions({
                        annotationFormats: checked
                          ? [...formats, 'json']
                          : formats.filter(f => f !== 'json'),
                      });
                    }}
                  />
                  <Label htmlFor="json-format">{t('export.includeJsonMetadata')}</Label>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4" />
                  {t('export.outputSettings')}
                </CardTitle>
                <CardDescription>
                  {t('export.generateExcel')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="excel-metrics"
                    checked={exportOptions.metricsFormats?.includes('excel')}
                    onCheckedChange={checked => {
                      const formats = exportOptions.metricsFormats || [];
                      updateExportOptions({
                        metricsFormats: checked
                          ? [...formats, 'excel']
                          : formats.filter(f => f !== 'excel'),
                      });
                    }}
                  />
                  <Label htmlFor="excel-metrics">Excel (.xlsx)</Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="csv-metrics"
                    checked={exportOptions.metricsFormats?.includes('csv')}
                    onCheckedChange={checked => {
                      const formats = exportOptions.metricsFormats || [];
                      updateExportOptions({
                        metricsFormats: checked
                          ? [...formats, 'csv']
                          : formats.filter(f => f !== 'csv'),
                      });
                    }}
                  />
                  <Label htmlFor="csv-metrics">
                    CSV (Comma-separated values)
                  </Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="json-metrics"
                    checked={exportOptions.metricsFormats?.includes('json')}
                    onCheckedChange={checked => {
                      const formats = exportOptions.metricsFormats || [];
                      updateExportOptions({
                        metricsFormats: checked
                          ? [...formats, 'json']
                          : formats.filter(f => f !== 'json'),
                      });
                    }}
                  />
                  <Label htmlFor="json-metrics">JSON</Label>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('export.completed')}</CardTitle>
                <CardDescription>
                  {t('export.configureSettings')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div>
                  • Images:{' '}
                  {exportOptions.selectedImageIds?.length || images.length}
                </div>
                {exportOptions.includeOriginalImages && (
                  <div>• Original images included</div>
                )}
                {exportOptions.includeVisualizations && (
                  <div>• Visualizations with numbered polygons</div>
                )}
                {exportOptions.annotationFormats?.length > 0 && (
                  <div>
                    • Annotations:{' '}
                    {exportOptions.annotationFormats.join(', ').toUpperCase()}
                  </div>
                )}
                {exportOptions.metricsFormats?.length > 0 && (
                  <div>
                    • Metrics:{' '}
                    {exportOptions.metricsFormats.join(', ').toUpperCase()}
                  </div>
                )}
                {exportOptions.includeDocumentation && (
                  <div>• Documentation and metadata</div>
                )}
                <div>• No compression (full quality)</div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Connection Status */}
        {!wsConnected && (
          <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <WifiOff className="h-4 w-4 text-amber-600" />
            <span className="text-sm text-amber-800">
              WebSocket connection lost. Using fallback polling for updates.
            </span>
          </div>
        )}

        {/* Export Progress */}
        {isExporting && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>{exportStatus}</span>
              <span>{Math.round(exportProgress)}%</span>
            </div>
            <Progress value={exportProgress} className="w-full" />
          </div>
        )}

        {/* Completed Export - Manual Download */}
        {completedJobId &&
          !isExporting &&
          currentJob?.status === 'completed' && (
            <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
              <AlertCircle className="h-4 w-4 text-green-600" />
              <div className="flex-1">
                <span className="text-sm text-green-800">
                  Export completed successfully! Click below to download if it
                  didn't start automatically.
                </span>
              </div>
              <Button size="sm" onClick={triggerDownload} className="ml-2">
                <Download className="h-4 w-4 mr-1" />
                {t('export.download')}
              </Button>
            </div>
          )}

        {/* Failed Export */}
        {currentJob?.status === 'failed' && (
          <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
            <AlertCircle className="h-4 w-4 text-red-600" />
            <span className="text-sm text-red-800">
              Export failed: {currentJob.message || 'Unknown error'}
            </span>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isExporting}>
            {t('export.cancel')}
          </Button>
          {isExporting ? (
            <Button onClick={cancelExport} variant="destructive">
              {t('export.cancel')}
            </Button>
          ) : (
            <Button onClick={handleExport} disabled={isExporting}>
              <Download className="mr-2 h-4 w-4" />
              {t('export.startExport')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
