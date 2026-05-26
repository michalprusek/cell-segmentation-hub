import React, { useEffect, useState } from 'react';
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

  // Local text mirrors of the two numeric inputs. We need this because
  // the previous implementation only updated the parent state when the
  // typed value parsed AND fell in range — so a backspace (which goes
  // through `''` → NaN → skip-update) left the input visually empty
  // for one tick and then snapped back to the previous value, making
  // it impossible to erase a digit. With a local string the user can
  // freely type / delete; we propagate to the parent only when the
  // current text is a valid integer in range, and snap back on blur
  // if they leave the field invalid.
  const [thicknessText, setThicknessText] = useState(String(value.thicknessPx));
  const [marginText, setMarginText] = useState(String(value.marginMultiplier));

  // Re-sync local state when the parent value changes externally
  // (preset switch, dialog re-open). Skip when the local text already
  // matches a clean serialisation so an in-progress edit isn't stomped
  // by a parent re-render.
  useEffect(() => {
    setThicknessText(prev =>
      prev !== '' && Number.parseInt(prev, 10) === value.thicknessPx
        ? prev
        : String(value.thicknessPx)
    );
  }, [value.thicknessPx]);
  useEffect(() => {
    setMarginText(prev =>
      prev !== '' && Number.parseInt(prev, 10) === value.marginMultiplier
        ? prev
        : String(value.marginMultiplier)
    );
  }, [value.marginMultiplier]);

  const setEnabled = (enabled: boolean) => onChange({ ...value, enabled });

  // Integer-only validators. User explicitly asked for integers in both
  // fields, so the margin step changed from 0.1 (float) to 1 (integer).
  const onThicknessChange = (raw: string) => {
    setThicknessText(raw);
    if (raw === '') return; // allow empty intermediate state for editing
    const n = Number.parseInt(raw, 10);
    if (
      Number.isFinite(n) &&
      n >= 1 &&
      n <= 100 &&
      String(n) === raw // reject decimal / leading-zero / sign noise
    ) {
      onChange({ ...value, thicknessPx: n });
    }
  };

  const onMarginChange = (raw: string) => {
    setMarginText(raw);
    if (raw === '') return;
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 0 && n <= 10 && String(n) === raw) {
      onChange({ ...value, marginMultiplier: n });
    }
  };

  // On blur, if the field is empty or invalid, snap back to the last
  // committed value so the user never leaves the form in an invalid
  // state (the submit button would otherwise read NaN through props).
  const onThicknessBlur = () => {
    const n = Number.parseInt(thicknessText, 10);
    if (!Number.isFinite(n) || n < 1 || n > 100) {
      setThicknessText(String(value.thicknessPx));
    }
  };
  const onMarginBlur = () => {
    const n = Number.parseInt(marginText, 10);
    if (!Number.isFinite(n) || n < 0 || n > 10) {
      setMarginText(String(value.marginMultiplier));
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
              inputMode="numeric"
              min={1}
              max={100}
              step={1}
              value={thicknessText}
              disabled={disabledInputs}
              onChange={e => onThicknessChange(e.target.value)}
              onBlur={onThicknessBlur}
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
              inputMode="numeric"
              min={0}
              max={10}
              step={1}
              value={marginText}
              disabled={disabledInputs}
              onChange={e => onMarginChange(e.target.value)}
              onBlur={onMarginBlur}
              className="mt-1 text-sm"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {t('export.mt.marginHelp')}
            </p>
          </div>
        </div>

        <div>
          <Label className="text-sm">{t('export.mt.channelsLabel')}</Label>
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
          {value.enabled && !noChannels && value.channels.length === 0 ? (
            <p className="text-xs text-destructive mt-2">
              {t('export.mt.selectChannelRequired')}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
};
