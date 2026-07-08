import React, { useEffect } from 'react';
import { LineChart } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useLanguage } from '@/contexts/useLanguage';

export type MtKymographMode = 'kymograph' | 'profiles';

export interface MicrotubuleKymographsOptions {
  enabled: boolean;
  /** ``kymograph`` = the stacked space×time heatmap + velocity metrics;
   *  ``profiles`` = one matplotlib intensity-vs-position plot per frame. */
  mode: MtKymographMode;
  includeVelocityMetrics: boolean;
  includeSegmentedImages: boolean;
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
 *    (blob-motion velocities + segmented kymograph PNGs, per the sub-toggles).
 *  - **Intensity profiles** — one matplotlib plot of intensity vs. position
 *    along the microtubule, per frame (a kymograph is a stack of exactly these
 *    rows), plus the intensity CSV.
 *
 * When the project is single-frame (``!canBuildKymograph``) only profiles are
 * offered, since a kymograph has no time axis to build.
 */
export const MicrotubuleKymographsSection: React.FC<
  MicrotubuleKymographsSectionProps
> = ({ value, canBuildKymograph, onChange }) => {
  const { t } = useLanguage();

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
