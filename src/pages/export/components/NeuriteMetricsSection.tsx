import React from 'react';
import { Brain, AlertTriangle } from 'lucide-react';
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

export interface NeuriteMetricsOptions {
  /** Off by default: it is one ML round trip per frame, ~38 s for a 44 Mpx
   *  confocal field, so it should be an opt-in rather than a surprise. */
  enabled: boolean;
  /** Run the soma classifier. See the warning rendered when it is off. */
  classify: boolean;
}

export interface NeuriteMetricsSectionProps {
  value: NeuriteMetricsOptions;
  onChange: (next: NeuriteMetricsOptions) => void;
}

/**
 * Neurite-only export controls, rendered when `projectType === 'neurite'`.
 *
 * Two toggles and one warning. The warning is the point: turning the
 * classifier off is not a speed/accuracy trade, it changes which objects count
 * as cells, and a user who does it without knowing that will read connection
 * counts that are systematically too high.
 */
const NeuriteMetricsSection: React.FC<NeuriteMetricsSectionProps> = ({
  value,
  onChange,
}) => {
  const { t } = useLanguage();

  return (
    <Card className="p-3 sm:p-4">
      <CardHeader className="p-0 pb-3 sm:pb-4">
        <CardTitle className="flex items-center gap-2 text-sm sm:text-base">
          <Brain className="h-4 w-4" />
          {t('export.neuriteMetrics.title')}
        </CardTitle>
        <CardDescription className="text-xs sm:text-sm">
          {t('export.neuriteMetrics.description')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 p-0">
        <div className="flex items-start gap-2">
          <Checkbox
            id="neurite-metrics-enabled"
            checked={value.enabled}
            onCheckedChange={checked =>
              onChange({ ...value, enabled: checked === true })
            }
          />
          <Label
            htmlFor="neurite-metrics-enabled"
            className="cursor-pointer text-sm font-normal leading-snug"
          >
            {t('export.neuriteMetrics.enable')}
            <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
              {t('export.neuriteMetrics.enableHint')}
            </span>
          </Label>
        </div>

        {value.enabled && (
          <div className="flex items-start gap-2 pl-6">
            <Checkbox
              id="neurite-metrics-classify"
              checked={value.classify}
              onCheckedChange={checked =>
                onChange({ ...value, classify: checked === true })
              }
            />
            <Label
              htmlFor="neurite-metrics-classify"
              className="cursor-pointer text-sm font-normal leading-snug"
            >
              {t('export.neuriteMetrics.classify')}
              <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                {t('export.neuriteMetrics.classifyHint')}
              </span>
            </Label>
          </div>
        )}

        {value.enabled && !value.classify && (
          // Not a style preference. Without the classifier a neurite ending in
          // the cell's OWN growth cone is indistinguishable from one connecting
          // two cells, so connections are over-reported and their length is
          // credited to the wrong object.
          <div className="ml-6 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{t('export.neuriteMetrics.classifyOffWarning')}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default NeuriteMetricsSection;
