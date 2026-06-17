import React, { useState, useEffect, useRef } from 'react';
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
import { toast } from 'sonner';
import {
  Download,
  FileImage,
  FileJson,
  FileSpreadsheet,
  Package,
  Settings,
  Palette,
  WifiOff,
  AlertCircle,
  RefreshCw,
  X,
} from 'lucide-react';
import { useSharedAdvancedExport } from './hooks/useSharedAdvancedExport';
import { useLanguage } from '@/contexts/useLanguage';
import { ProjectImage } from '@/types';
import { EXPORT_DEFAULTS } from '@/lib/export-config';
import { ImageSelectionGrid } from './components/ImageSelectionGrid';
import { MicrotubuleMetricsSection } from './components/MicrotubuleMetricsSection';
import { MicrotubuleKymographsSection } from './components/MicrotubuleKymographsSection';
import { UniversalCancelButton } from '@/components/ui/universal-cancel-button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface AdvancedExportDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
  /** Used to gate microtubule-specific export controls. */
  projectType?: string | null;
  images: ProjectImage[];
  /** Distinct channel names across the project's video containers
   *  (BE-aggregated `metadata.projectChannels`). The container rows that
   *  carry the `channels` JSON are filtered out of `images` by the gallery
   *  endpoint, so this prop is the only source the MT channel picker has. */
  projectChannels?: string[];
  selectedImageIds?: string[];
  onExportingChange?: (isExporting: boolean) => void;
  onDownloadingChange?: (isDownloading: boolean) => void;
}

/** Default MT metrics options when the user toggles the section on. */
const MT_METRICS_DEFAULTS = {
  enabled: false,
  thicknessPx: 5,
  marginMultiplier: 2,
  channels: [] as string[],
};

const MT_KYMOGRAPHS_DEFAULTS = {
  enabled: false,
  includeVelocityMetrics: true,
  includeSegmentedImages: true,
};

