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
import { ProjectImage, isMicrotubuleProject } from '@/types';
import { EXPORT_DEFAULTS } from '@/lib/export-config';
import { ImageSelectionGrid } from './components/ImageSelectionGrid';
import { MicrotubuleMetricsSection } from './components/MicrotubuleMetricsSection';
import {
  MicrotubuleKymographsSection,
  DEFAULT_MT_KYMOGRAPH_LINE_WIDTH,
} from './components/MicrotubuleKymographsSection';
import { projectCanBuildKymograph } from './utils/kymographGating';
import { UniversalCancelButton } from '@/components/ui/universal-cancel-button';

/** Accepted range for the pixel→µm scale, in µm per pixel.
 *  0.001 is 1 nm/px, finer than any light microscope resolves; 1000 is a
 *  millimetre per pixel, coarser than any objective in use here. */
const SCALE_MIN_UM_PER_PX = 0.001;
const SCALE_MAX_UM_PER_PX = 1000;

/** Reciprocal of the retained precision for a typed scale (1e6 = 6 decimals).
 *
 *  Was 1e3. Auto-fill writes the calibration straight from the image metadata
 *  at full precision — a Nikon ND2 reports 0.0722222 µm/px — but typing in the
 *  box rounded to 3 decimals, so merely touching the field silently degraded
 *  that to 0.072: a 0.3 % systematic error on every exported length, applied
 *  without a word to the user. Six decimals holds the calibrations these
 *  instruments actually produce. */
const SCALE_PRECISION = 1e6;

interface AdvancedExportDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectName: string;
  /** Used to gate microtubule-specific export controls. */
  projectType?: string | null;
  images: ProjectImage[];
  selectedImageIds?: string[];
  onExportingChange?: (isExporting: boolean) => void;
  onDownloadingChange?: (isDownloading: boolean) => void;
}

/** Default MT metrics tuning. Per-channel intensity (incl. the integrated sum)
 *  is always computed for every channel — these two only tune the band. */
const MT_METRICS_DEFAULTS = {
  thicknessPx: 5,
  marginMultiplier: 2,
};

