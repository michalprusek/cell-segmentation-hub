import React from 'react';
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
import { useLanguage } from '@/contexts/useLanguage';

export interface MicrotubuleKymographsOptions {
  enabled: boolean;
  includeVelocityMetrics: boolean;
  includeSegmentedImages: boolean;
}

export interface MicrotubuleKymographsSectionProps {
  value: MicrotubuleKymographsOptions;
  onChange: (next: MicrotubuleKymographsOptions) => void;
}

/**
 * MT-only export controls for kymograph velocity analysis. Renders inside the
 * export dialog's General tab when ``projectType === 'microtubules'``. The
 * backend builds one kymograph per microtubule, detects moving particles, and
 * ships the segmented kymograph PNGs and/or a velocity-metrics CSV.
 */
export const MicrotubuleKymographsSection: React.FC<
  MicrotubuleKymographsSectionProps
> = ({ value, onChange }) => {
  const { t } = useLanguage();

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
          <div className="ml-6 space-y-2">
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
      </CardContent>
    </Card>
  );
};
