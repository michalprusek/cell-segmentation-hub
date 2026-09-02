import React, { useEffect, useState } from 'react';
import { LineChart } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLanguage } from '@/contexts/useLanguage';

export type MtKymographMode = 'kymograph' | 'profiles';

/** How the samples across the line width collapse to one value. Mirrors the
 *  backend ``KymographLineReduce`` and the ML ``line_reduce``. */
export type MtKymographLineReduce = 'mean' | 'max';

/** Single-pixel line profile — what this export has always built, and what the
 *  backend and the ML service both assume when the field is absent. */
export const DEFAULT_MT_KYMOGRAPH_LINE_WIDTH = 1;
/** Mirrors the ML ``_LINE_WIDTH_MAX`` and the export route's validator. */
export const MAX_MT_KYMOGRAPH_LINE_WIDTH = 51;

export interface MicrotubuleKymographsOptions {
  enabled: boolean;
  /** ``kymograph`` = the stacked space×time heatmap + velocity metrics;
   *  ``profiles`` = one matplotlib intensity-vs-position plot per frame. */
  mode: MtKymographMode;
  includeVelocityMetrics: boolean;
  includeSegmentedImages: boolean;
  /** Width (image px) of the line sampled along each microtubule, measured
   *  ACROSS it. 1 = a single pixel. Applies to both modes: a profile plot is
   *  one row of the same sampled matrix the kymograph is a heatmap of.
   *
   *  Independent of the editor modal's identically-named control — the two are
   *  separate surfaces with separate persistence, like ``mode`` here. */
  lineWidth: number;
  /** How the ``lineWidth`` samples of one column become one value. Ignored at
   *  width 1, where there is a single sample. */
  lineReduce: MtKymographLineReduce;
  /** Absolute intensity floor for detected trajectories, in RAW SAMPLE UNITS:
   *  counts above each trajectory's own local background. Trajectories below it
   *  are dropped before the segmented kymograph is rendered, so the images and
   *  the velocity workbook agree. 0 = off, the default.
   *
   *  Absolute rather than a fraction, because the value is measured on the
   *  frame's native-bit-depth samples and the display scaling is applied
   *  afterwards. It does NOT transfer between channels: measured on a
   *  production container, 488 nm trajectories sit 9-51 counts above background
   *  where 640 nm sits at 228. Kymograph mode only — profiles have no
   *  trajectories to filter. */
  minIntensityMinusBg: number;
}

export interface MicrotubuleKymographsSectionProps {
  value: MicrotubuleKymographsOptions;
  /** False when the project has no multi-frame video (every container is a
   *  single image). A kymograph needs a time axis, so the ``kymograph`` mode is
   *  then disabled and the section forces ``profiles``. */
  canBuildKymograph: boolean;
  onChange: (next: MicrotubuleKymographsOptions) => void;
}

/**
 * MT-only export controls. Renders inside the export dialog's General tab when
 * ``projectType === 'microtubules'``. The user picks one of two outputs:
 *
 *  - **Kymograph** — the backend builds one space×time kymograph per microtubule
 *    (KymoButler trajectory velocities + segmented kymograph PNGs, per the
 *    sub-toggles).
 *  - **Intensity profiles** — one matplotlib plot of intensity vs. position
 *    along the microtubule, per frame (a kymograph is a stack of exactly these
 *    rows), plus the intensity CSV.
 *
 * When the project is single-frame (``!canBuildKymograph``) only profiles are
 * offered, since a kymograph has no time axis to build.
 *
 * The line width applies to BOTH outputs, so it sits outside the per-mode
 * blocks: the ML service renders the profile plots from the same sampled matrix
 * the kymograph is a heatmap of, i.e. a profile is one row of this picture.
 */
export const MicrotubuleKymographsSection: React.FC<
  MicrotubuleKymographsSectionProps
