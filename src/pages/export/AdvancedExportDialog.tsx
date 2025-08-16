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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
  RefreshCw
} from 'lucide-react';
import { useAdvancedExport } from './hooks/useAdvancedExport';
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
      toast.success('Export completed successfully!');
      onClose();
    } catch (error) {
      toast.error('Export failed. Please try again.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Advanced Export Options
          </DialogTitle>
          <DialogDescription>
            Configure your export settings to create a comprehensive dataset package
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="visualization">Visualization</TabsTrigger>
            <TabsTrigger value="formats">Formats</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileImage className="h-4 w-4" />
                  Export Contents
                </CardTitle>
                <CardDescription>
                  Select which content types to include in your export
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="original-images"
                    checked={exportOptions.includeOriginalImages}
                    onCheckedChange={(checked) =>
                      updateExportOptions({ includeOriginalImages: !!checked })
                    }
                  />
                  <Label htmlFor="original-images">Include original images</Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="visualizations"
                    checked={exportOptions.includeVisualizations}
                    onCheckedChange={(checked) =>
                      updateExportOptions({ includeVisualizations: !!checked })
                    }
                  />
                  <Label htmlFor="visualizations">
                    Include visualizations with numbered polygons
                  </Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="documentation"
                    checked={exportOptions.includeDocumentation}
                    onCheckedChange={(checked) =>
                      updateExportOptions({ includeDocumentation: !!checked })
                    }
                  />
                  <Label htmlFor="documentation">
                    Include documentation and metadata
                  </Label>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Selected Images</CardTitle>
                <CardDescription>
                  {exportOptions.selectedImageIds?.length || images.length} of {images.length} images selected
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-sm text-muted-foreground">
                  {exportOptions.selectedImageIds?.length === 0 || !exportOptions.selectedImageIds
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
                  Visualization Settings
                </CardTitle>
                <CardDescription>
                  Customize how polygons are displayed in visualizations
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="show-numbers"
                    checked={exportOptions.visualizationOptions?.showNumbers}
                    onCheckedChange={(checked) =>
                      updateExportOptions({
                        visualizationOptions: {
                          ...exportOptions.visualizationOptions,
                          showNumbers: !!checked,
                        },
                      })
                    }
                  />
                  <Label htmlFor="show-numbers">Show polygon numbers</Label>
                </div>

                <div className="space-y-2">
                  <Label>External Polygon Color</Label>
                  <div className="flex gap-2">
                    <Input
                      type="color"
                      value={exportOptions.visualizationOptions?.polygonColors?.external || '#00FF00'}
                      onChange={(e) =>
                        updateExportOptions({
                          visualizationOptions: {
                            ...exportOptions.visualizationOptions,
                            polygonColors: {
                              ...exportOptions.visualizationOptions?.polygonColors,
                              external: e.target.value,
                            },
                          },
                        })
                      }
                      className="w-20"
                    />
                    <Input
                      value={exportOptions.visualizationOptions?.polygonColors?.external || '#00FF00'}
                      onChange={(e) =>
                        updateExportOptions({
                          visualizationOptions: {
                            ...exportOptions.visualizationOptions,
                            polygonColors: {
                              ...exportOptions.visualizationOptions?.polygonColors,
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
                  <Label>Internal Polygon Color</Label>
                  <div className="flex gap-2">
                    <Input
                      type="color"
                      value={exportOptions.visualizationOptions?.polygonColors?.internal || '#FF0000'}
                      onChange={(e) =>
                        updateExportOptions({
                          visualizationOptions: {
                            ...exportOptions.visualizationOptions,
                            polygonColors: {
                              ...exportOptions.visualizationOptions?.polygonColors,
                              internal: e.target.value,
                            },
                          },
                        })
                      }
                      className="w-20"
                    />
                    <Input
                      value={exportOptions.visualizationOptions?.polygonColors?.internal || '#FF0000'}
                      onChange={(e) =>
                        updateExportOptions({
                          visualizationOptions: {
                            ...exportOptions.visualizationOptions,
                            polygonColors: {
                              ...exportOptions.visualizationOptions?.polygonColors,
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
                  <Label>Stroke Width: {exportOptions.visualizationOptions?.strokeWidth || 2}px</Label>
                  <Slider
                    value={[exportOptions.visualizationOptions?.strokeWidth || 2]}
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
                  <Label>Font Size: {exportOptions.visualizationOptions?.fontSize || 16}px</Label>
                  <Slider
                    value={[exportOptions.visualizationOptions?.fontSize || 16]}
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
                  <Label>Transparency: {Math.round((exportOptions.visualizationOptions?.transparency || 0.3) * 100)}%</Label>
                  <Slider
                    value={[(exportOptions.visualizationOptions?.transparency || 0.3) * 100]}
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
                  Annotation Formats
                </CardTitle>
                <CardDescription>
                  Select annotation formats for machine learning frameworks
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="coco-format"
                    checked={exportOptions.annotationFormats?.includes('coco')}
                    onCheckedChange={(checked) => {
                      const formats = exportOptions.annotationFormats || [];
                      updateExportOptions({
                        annotationFormats: checked
                          ? [...formats, 'coco']
                          : formats.filter(f => f !== 'coco'),
                      });
                    }}
                  />
                  <Label htmlFor="coco-format">COCO format (Common Objects in Context)</Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="yolo-format"
                    checked={exportOptions.annotationFormats?.includes('yolo')}
                    onCheckedChange={(checked) => {
                      const formats = exportOptions.annotationFormats || [];
                      updateExportOptions({
                        annotationFormats: checked
                          ? [...formats, 'yolo']
                          : formats.filter(f => f !== 'yolo'),
                      });
                    }}
                  />
                  <Label htmlFor="yolo-format">YOLO format (You Only Look Once)</Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="json-format"
                    checked={exportOptions.annotationFormats?.includes('json')}
                    onCheckedChange={(checked) => {
                      const formats = exportOptions.annotationFormats || [];
                      updateExportOptions({
                        annotationFormats: checked
                          ? [...formats, 'json']
                          : formats.filter(f => f !== 'json'),
                      });
                    }}
                  />
                  <Label htmlFor="json-format">Custom JSON format</Label>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4" />
                  Metrics Formats
                </CardTitle>
                <CardDescription>
                  Select formats for exporting calculated metrics
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="excel-metrics"
                    checked={exportOptions.metricsFormats?.includes('excel')}
                    onCheckedChange={(checked) => {
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
                    onCheckedChange={(checked) => {
                      const formats = exportOptions.metricsFormats || [];
                      updateExportOptions({
                        metricsFormats: checked
                          ? [...formats, 'csv']
                          : formats.filter(f => f !== 'csv'),
                      });
                    }}
                  />
                  <Label htmlFor="csv-metrics">CSV (Comma-separated values)</Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="json-metrics"
                    checked={exportOptions.metricsFormats?.includes('json')}
                    onCheckedChange={(checked) => {
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
                <CardTitle>Export Summary</CardTitle>
                <CardDescription>
                  Review your export configuration
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div>• Images: {exportOptions.selectedImageIds?.length || images.length}</div>
                {exportOptions.includeOriginalImages && <div>• Original images included</div>}
                {exportOptions.includeVisualizations && <div>• Visualizations with numbered polygons</div>}
                {exportOptions.annotationFormats?.length > 0 && (
                  <div>• Annotations: {exportOptions.annotationFormats.join(', ').toUpperCase()}</div>
                )}
                {exportOptions.metricsFormats?.length > 0 && (
                  <div>• Metrics: {exportOptions.metricsFormats.join(', ').toUpperCase()}</div>
                )}
                {exportOptions.includeDocumentation && <div>• Documentation and metadata</div>}
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
        {completedJobId && !isExporting && currentJob?.status === 'completed' && (
          <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
            <AlertCircle className="h-4 w-4 text-green-600" />
            <div className="flex-1">
              <span className="text-sm text-green-800">
                Export completed successfully! Click below to download if it didn't start automatically.
              </span>
            </div>
            <Button 
              size="sm" 
              onClick={triggerDownload}
              className="ml-2"
            >
              <Download className="h-4 w-4 mr-1" />
              Download
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
            Cancel
          </Button>
          {isExporting ? (
            <Button onClick={cancelExport} variant="destructive">
              Stop Export
            </Button>
          ) : (
            <Button onClick={handleExport} disabled={isExporting}>
              <Download className="mr-2 h-4 w-4" />
              Start Export
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};