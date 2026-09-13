/**
 * Sidebar card with the image-display controls: a histogram, Min, Max,
 * Brightness, Contrast. Each slider row is a Radix Slider paired with a numeric
 * Input (Input ↔ Slider sync follows the FrameSlider pattern). Brightness/
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
 * The histogram and the Auto button are ImageJ's Brightness & Contrast dialog;
 * the arithmetic is in `@/lib/histogram`, held to ImageJ's own output. As in
 * ImageJ, the histogram and both window sliders span the channel's DATA range
 * ([dimmest, brightest] sample seen), not 0..max: a dim 12-bit IRM channel
 * sitting at 2941..4145 would otherwise use a third of the track and a third of
 * the plot.
 *
 * MultiChannelCanvas remaps each channel's true (16-bit-aware) samples through
 * its own LUT; Brightness/Contrast apply once, via CSS `filter`, on the
 * composite. The two compose at draw time.
 */

import { useRef } from 'react';
import { RotateCcw } from 'lucide-react';
import { useLanguage } from '@/contexts/useLanguage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { autoAdjust, rawStatistics } from '@/lib/histogram';
import {
  useDisplayedSamples,
  useImageDisplay,
} from '../../contexts/ImageDisplayContext';
import WindowHistogram from './WindowHistogram';

interface DisplaySliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  suffix?: string;
  /** Where the slider TRACK starts, when that is not where typed input stops.
   *  The Min/Max tracks span the channel's data, like ImageJ's scrollbars,
   *  while the number field still accepts anything down to `min`. */
  sliderMin?: number;
}

function DisplaySliderRow({
  label,
  value,
  min,
  max,
  onChange,
  suffix,
  sliderMin,
}: DisplaySliderRowProps) {
  const trackMin = sliderMin ?? min;
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
        min={trackMin}
        max={max}
        step={1}
        // A typed value below the track would put the thumb off its end.
        value={[Math.max(trackMin, Math.min(max, value))]}
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
    windowDataMin,
    windowIsMeasured,
    windowChannel,
    visibleChannels,
    channelColors,
    brightness,
    contrast,
    setWindow,
    setWindowMin,
    setWindowMax,
    setActiveWindowChannel,
    setBrightness,
    setContrast,
    resetDisplay,
  } = useImageDisplay();
  const displayed = useDisplayedSamples();
  const activeSamples = displayed?.channels[windowChannel] ?? null;

  // Only worth the row when there is a choice to make. One channel (or none,
  // for a plain image) means the sliders can only mean that channel anyway.
  const showChannelTabs = visibleChannels.length > 1;

  // Min/Max only reach pixels a canvas painted through a LUT. A plain 8-bit
  // image renders as an <img> and never decodes its samples, so the cutoffs
  // would be two sliders that change nothing. Brightness/Contrast are a CSS
  // filter and DO apply there, which is why only this pair is gated.
  const showWindow = windowIsMeasured;

  // The axis the histogram and both window tracks share. It needs a positive
  // span, which a channel that has only ever shown one value does not have.
  const axisMin = Math.max(0, Math.min(windowDataMin, windowRangeMax - 1));

  // Auto's progressive threshold. ImageJ carries it from press to press while
  // the image, slice and channel stay the same — each press saturates more —
  // and starts over on anything else, and on Reset. Held in a ref: it steers
  // the next press and nothing on screen depends on it.
  const autoRef = useRef({ key: '', threshold: 0 });

  const handleAuto = () => {
    if (!displayed || !activeSamples) return;
    const key = `${displayed.frameKey}::${windowChannel}`;
    const previous =
      autoRef.current.key === key ? autoRef.current.threshold : 0;
    const result = autoAdjust(
      rawStatistics(activeSamples),
      activeSamples.min,
      activeSamples.max,
      previous
    );
    autoRef.current = { key, threshold: result.autoThreshold };
    if (result.kind === 'window') {
      // ImageJ displays its window rounded to whole sample values.
      setWindow(Math.round(result.min), Math.round(result.max));
    } else {
      // ImageJ's reset(): the frame's own range for 16-bit. For 8-bit it
      // resets to 0..255 instead, which here would put Max past the track's
      // end, so both get the data range the track shows.
      setWindow(activeSamples.min, activeSamples.max);
    }
  };

  const handleReset = () => {
    autoRef.current = { key: '', threshold: 0 };
    resetDisplay();
  };

  return (
    <div className="w-full shrink-0 bg-white dark:bg-gray-800 border-l border-b border-gray-200 dark:border-gray-700">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
          {t('editor.windowLevel.title')}
        </h3>
        <div className="flex items-center gap-1">
          {showWindow && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleAuto}
              disabled={!activeSamples}
              title={String(t('editor.windowLevel.autoHint'))}
              className="h-7 px-2 text-xs"
            >
              {t('editor.windowLevel.auto')}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            aria-label={t('editor.windowLevel.reset')}
            className="h-7 px-2 text-xs"
          >
            <RotateCcw className="h-3 w-3 mr-1" />
            {t('editor.windowLevel.reset')}
          </Button>
        </div>
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
            <WindowHistogram
              samples={activeSamples}
              axisMin={axisMin}
              axisMax={windowRangeMax}
              windowMin={windowMin}
              windowMax={windowMax}
              color={channelColors[windowChannel] ?? '#FFFFFF'}
              label={String(t('editor.windowLevel.histogram'))}
            />
            <DisplaySliderRow
              label={t('editor.windowLevel.min')}
              value={windowMin}
              min={0}
              max={windowRangeMax}
              sliderMin={axisMin}
              onChange={setWindowMin}
            />
            <DisplaySliderRow
              label={t('editor.windowLevel.max')}
              value={windowMax}
              min={0}
              max={windowRangeMax}
              sliderMin={axisMin}
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