> = ({ value, canBuildKymograph, onChange }) => {
  const { t } = useLanguage();

  // Local text mirror of the width input, for the same reason
  // `MicrotubuleMetricsSection` keeps one: propagating only valid values would
  // make a backspace (`''` -> NaN -> skip) snap the field back to the old
  // number, so a digit could not be erased. The parent is updated only for a
  // valid integer in range; an invalid field snaps back on blur.
  const [widthText, setWidthText] = useState(String(value.lineWidth));
  // Same local-text mirror, same reason: the floor must be erasable to empty
  // (which means "off") without the field snapping back mid-edit.
  const [minIntensityText, setMinIntensityText] = useState(
    value.minIntensityMinusBg > 0 ? String(value.minIntensityMinusBg) : ''
  );
  useEffect(() => {
    setWidthText(prev =>
      prev !== '' && Number.parseInt(prev, 10) === value.lineWidth
        ? prev
        : String(value.lineWidth)
    );
  }, [value.lineWidth]);

  const onWidthChange = (raw: string) => {
    setWidthText(raw);
    if (raw === '') return; // allow the empty intermediate state while editing
    const n = Number.parseInt(raw, 10);
    if (
      Number.isFinite(n) &&
      n >= DEFAULT_MT_KYMOGRAPH_LINE_WIDTH &&
      n <= MAX_MT_KYMOGRAPH_LINE_WIDTH &&
      String(n) === raw // reject decimal / leading-zero / sign noise
    ) {
      onChange({ ...value, lineWidth: n });
    }
  };
  const onMinIntensityChange = (raw: string) => {
    setMinIntensityText(raw);
    if (raw === '') {
      onChange({ ...value, minIntensityMinusBg: 0 });
      return;
    }
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) {
      onChange({ ...value, minIntensityMinusBg: n });
    }
  };
  const onMinIntensityBlur = () => {
    const n = Number(minIntensityText);
    if (minIntensityText !== '' && (!Number.isFinite(n) || n < 0)) {
      setMinIntensityText(
        value.minIntensityMinusBg > 0 ? String(value.minIntensityMinusBg) : ''
      );
    }
  };

  const onWidthBlur = () => {
    const n = Number.parseInt(widthText, 10);
    if (
      !Number.isFinite(n) ||
      n < DEFAULT_MT_KYMOGRAPH_LINE_WIDTH ||
      n > MAX_MT_KYMOGRAPH_LINE_WIDTH
    ) {
      setWidthText(String(value.lineWidth));
    }
  };

  // Force profile mode when a kymograph can't be built (single-frame project).
  // Persists the corrected mode so the exact value POSTed to the backend is the
  // one the UI shows — a displayed-but-unpersisted override would ship the wrong
  // mode. Guarded so it fires once, not in a loop.
  useEffect(() => {
    if (value.enabled && !canBuildKymograph && value.mode !== 'profiles') {
      onChange({ ...value, mode: 'profiles' });
    }
  }, [value, canBuildKymograph, onChange]);

  const effectiveMode: MtKymographMode = canBuildKymograph
    ? value.mode
    : 'profiles';

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <LineChart className="h-4 w-4" />
          {t('export.mtKymographs.title', {
            defaultValue: 'Kymograph velocity analysis',
          })}
        </CardTitle>
        <CardDescription>
          {t('export.mtKymographs.description', {
            defaultValue:
              'Detect moving particles on a kymograph for each microtubule and export their velocities.',
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <Checkbox
            id="mt-kymo-enabled"
            checked={value.enabled}
            onCheckedChange={v => onChange({ ...value, enabled: v === true })}
          />
          <Label htmlFor="mt-kymo-enabled" className="cursor-pointer">
            {t('export.mtKymographs.enable', {
              defaultValue: 'Include kymograph analysis',
            })}
          </Label>
        </div>

        {value.enabled && (
          <div className="ml-6 space-y-3">
            {/* Output mode: kymograph vs. per-image intensity profiles. */}
            <RadioGroup
              value={effectiveMode}
              onValueChange={v =>
                onChange({ ...value, mode: v as MtKymographMode })
              }
              className="space-y-1"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem
                  value="kymograph"
                  id="mt-kymo-mode-kymograph"
                  disabled={!canBuildKymograph}
                />
                <Label
                  htmlFor="mt-kymo-mode-kymograph"
                  className={
                    canBuildKymograph
                      ? 'cursor-pointer text-sm'
                      : 'text-sm text-muted-foreground'
                  }
                >
                  {t('export.mtKymographs.modeKymograph', {
                    defaultValue: 'Kymograph (space × time)',
                  })}
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="profiles" id="mt-kymo-mode-profiles" />
                <Label
                  htmlFor="mt-kymo-mode-profiles"
                  className="cursor-pointer text-sm"
                >
                  {t('export.mtKymographs.modeProfiles', {
                    defaultValue: 'Intensity profiles (per image)',
                  })}
                </Label>
              </div>
            </RadioGroup>

            {!canBuildKymograph && (
              <p className="text-xs text-muted-foreground">
                {t('export.mtKymographs.singleFrameHint', {
                  defaultValue:
                    'Single frame — a kymograph needs a time series, so only the intensity profile is exported.',
                })}
              </p>
            )}

            {/* Line width. Deliberately OUTSIDE the per-mode blocks: the ML
                service renders the profile plots from the same sampled matrix
                the kymograph is a heatmap of, so the band changes both. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="mt-kymo-line-width" className="text-sm">
                  {t('export.mtKymographs.lineWidthLabel', {
                    defaultValue: 'Line width (px)',
                  })}
                </Label>
                <Input
                  id="mt-kymo-line-width"
                  type="number"
                  inputMode="numeric"
                  min={DEFAULT_MT_KYMOGRAPH_LINE_WIDTH}
                  max={MAX_MT_KYMOGRAPH_LINE_WIDTH}
                  step={1}
                  value={widthText}
                  onChange={e => onWidthChange(e.target.value)}
                  onBlur={onWidthBlur}
                  className="mt-1 text-sm"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {t('export.mtKymographs.lineWidthHelp', {
                    defaultValue:
                      'Width of the line sampled along each microtubule, measured across it. 1 samples a single pixel.',
                  })}
                </p>
              </div>
              {/* Kymograph mode only: profiles carry no trajectories, so
                  there is nothing for a trajectory floor to filter. */}
              {value.mode === 'kymograph' && (
                <div>
                  <Label htmlFor="mt-kymo-min-intensity" className="text-sm">
                    {t('export.mtKymographs.minIntensityLabel', {
                      defaultValue: 'Min. trajectory intensity',
                    })}
                  </Label>
                  <Input
                    id="mt-kymo-min-intensity"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step={1}
                    placeholder="0"
                    value={minIntensityText}
                    onChange={e => onMinIntensityChange(e.target.value)}
                    onBlur={onMinIntensityBlur}
                    className="mt-1 text-sm"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('export.mtKymographs.minIntensityHelp', {
                      defaultValue:
                        'Drop trajectories dimmer than this many raw intensity counts above their own background. Absolute, so it does not depend on image scaling — but it is not comparable between channels. Empty keeps all.',
                    })}
                  </p>
                </div>
              )}
              {value.lineWidth > DEFAULT_MT_KYMOGRAPH_LINE_WIDTH && (
                <div>
                  <Label htmlFor="mt-kymo-line-reduce" className="text-sm">
                    {t('export.mtKymographs.lineReduceLabel', {
                      defaultValue: 'Across width',
                    })}
                  </Label>
                  <Select
                    value={value.lineReduce}
                    onValueChange={v =>
                      onChange({
                        ...value,
                        lineReduce: v as MtKymographLineReduce,
                      })
                    }
                  >
                    <SelectTrigger id="mt-kymo-line-reduce" className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mean">
                        {t('export.mtKymographs.lineReduceMean', {
                          defaultValue: 'Mean',
                        })}
                      </SelectItem>
                      <SelectItem value="max">
                        {t('export.mtKymographs.lineReduceMax', {
                          defaultValue: 'Max',
                        })}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('export.mtKymographs.lineReduceHelp', {
                      defaultValue:
                        'How the pixels across the width become one value. Mean matches ImageJ; max is brighter but biased by single hot pixels.',
                    })}
                  </p>
                </div>
              )}
            </div>

            {/* Kymograph sub-options. */}
            {effectiveMode === 'kymograph' && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="mt-kymo-velocity"
                    checked={value.includeVelocityMetrics}
                    onCheckedChange={v =>
                      onChange({ ...value, includeVelocityMetrics: v === true })
                    }
                  />
                  <Label
                    htmlFor="mt-kymo-velocity"
                    className="cursor-pointer text-sm"
                  >
                    {t('export.mtKymographs.velocityMetrics', {
                      defaultValue: 'Velocity metrics (CSV)',
                    })}
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="mt-kymo-images"
                    checked={value.includeSegmentedImages}
                    onCheckedChange={v =>
                      onChange({ ...value, includeSegmentedImages: v === true })
                    }
                  />
                  <Label
                    htmlFor="mt-kymo-images"
                    className="cursor-pointer text-sm"
                  >
                    {t('export.mtKymographs.segmentedImages', {
                      defaultValue: 'Segmented kymograph images (PNG)',
                    })}
                  </Label>
                </div>
              </div>
            )}

            {/* Profiles mode: no sub-options — the matplotlib plots and the
                intensity CSV are always written. Describe what ships. */}
            {effectiveMode === 'profiles' && (
              <p className="text-xs text-muted-foreground">
                {t('export.mtKymographs.profilesHint', {
                  defaultValue:
                    'Exports one matplotlib plot of intensity vs. position per frame, plus the intensity CSV.',
                })}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