export const AdvancedExportDialog: React.FC<AdvancedExportDialogProps> =
  React.memo(
    ({
      open,
      onClose,
      projectId,
      projectName,
      projectType,
      images,
      projectChannels,
      selectedImageIds,
      onExportingChange,
      onDownloadingChange,
    }) => {
      const { t } = useLanguage();
      // ProjectType is `'microtubules'` (plural) — `'microtubule'`
      // (singular) is the model id, not the project type. Mis-comparing
      // them silently hides the MT section on every MT project.
      const isMTProject = projectType === 'microtubules';

      // Distinct channels across the project's video containers. These come
      // from the BE-aggregated `projectChannels` (metadata on the thumbnails
      // response): the container rows that actually carry the `channels` JSON
      // are filtered out of `images` by the gallery endpoint, so scanning
      // `images` for `isVideoContainer` rows always yielded an empty list and
      // the picker never rendered — leaving `channels: []` and a silent
      // empty MT metrics export. `projectChannels` is name-only, so the
      // machine name doubles as the display label.
      const availableChannels = React.useMemo(() => {
        if (!isMTProject || !projectChannels) return [];
        const byName = new Map<
          string,
          { name: string; displayName?: string }
        >();
        for (const name of projectChannels) {
          if (name && !byName.has(name)) {
            byName.set(name, { name, displayName: name });
          }
        }
        return Array.from(byName.values());
      }, [projectChannels, isMTProject]);

      // Local snapshot of MT options. We always merge into the shared
      // exportOptions state when the user toggles or edits inputs so the
      // export hook persists the same object that gets POSTed.
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
      } = useSharedAdvancedExport(projectId);

      // Note: export is never blocked for microtubule projects. Without a
      // selected channel the backend still exports microtubule LENGTH
      // (geometry) and surfaces a warning that the per-channel intensity
      // metrics were omitted — so there's no silent-empty trap and no
      // dead-end when a project has no channel metadata. The channel picker
      // shows an informational hint instead (see MicrotubuleMetricsSection).

      const [activeTab, setActiveTab] = useState('general');
      // `pixelToMicrometerScale != null` was the old auto-fill guard, but
      // it collapses three distinct states (untouched, user-cleared,
      // user-typed-zero-then-erased) into one. Tracking interaction
      // explicitly keeps the auto-fill safe to re-run when `images`
      // resolves after the dialog has already opened.
      const hasUserTouchedScaleRef = useRef(false);

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

      // Auto-fill the pixel-to-µm scale from the first image carrying
      // upload-time calibration (ND2 voxel_size, OME-TIFF
      // PhysicalSizeX, ImageJ TIFF). The backend bubbles each frame
      // row's calibration down from its parent video container, so any
      // image — frame or standalone — with a positive pixelSizeUm is
      // a valid source. Skipped once the user has interacted with the
      // input (see `hasUserTouchedScaleRef`).
      useEffect(() => {
        if (hasUserTouchedScaleRef.current) return;
        if (exportOptions.pixelToMicrometerScale != null) return;
        const calibrated = images.find(
          img => typeof img.pixelSizeUm === 'number' && img.pixelSizeUm > 0
        );
        if (calibrated?.pixelSizeUm) {
          updateExportOptions({
            pixelToMicrometerScale: calibrated.pixelSizeUm,
          });
        }
      }, [images, exportOptions.pixelToMicrometerScale, updateExportOptions]);

      const [showIncompleteWarning, setShowIncompleteWarning] = useState(false);

      // Microtubule intensity columns require a selected channel. If the user
      // requested metrics but didn't enable intensity (or pick a channel), the
      // export still produces microtubule LENGTH but omits the per-channel
      // intensity columns — so warn before exporting that the metric set will
      // be incomplete.
      const shouldWarnIncompleteMetrics =
        isMTProject &&
        (exportOptions.metricsFormats?.length ?? 0) > 0 &&
        !(
          (exportOptions.mtMetrics?.enabled ?? false) &&
          (exportOptions.mtMetrics?.channels?.length ?? 0) > 0
        );

      const handleExport = async () => {
        try {
          await startExport(projectName);
          toast.success(t('toast.exportCompleted'));
          onClose();
        } catch (_error) {
          toast.error(t('toast.exportFailed'));
        }
      };

      // Intercept the Export click: on an MT project missing intensity, pop the
      // incomplete-metrics confirmation modal first; otherwise export directly.
      const handleExportClick = () => {
        if (shouldWarnIncompleteMetrics) {
          setShowIncompleteWarning(true);
        } else {
          void handleExport();
        }
      };

      const confirmIncompleteExport = () => {
        setShowIncompleteWarning(false);
        void handleExport();
      };

      return (
        <>
          <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="max-w-[95vw] sm:max-w-2xl md:max-w-4xl max-h-[90vh] overflow-y-auto px-4 sm:px-6">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
                  <Package className="h-4 w-4 sm:h-5 sm:w-5" />
                  {t('export.advancedOptions')}
                </DialogTitle>
                <DialogDescription className="text-xs sm:text-sm">
                  {t('export.configureSettings')}
                </DialogDescription>
              </DialogHeader>

              <Tabs
                value={activeTab}
                onValueChange={setActiveTab}
                className="w-full"
              >
                <TabsList className="grid w-full grid-cols-1 sm:grid-cols-3 gap-1 sm:gap-0 h-auto sm:h-10">
                  <TabsTrigger
                    value="general"
                    className="text-sm h-10 sm:h-auto"
                  >
                    {t('export.general')}
                  </TabsTrigger>
                  <TabsTrigger
                    value="visualization"
                    className="text-sm h-10 sm:h-auto"
                  >
                    {t('export.visualization')}
                  </TabsTrigger>
                  <TabsTrigger
                    value="formats"
                    className="text-sm h-10 sm:h-auto"
                  >
                    {t('export.formatsTab')}
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="general" className="space-y-3 sm:space-y-4">
                  <Card className="p-3 sm:p-4">
                    <CardHeader className="p-0 pb-3 sm:pb-4">
                      <CardTitle className="flex items-center gap-2 text-sm sm:text-base">
                        <FileImage className="h-4 w-4" />
                        {t('export.exportContents')}
                      </CardTitle>
                      <CardDescription className="text-xs sm:text-sm">
                        {t('export.selectContent')}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 sm:space-y-4 p-0">
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
                        <Label
                          htmlFor="original-images"
                          className="text-sm sm:text-base"
                        >
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
                        <Label
                          htmlFor="visualizations"
                          className="text-sm sm:text-base"
                        >
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
                        <Label
                          htmlFor="documentation"
                          className="text-sm sm:text-base"
                        >
                          {t('export.includeDocumentation')}
                        </Label>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="p-3 sm:p-4">
                    <CardHeader className="p-0 pb-3 sm:pb-4">
                      <CardTitle className="flex items-center gap-2 text-sm sm:text-base">
                        <Settings className="h-4 w-4" />
                        {t('export.scaleConversion')}
                      </CardTitle>
                      <CardDescription className="text-xs sm:text-sm">
                        {t('export.scaleDescription')}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 sm:space-y-4 p-0">
                      <div className="space-y-2 sm:space-y-3">
                        <Label
                          htmlFor="scale-input"
                          className="text-sm sm:text-base"
                        >
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
                            // Any interaction disables further auto-fill —
                            // including clearing the field, so a user who
                            // wipes the auto-suggested value doesn't get it
                            // silently re-applied on the next image refresh.
                            hasUserTouchedScaleRef.current = true;
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

                  {/* Microtubule-only section. Rendered ABOVE the image
                    grid because for MT projects the per-channel +
                    band-width choices change which images make sense
                    to export — deciding the metrics first feels more
                    natural than scrolling past the image picker.
                    Only mounted when projectType === 'microtubules'
                    (intensity sampling needs the raw ND2/TIFF on disk). */}
                  {isMTProject && (
                    <MicrotubuleMetricsSection
                      value={exportOptions.mtMetrics ?? MT_METRICS_DEFAULTS}
                      onChange={next =>
                        updateExportOptions({ mtMetrics: next })
                      }
                      availableChannels={availableChannels}
                    />
                  )}

                  {isMTProject && (
                    <MicrotubuleKymographsSection
                      value={
                        exportOptions.mtKymographs ?? MT_KYMOGRAPHS_DEFAULTS
                      }
                      onChange={next =>
                        updateExportOptions({ mtKymographs: next })
                      }
                    />
                  )}

                  <Card className="p-3 sm:p-4">
                    <CardHeader className="p-0 pb-3 sm:pb-4">
                      <CardTitle className="flex items-center gap-2 text-sm sm:text-base">
                        <FileImage className="h-4 w-4" />
                        {t('export.selectedImages')}
                      </CardTitle>
                      <CardDescription className="text-xs sm:text-sm">
                        {t('export.chooseImages')}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
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

                <TabsContent
                  value="visualization"
                  className="space-y-3 sm:space-y-4"
                >
                  <Card className="p-3 sm:p-4">
                    <CardHeader className="p-0 pb-3 sm:pb-4">
                      <CardTitle className="flex items-center gap-2 text-sm sm:text-base">
                        <Palette className="h-4 w-4" />
                        {t('export.colorSettings')}
                      </CardTitle>
                      <CardDescription className="text-xs sm:text-sm">
                        {t('export.colorSettings')}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4 sm:space-y-6 p-0">
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
                        <Label
                          htmlFor="show-numbers"
                          className="text-sm sm:text-base"
                        >
                          {t('export.showNumbers')}
                        </Label>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-sm sm:text-base">
                          {t('export.strokeColor')}
                        </Label>
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
                            className="w-full sm:w-20 h-10 sm:h-9"
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
                        <Label className="text-sm sm:text-base">
                          {t('export.backgroundColor')}
                        </Label>
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
                            className="w-full sm:w-20 h-10 sm:h-9"
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
                        <div className="flex justify-between items-center">
                          <Label className="text-sm">
                            {t('export.strokeWidth')}
                          </Label>
                          <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                            {exportOptions.visualizationOptions?.strokeWidth ||
                              2}
                            px
                          </span>
                        </div>
                        <Slider
                          className="touch-manipulation"
                          value={[
                            exportOptions.visualizationOptions?.strokeWidth ||
                              2,
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
                        <div className="flex justify-between items-center">
                          <Label className="text-sm">
                            {t('export.fontSize')}
                          </Label>
                          <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                            {exportOptions.visualizationOptions?.fontSize || 32}
                            px
                          </span>
                        </div>
                        <Slider
                          className="touch-manipulation"
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
                        <div className="flex justify-between items-center">
                          <Label className="text-sm">Transparency</Label>
                          <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                            {Math.round(
                              (exportOptions.visualizationOptions
                                ?.transparency || 0.3) * 100
                            )}
                            %
                          </span>
                        </div>
                        <Slider
                          className="touch-manipulation"
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

                <TabsContent value="formats" className="space-y-3 sm:space-y-4">
                  <Card className="p-3 sm:p-4">
                    <CardHeader className="p-0 pb-3 sm:pb-4">
                      <CardTitle className="flex items-center gap-2 text-sm sm:text-base">
                        <FileJson className="h-4 w-4" />
                        {t('export.formatsTab')}
                      </CardTitle>
                      <CardDescription className="text-xs sm:text-sm">
                        {t('export.formatsTab')}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 sm:space-y-4 p-0">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="coco-format"
                          checked={exportOptions.annotationFormats?.includes(
                            'coco'
                          )}
                          onCheckedChange={checked => {
                            const formats =
                              exportOptions.annotationFormats || [];
                            updateExportOptions({
                              annotationFormats: checked
                                ? [...formats, 'coco']
                                : formats.filter(f => f !== 'coco'),
                            });
                          }}
                        />
                        <Label
                          htmlFor="coco-format"
                          className="text-sm sm:text-base"
                        >
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
                            const formats =
                              exportOptions.annotationFormats || [];
                            updateExportOptions({
                              annotationFormats: checked
                                ? [...formats, 'yolo']
                                : formats.filter(f => f !== 'yolo'),
                            });
                          }}
                        />
                        <Label
                          htmlFor="yolo-format"
                          className="text-sm sm:text-base"
                        >
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
                            const formats =
                              exportOptions.annotationFormats || [];
                            updateExportOptions({
                              annotationFormats: checked
                                ? [...formats, 'json']
                                : formats.filter(f => f !== 'json'),
                            });
                          }}
                        />
                        <Label
                          htmlFor="json-format"
                          className="text-sm sm:text-base"
                        >
                          {t('export.includeJsonMetadata')}
                        </Label>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="p-3 sm:p-4">
                    <CardHeader className="p-0 pb-3 sm:pb-4">
                      <CardTitle className="flex items-center gap-2 text-sm sm:text-base">
                        <FileSpreadsheet className="h-4 w-4" />
                        {t('export.outputSettings')}
                      </CardTitle>
                      <CardDescription className="text-xs sm:text-sm">
                        {t('export.generateExcel')}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 sm:space-y-4 p-0">
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
                        <Label
                          htmlFor="excel-metrics"
                          className="text-sm sm:text-base"
                        >
                          {t('export.exportFormats.excel')}
                        </Label>
                      </div>

                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="csv-metrics"
                          checked={exportOptions.metricsFormats?.includes(
                            'csv'
                          )}
                          onCheckedChange={checked => {
                            const formats = exportOptions.metricsFormats || [];
                            updateExportOptions({
                              metricsFormats: checked
                                ? [...formats, 'csv']
                                : formats.filter(f => f !== 'csv'),
                            });
                          }}
                        />
                        <Label
                          htmlFor="csv-metrics"
                          className="text-sm sm:text-base"
                        >
                          CSV (Comma-separated values)
                        </Label>
                      </div>

                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="json-metrics"
                          checked={exportOptions.metricsFormats?.includes(
                            'json'
                          )}
                          onCheckedChange={checked => {
                            const formats = exportOptions.metricsFormats || [];
                            updateExportOptions({
                              metricsFormats: checked
                                ? [...formats, 'json']
                                : formats.filter(f => f !== 'json'),
                            });
                          }}
                        />
                        <Label
                          htmlFor="json-metrics"
                          className="text-sm sm:text-base"
                        >
                          {t('export.exportFormats.json')}
                        </Label>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="p-3 sm:p-4">
                    <CardHeader className="p-0 pb-3 sm:pb-4">
                      <CardTitle className="text-sm sm:text-base">
                        {t('export.completed')}
                      </CardTitle>
                      <CardDescription className="text-xs sm:text-sm">
                        {t('export.configureSettings')}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm p-0">
                      <div>
                        • Images:{' '}
                        {exportOptions.selectedImageIds?.length ||
                          images.length}
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
                          {exportOptions.metricsFormats
                            .join(', ')
                            .toUpperCase()}
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
                    WebSocket connection lost. Using fallback polling for
                    updates.
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

              <DialogFooter className="flex-col sm:flex-row gap-2">
                {/* Close dialog button - only shown when not exporting */}
                {!isExporting && (
                  <Button
                    variant="outline"
                    onClick={onClose}
                    className="w-full sm:w-auto"
                  >
                    {t('common.cancel')}
                  </Button>
                )}

                {/* Universal Cancel/Export Button */}
                <UniversalCancelButton
                  operationType="export"
                  isOperationActive={isExporting}
                  isCancelling={isDownloading} // Use downloading state as cancelling indicator
                  onCancel={cancelExport}
                  onPrimaryAction={handleExportClick}
                  primaryText={t('export.startExport')}
                  disabled={false}
                  className="w-full sm:w-auto"
                />
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <AlertDialog
            open={showIncompleteWarning}
            onOpenChange={setShowIncompleteWarning}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t('export.mt.incompleteTitle')}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {t('export.mt.incompleteBody')}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                <AlertDialogAction onClick={confirmIncompleteExport}>
                  {t('export.mt.incompleteConfirm')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      );
    }
  );