const MT_KYMOGRAPHS_DEFAULTS = {
  enabled: false,
  mode: 'kymograph' as const,
  includeVelocityMetrics: true,
  includeSegmentedImages: true,
  // 1 = the single-pixel line profile every export built before the width was
  // exposed, so an untouched dialog produces the identical archive. Not seeded
  // from the editor modal's control: separate surface, separate persistence.
  lineWidth: DEFAULT_MT_KYMOGRAPH_LINE_WIDTH,
  lineReduce: 'mean' as const,
  // 0 = no intensity floor, i.e. every trajectory the detector found — what
  // every export produced before this control existed.
  minIntensityMinusBg: 0,
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
      selectedImageIds,
      onExportingChange,
      onDownloadingChange,
    }) => {
      const { t } = useLanguage();
      // Shared predicate guards the plural-`microtubules`-vs-singular-
      // `microtubule`-model-id footgun that once silently hid this section.
      const isMTProject = isMicrotubuleProject(projectType);

      // A kymograph needs a time axis (≥ 2 frames). The images listing returns
      // per-frame rows, not container rows, so this counts frames per container
      // (see projectCanBuildKymograph). When no multi-frame video exists — a
      // single-frame container or only standalone images — the section forces
      // profile-only.
      const canBuildKymograph = React.useMemo(
        () => projectCanBuildKymograph(images),
        [images]
      );

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

      const [activeTab, setActiveTab] = useState('general');
      // `pixelToMicrometerScale != null` was the old auto-fill guard, but
      // it collapses three distinct states (untouched, user-cleared,
      // user-typed-zero-then-erased) into one. Tracking interaction
      // explicitly keeps the auto-fill safe to re-run when `images`
      // resolves after the dialog has already opened.
      const hasUserTouchedScaleRef = useRef(false);

      // The scale box is driven by the RAW TEXT the user typed, not by the
      // parsed number.
      //
      // Deriving `value` from the number made the field unusable. Every µm/px
      // scale starts with "0", but "0" parses to 0, which fails the >= 0.001
      // guard, so the keystroke was discarded and the controlled value snapped
      // back to '' — you could not type a leading zero at all. And each
      // keystroke that WAS accepted re-rendered a different string, so the
      // browser dropped the caret to the end of the field and further typing
      // landed there: entering a digit at the front produced the number
      // backwards.
      //
      // Keeping the text verbatim lets intermediate states ("0", "0.", "0.07")
      // exist while only committing a value once it parses and is in range.
      const [scaleText, setScaleText] = useState('');
      // The last value THIS input pushed upward, so the adopt-effect below can
      // tell an external change (auto-fill) from its own echo and leave the
      // caret alone.
      const lastPushedScaleRef = useRef<number | undefined>(undefined);

      useEffect(() => {
        const value = exportOptions.pixelToMicrometerScale;
        if (value === lastPushedScaleRef.current) return;
        lastPushedScaleRef.current = value;
        setScaleText(value == null ? '' : String(value));
      }, [exportOptions.pixelToMicrometerScale]);

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

      const handleExport = async () => {
        try {
          await startExport(projectName);
          toast.success(t('toast.exportCompleted'));
          onClose();
        } catch (_error) {
          toast.error(t('toast.exportFailed'));
        }
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
                          // "any", not "0.001": a real calibration is
                          // 0.072222 µm/px, which a 0.001 step reports as a
                          // step mismatch.
                          step="any"
                          min={SCALE_MIN_UM_PER_PX}
                          max={SCALE_MAX_UM_PER_PX}
                          placeholder={t('export.scalePlaceholder')}
                          value={scaleText}
                          // Leaving the field reconciles what is DISPLAYED with
                          // what will actually be exported. Driving the box from
                          // raw text is what makes "0.", "0.07" reachable on the
                          // way to "0.072", but it also means an entry that never
                          // commits — out of range, or still unparseable — stays
                          // on screen indefinitely while the committed value sits
                          // behind it. Typing `0` over an auto-filled 0.0724 left
                          // the user reading 0 and exporting 0.0724, with nothing
                          // to say so. Only on blur, never during typing, or the
                          // partial entries become unreachable again.
                          onBlur={() => {
                            const committed =
                              exportOptions.pixelToMicrometerScale;
                            setScaleText(
                              committed == null ? '' : String(committed)
                            );
                          }}
                          onChange={e => {
                            // Any interaction disables further auto-fill —
                            // including clearing the field, so a user who
                            // wipes the auto-suggested value doesn't get it
                            // silently re-applied on the next image refresh.
                            hasUserTouchedScaleRef.current = true;
                            const raw = e.target.value;
                            // Always keep what was typed, even when it is not
                            // yet a committable number — that is what makes
                            // "0", "0." and "0.07" reachable on the way to
                            // "0.072".
                            setScaleText(raw);

                            if (raw.trim() === '') {
                              lastPushedScaleRef.current = undefined;
                              updateExportOptions({
                                pixelToMicrometerScale: undefined,
                              });
                              return;
                            }

                            const numValue = Number(raw);
                            // Not a number yet ("-", "1e"): hold the text and
                            // leave the committed value untouched.
                            if (!Number.isFinite(numValue)) return;
                            if (
                              numValue < SCALE_MIN_UM_PER_PX ||
                              numValue > SCALE_MAX_UM_PER_PX
                            ) {
                              return;
                            }

                            const roundedValue =
                              Math.round(numValue * SCALE_PRECISION) /
                              SCALE_PRECISION;
                            lastPushedScaleRef.current = roundedValue;
                            updateExportOptions({
                              pixelToMicrometerScale: roundedValue,
                            });
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
                      value={{
                        thicknessPx:
                          exportOptions.mtMetrics?.thicknessPx ??
                          MT_METRICS_DEFAULTS.thicknessPx,
                        marginMultiplier:
                          exportOptions.mtMetrics?.marginMultiplier ??
                          MT_METRICS_DEFAULTS.marginMultiplier,
                      }}
                      onChange={next =>
                        updateExportOptions({ mtMetrics: next })
                      }
                    />
                  )}

                  {isMTProject && (
                    <MicrotubuleKymographsSection
                      value={
                        exportOptions.mtKymographs ?? MT_KYMOGRAPHS_DEFAULTS
                      }
                      canBuildKymograph={canBuildKymograph}
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
                      {isMTProject ? (
                        // Microtubule projects don't emit COCO/YOLO/JSON (those
                        // express class only as a flat category, unsuited to
                        // per-instance polyline tracks). MT annotations are
                        // always exported as ImageJ RoiSet + CVAT 1.1, each
                        // carrying the tubulin type class.
                        <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
                          {t('export.microtubuleAnnotationsNote')}
                        </p>
                      ) : (
                        <>
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
                        </>
                      )}
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
                  <div className="flex justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate" title={exportStatus}>
                      {exportStatus}
                    </span>
                    <span className="flex-shrink-0">
                      {Math.round(exportProgress)}%
                    </span>
                  </div>
                  <Progress value={exportProgress} className="w-full" />
                </div>
              )}

              {/* Completed Export - Manual Download */}
              {/* `!isDownloading` used to be part of this guard, which made the
                  isDownloading branches on the button below unreachable: the
                  whole panel unmounted the moment a download started, so the
                  "Downloading..." spinner it renders could never appear and the
                  user just watched the box vanish. Both the guard and the
                  spinner arrived in the same commit, so the spinner is the
                  intent and the guard was the slip. */}
              {completedJobId && !isExporting && (
                <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg relative">
                  <AlertCircle className="h-4 w-4 flex-shrink-0 text-green-600" />
                  <div className="min-w-0 flex-1">
                    <span className="text-sm text-green-800 break-words">
                      {exportStatus ||
                        "Export completed successfully! Click below to download if it didn't start automatically."}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    onClick={triggerDownload}
                    className="ml-2 flex-shrink-0"
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
                    className="ml-1 h-6 w-6 flex-shrink-0 p-0"
                    title="Dismiss"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}

              {/* Failed Export */}
              {currentJob?.status === 'failed' && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <AlertCircle className="h-4 w-4 flex-shrink-0 text-red-600" />
                  <span className="min-w-0 text-sm text-red-800 break-words">
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
                  onPrimaryAction={() => void handleExport()}
                  primaryText={t('export.startExport')}
                  disabled={false}
                  className="w-full sm:w-auto"
                />
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      );
    }
  );
