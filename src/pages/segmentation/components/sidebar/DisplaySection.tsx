/**
 * Sidebar card with four image-display sliders: Min, Max, Brightness,
 * Contrast. Each row is a Radix Slider paired with a numeric Input
 * (Input ↔ Slider sync follows the FrameSlider pattern). Brightness/
 * Contrast are global and persist across frame and channel changes.
 *
 * Min/Max are the ImageJ-style window/level cutoffs and belong to ONE CHANNEL
 * at a time — the tabs above them pick which. Channels in a composite differ in
 * dynamic range by more than an order of magnitude, and one shared window makes
 * the narrow one an unreadable flat field; `ImageDisplayContext`'s
 * `channelWindows` records what that cost. The tabs default to the segmentation
 * source, so the channel the model ran on is the one being adjusted unless the
 * user says otherwise.
 *
 * MultiChannelCanvas remaps each channel's true (16-bit-aware) samples through
 * its own LUT; Brightness/Contrast apply once, via CSS `filter`, on the
 * composite. The two compose at draw time.
 */

import { RotateCcw } from 'lucide-react';
import { useLanguage } from '@/contexts/useLanguage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { useImageDisplay } from '../../contexts/ImageDisplayContext';

interface DisplaySliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  suffix?: string;
}

function DisplaySliderRow({
  label,
  value,
  min,
  max,
  onChange,
  suffix,
}: DisplaySliderRowProps) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="min-w-0 flex-1 truncate text-gray-700 dark:text-gray-300">
          {label}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          <Input
            type="number"
            min={min}
            max={max}
            value={value}
            onChange={e => {
              const next = Number(e.target.value);
              if (!Number.isFinite(next)) return;
              onChange(Math.max(min, Math.min(max, next)));
            }}
            className="h-7 w-20 shrink-0 px-1 text-center text-xs tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          {suffix && (
            <span className="text-gray-500 dark:text-gray-400 text-xs">
              {suffix}
            </span>
          )}
        </div>
      </div>
      <Slider
        min={min}
        max={max}
        step={1}
        value={[value]}
        onValueChange={v => onChange(v[0])}
        aria-label={label}
      />
    </div>
  );
}

export default function DisplaySection() {
  const { t } = useLanguage();
  const {
    windowMin,
    windowMax,
    windowRangeMax,
    windowIsMeasured,
    windowChannel,
    visibleChannels,
    channelColors,
    brightness,
    contrast,
    setWindowMin,
    setWindowMax,
    setActiveWindowChannel,
    setBrightness,
    setContrast,
    resetDisplay,
  } = useImageDisplay();

  // Only worth the row when there is a choice to make. One channel (or none,
  // for a plain image) means the sliders can only mean that channel anyway.
  const showChannelTabs = visibleChannels.length > 1;

  // Min/Max only reach pixels a canvas painted through a LUT. A plain 8-bit
  // image renders as an <img> and never decodes its samples, so the cutoffs
  // would be two sliders that change nothing. Brightness/Contrast are a CSS
  // filter and DO apply there, which is why only this pair is gated.
  const showWindow = windowIsMeasured;

  return (
    <div className="w-full shrink-0 bg-white dark:bg-gray-800 border-l border-b border-gray-200 dark:border-gray-700">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
          {t('editor.windowLevel.title')}
        </h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={resetDisplay}
          aria-label={t('editor.windowLevel.reset')}
          className="h-7 px-2 text-xs"
        >
          <RotateCcw className="h-3 w-3 mr-1" />
          {t('editor.windowLevel.reset')}
        </Button>
      </div>
      <div className="p-4 space-y-3">
        {showChannelTabs && (
          <div className="space-y-1">
            <span className="text-xs text-gray-700 dark:text-gray-300">
              {t('editor.windowLevel.channel')}
            </span>
            <div
              role="tablist"
              aria-label={String(t('editor.windowLevel.channel'))}
              className="flex flex-wrap gap-1"
            >
              {visibleChannels.map(ch => {
                const active = ch === windowChannel;
                return (
                  <button
                    key={ch}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setActiveWindowChannel(ch)}
                    title={ch}
                    className={
                      'flex max-w-full items-center gap-1 rounded px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
                      (active
                        ? 'bg-blue-100 font-medium text-blue-900 ring-1 ring-inset ring-blue-300 dark:bg-blue-900 dark:text-blue-100 dark:ring-blue-700'
                        : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700')
                    }
                  >
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 shrink-0 rounded-full border border-gray-400"
                      style={{
                        backgroundColor: channelColors[ch] ?? '#FFFFFF',
                      }}
                    />
                    <span className="truncate">{ch}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {showWindow && (
          <>
            <DisplaySliderRow
              label={t('editor.windowLevel.min')}
              value={windowMin}
              min={0}
              max={windowRangeMax}
              onChange={setWindowMin}
            />
            <DisplaySliderRow
              label={t('editor.windowLevel.max')}
              value={windowMax}
              min={0}
              max={windowRangeMax}
              onChange={setWindowMax}
            />
          </>
        )}
        <DisplaySliderRow
          label={t('editor.windowLevel.brightness')}
          value={brightness}
          min={0}
          max={200}
          onChange={setBrightness}
          suffix="%"
        />
        <DisplaySliderRow
          label={t('editor.windowLevel.contrast')}
          value={contrast}
          min={0}
          max={200}
          onChange={setContrast}
          suffix="%"
        />
      </div>
    </div>
  );
}
