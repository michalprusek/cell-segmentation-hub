/**
 * Sidebar card with four image-display sliders: Min, Max, Brightness,
 * Contrast. Each row is a Radix Slider paired with a numeric Input
 * (Input ↔ Slider sync follows the FrameSlider pattern). All four
 * values persist across frame and channel changes for the same video,
 * fixing the previous min/max-resets-per-frame annoyance.
 *
 * Min/Max apply via the existing applyWindowLevel LUT (pixel-level
 * remap on the source canvas); Brightness/Contrast apply via CSS
 * `filter` on <CanvasImage>. The two compose at draw time.
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
        <span className="text-gray-700 dark:text-gray-300">{label}</span>
        <div className="flex items-center gap-1">
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
            className="w-16 h-7 text-center text-xs"
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
    brightness,
    contrast,
    setWindowMin,
    setWindowMax,
    setBrightness,
    setContrast,
    resetDisplay,
  } = useImageDisplay();

  return (
    <div className="w-full bg-white dark:bg-gray-800 border-l border-b border-gray-200 dark:border-gray-700">
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
        <DisplaySliderRow
          label={t('editor.windowLevel.min')}
          value={windowMin}
          min={0}
          max={255}
          onChange={setWindowMin}
        />
        <DisplaySliderRow
          label={t('editor.windowLevel.max')}
          value={windowMax}
          min={0}
          max={255}
          onChange={setWindowMax}
        />
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
