import React from 'react';
import { Wand2 } from 'lucide-react';
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
import { useLanguage } from '@/contexts/useLanguage';

interface VideoChannelOption {
  /** Machine-safe identifier (matches the container.channels[].name) */
  name: string;
  /** Human-friendly label from TIFF/ND2 metadata */
  displayName?: string;
}

export interface MicrotubuleMetricsOptions {
  enabled: boolean;
  thicknessPx: number;
  marginMultiplier: number;
  channels: string[];
}

export interface MicrotubuleMetricsSectionProps {
  value: MicrotubuleMetricsOptions;
  onChange: (next: MicrotubuleMetricsOptions) => void;
  /**
   * All channels available across the project's video containers,
   * de-duplicated by machine name. Empty array => the project has no
   * channel metadata and intensity sampling is impossible.
   */
  availableChannels: VideoChannelOption[];
}

/**
 * MT-only export controls: band thickness, background margin
 * multiplier, channel multi-select. Renders inside the export dialog's
 * General tab when ``projectType === 'microtubule'``.
 *
 * The backend re-reads the original ND2/TIFF on disk so the intensity
 * numbers are derived from raw 16-bit signal (the per-channel PNGs are
 * percentile-clipped 8-bit and unsuitable for absolute fluorescence).
 */
export const MicrotubuleMetricsSection: React.FC<
  MicrotubuleMetricsSectionProps
> = ({ value, onChange, availableChannels }) => {
  const { t } = useLanguage();

  const setEnabled = (enabled: boolean) =>
    onChange({ ...value, enabled });

  const setThickness = (raw: string) => {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 1 && n <= 100) {
      onChange({ ...value, thicknessPx: n });
    }
  };

  const setMargin = (raw: string) => {
    const n = Number.parseFloat(raw);
    if (Number.isFinite(n) && n >= 0 && n <= 10) {
      onChange({ ...value, marginMultiplier: n });
    }
  };

  const toggleChannel = (name: string, checked: boolean) => {
    const set = new Set(value.channels);
    if (checked) set.add(name);
    else set.delete(name);
    onChange({ ...value, channels: Array.from(set) });
  };

  const disabledInputs = !value.enabled;
  const noChannels = availableChannels.length === 0;

  return (
    <Card className="p-3 sm:p-4">
      <CardHeader className="p-0 pb-3 sm:pb-4">
        <CardTitle className="flex items-center gap-2 text-sm sm:text-base">
          <Wand2 className="h-4 w-4" />
          {t('export.mt.sectionTitle')}
        </CardTitle>
        <CardDescription className="text-xs sm:text-sm">
          {t('export.mt.sectionDescription')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 p-0">
        <div className="flex items-center space-x-2">
          <Checkbox
            id="mt-enabled"
            checked={value.enabled}
            onCheckedChange={c => setEnabled(c === true)}
          />
          <Label htmlFor="mt-enabled" className="text-sm">
            {t('export.mt.enable')}
          </Label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="mt-thickness" className="text-sm">
              {t('export.mt.thicknessLabel')}
            </Label>
            <Input
              id="mt-thickness"
              type="number"
              min={1}
              max={100}
              step={1}
              value={value.thicknessPx}
              disabled={disabledInputs}
              onChange={e => setThickness(e.target.value)}
              className="mt-1 text-sm"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {t('export.mt.thicknessHelp')}
            </p>
          </div>
          <div>
            <Label htmlFor="mt-margin" className="text-sm">
              {t('export.mt.marginLabel')}
            </Label>
            <Input
              id="mt-margin"
              type="number"
              min={0}
              max={10}
              step={0.1}
              value={value.marginMultiplier}
              disabled={disabledInputs}
              onChange={e => setMargin(e.target.value)}
              className="mt-1 text-sm"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {t('export.mt.marginHelp')}
            </p>
          </div>
        </div>

        <div>
          <Label className="text-sm">
            {t('export.mt.channelsLabel')}
          </Label>
          {noChannels ? (
            <p className="text-xs text-muted-foreground mt-2">
              {t('export.mt.noChannels')}
            </p>
          ) : (
            <div className="mt-2 space-y-2">
              {availableChannels.map(ch => (
                <div key={ch.name} className="flex items-center space-x-2">
                  <Checkbox
                    id={`mt-channel-${ch.name}`}
                    checked={value.channels.includes(ch.name)}
                    disabled={disabledInputs}
                    onCheckedChange={c => toggleChannel(ch.name, c === true)}
                  />
                  <Label
                    htmlFor={`mt-channel-${ch.name}`}
                    className="text-sm font-normal"
                  >
                    {ch.displayName ?? ch.name}
                    {ch.displayName && ch.displayName !== ch.name ? (
                      <span className="text-muted-foreground ml-1">
                        ({ch.name})
                      </span>
                    ) : null}
                  </Label>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
