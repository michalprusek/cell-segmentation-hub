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
  X,
} from 'lucide-react';
import { useAdvancedExport } from './hooks/useAdvancedExport';
import { useLanguage } from '@/contexts/useLanguage';
import { ProjectImage } from '@/types';
import { EXPORT_DEFAULTS } from '@/lib/export-config';
import { ImageSelectionGrid } from './components/ImageSelectionGrid';
import { UniversalCancelButton } from '@/components/ui/universal-cancel-button';

interface AdvancedExportDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
  images: ProjectImage[];
  selectedImageIds?: string[];
  onExportingChange?: (isExporting: boolean) => void;
  onDownloadingChange?: (isDownloading: boolean) => void;
}

export const AdvancedExportDialog: React.FC<AdvancedExportDialogProps> =
  React.memo(
    ({
      open,
      onClose,
      projectId,
      projectName,
      images,
      selectedImageIds,
      onExportingChange,
      onDownloadingChange,
    }) => {
      const { t } = useLanguage();
      const {
        exportOptions,
        updateExportOptions,
        startExport,
        exportProgress,
        exportStatus,
        isExporting,
        isDownloading,
        cancelExport,
        triggerDownload,
        dismissExport,
        completedJobId,
        wsConnected,
        currentJob,
      } = useAdvancedExport(projectId);

      const [activeTab, setActiveTab] = useState('general');

      // Notify parent component when export state changes
      useEffect(() => {
        onExportingChange?.(isExporting);
      }, [isExporting, onExportingChange]);

      // Notify parent component when downloading state changes
      useEffect(() => {
        onDownloadingChange?.(isDownloading);
      }, [isDownloading, onDownloadingChange]);

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

            <Tabs
              value={activeTab}
              onValueChange={setActiveTab}
              className="w-full"
            >
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="general">{t('export.general')}</TabsTrigger>
                <TabsTrigger value="visualization">
                  {t('export.visualization')}
                </TabsTrigger>
                <TabsTrigger value="formats">
                  {t('export.formatsTab')}
                </TabsTrigger>
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
                          updateExportOptions({
                            includeOriginalImages: !!checked,
                          })
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
                          updateExportOptions({
                            includeVisualizations: !!checked,
                          })
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
                          updateExportOptions({
                            includeDocumentation: !!checked,
                          })
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
                    <CardTitle className="flex items-center gap-2">
                      <Settings className="h-4 w-4" />
                      {t('export.scaleConversion')}
                    </CardTitle>
                    <CardDescription>
                      {t('export.scaleDescription')}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="scale-input">
                        {t('export.pixelToMicrometerScale')} (
                        {t('export.scaleUnit')})
                      </Label>
                      <Input
                        id="scale-input"
                        type="number"
                        step="0.001"
                        min="0.001"
                        max="1000"
                        placeholder={t('export.scalePlaceholder')}
                        value={exportOptions.pixelToMicrometerScale || ''}
                        onChange={e => {
                          const value = e.target.value;

                          // Handle empty string
                          if (value === '') {
                            updateExportOptions({
                              pixelToMicrometerScale: undefined,
                            });
                            return;
                          }

                          const numValue = parseFloat(value);

                          // Handle NaN case by not updating
                          if (isNaN(numValue)) {
                            return;
                          }

                          // Round to 3 decimal places to match input precision
                          const roundedValue =
                            Math.round(numValue * 1000) / 1000;

                          // Validate rounded value: enforce min 0.001 and max 1000
                          if (roundedValue >= 0.001 && roundedValue <= 1000) {
                            updateExportOptions({
                              pixelToMicrometerScale: roundedValue,
                            });
                          }
                        }}
                        className="w-full"
                      />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <FileImage className="h-4 w-4" />
                      {t('export.selectedImages')}
                    </CardTitle>
                    <CardDescription>
                      {t('export.chooseImages')}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ImageSelectionGrid
                      images={images}
                      selectedImageIds={
                        exportOptions.selectedImageIds ||
                        images.map(img => img.id)
                      }
                      onSelectionChange={selectedIds =>
                        updateExportOptions({ selectedImageIds: selectedIds })
                      }
                    />
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
                        checked={
                          exportOptions.visualizationOptions?.showNumbers
                        }
                        onCheckedChange={checked =>
                          updateExportOptions({
                            visualizationOptions: {
                              ...exportOptions.visualizationOptions,
                              showNumbers: !!checked,
                            },
                          })
                        }
                      />
                      <Label htmlFor="show-numbers">
                        {t('export.showNumbers')}
                      </Label>
                    </div>

                    <div className="space-y-2">
                      <Label>{t('export.strokeColor')}</Label>
                      <div className="flex gap-2">
                        <Input
                          type="color"
                          value={
                            exportOptions.visualizationOptions?.polygonColors
                              ?.external ||
                            EXPORT_DEFAULTS.COLORS.EXTERNAL_POLYGON
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
                              ?.external ||
                            EXPORT_DEFAULTS.COLORS.EXTERNAL_POLYGON
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
                              ?.internal ||
                            EXPORT_DEFAULTS.COLORS.INTERNAL_POLYGON
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
                              ?.internal ||
                            EXPORT_DEFAULTS.COLORS.INTERNAL_POLYGON
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
                        {exportOptions.visualizationOptions?.fontSize || 32}px
                      </Label>
                      <Slider
                        value={[
                          exportOptions.visualizationOptions?.fontSize || 32,
                        ]}
                        onValueChange={([value]) =>
                          updateExportOptions({
                            visualizationOptions: {
                              ...exportOptions.visualizationOptions,
                              fontSize: value,
                            },
                          })
                        }
                        min={10}
                        max={50}
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
                      {t('export.formatsTab')}
                    </CardTitle>
                    <CardDescription>{t('export.formatsTab')}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="coco-format"
                        checked={exportOptions.annotationFormats?.includes(
                          'coco'
                        )}
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
                        checked={exportOptions.annotationFormats?.includes(
                          'yolo'
                        )}
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
                        {t('export.exportFormats.yolo')}
                      </Label>
                    </div>

                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="json-format"
                        checked={exportOptions.annotationFormats?.includes(
                          'json'
                        )}
                        onCheckedChange={checked => {
                          const formats = exportOptions.annotationFormats || [];
                          updateExportOptions({
                            annotationFormats: checked
                              ? [...formats, 'json']
                              : formats.filter(f => f !== 'json'),
                          });
                        }}
                      />
                      <Label htmlFor="json-format">
                        {t('export.includeJsonMetadata')}
                      </Label>
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
                        checked={exportOptions.metricsFormats?.includes(
                          'excel'
                        )}
                        onCheckedChange={checked => {
                          const formats = exportOptions.metricsFormats || [];
                          updateExportOptions({
                            metricsFormats: checked
                              ? [...formats, 'excel']
                              : formats.filter(f => f !== 'excel'),
                          });
                        }}
                      />
                      <Label htmlFor="excel-metrics">
                        {t('export.exportFormats.excel')}
                      </Label>
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
                      <Label htmlFor="json-metrics">
                        {t('export.exportFormats.json')}
                      </Label>
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
                        {exportOptions.annotationFormats
                          .join(', ')
                          .toUpperCase()}
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
            {completedJobId && !isExporting && !isDownloading && (
              <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg relative">
                <AlertCircle className="h-4 w-4 text-green-600" />
                <div className="flex-1">
                  <span className="text-sm text-green-800">
                    {exportStatus ||
                      "Export completed successfully! Click below to download if it didn't start automatically."}
                  </span>
                </div>
                <Button
                  size="sm"
                  onClick={triggerDownload}
                  className="ml-2"
                  title={
                    isDownloading
                      ? 'Click to stop animation when download completes'
                      : 'Download export file'
                  }
                >
                  {isDownloading ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
                      {t('export.downloading') || 'Downloading...'}
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4 mr-1" />
                      {t('export.download')}
                    </>
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={dismissExport}
                  className="ml-1 h-6 w-6 p-0"
                  title="Dismiss"
                >
                  <X className="h-4 w-4" />
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
              {/* Close dialog button - only shown when not exporting */}
              {!isExporting && (
                <Button variant="outline" onClick={onClose}>
                  {t('common.cancel')}
                </Button>
              )}

              {/* Universal Cancel/Export Button */}
              <UniversalCancelButton
                operationType="export"
                isOperationActive={isExporting}
                isCancelling={isDownloading} // Use downloading state as cancelling indicator
                onCancel={cancelExport}
                onPrimaryAction={handleExport}
                primaryText={t('export.startExport')}
                disabled={false}
              />
            </DialogFooter>
          </DialogContent>
        </Dialog>
      );
    }
  );
