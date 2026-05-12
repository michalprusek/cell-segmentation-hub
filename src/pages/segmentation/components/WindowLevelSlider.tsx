/**
 * Min/max window-level slider — the ImageJ-style "Brightness/Contrast"
 * dialog in disguise. Acts on the displayed canvas only (LUT remap via
 * applyWindowLevel); the source pixel data and segmentation results are
 * unaffected.
 *
 * The slider is a dual-handle Radix slider scoped to [0, 255]. The
 * displayed image is treated as already 8-bit (the extractor normalises
 * to uint8 PNG via percentile clipping), so 0/255 are the meaningful
 * endpoints.
 */

import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { useLanguage } from '@/contexts/useLanguage';
import { useImageDisplay } from '../contexts/ImageDisplayContext';

export function WindowLevelSlider() {
  const { t } = useLanguage();
  const { windowMin, windowMax, setWindow, resetWindow } = useImageDisplay();

  return (
    <div className="flex items-center gap-2 px-2 py-1 rounded border bg-background">
      <span
        className="text-xs text-muted-foreground"
        title={t('editor.windowLevel.title', {
          defaultValue: 'Window / Level (min / max)',
        })}
      >
        Win
      </span>
      <span className="text-[10px] tabular-nums w-7 text-right">
        {windowMin}
      </span>
      <Slider
        className="w-32"
        min={0}
        max={255}
        step={1}
        value={[windowMin, windowMax]}
        onValueChange={values => {
          if (values.length >= 2) setWindow(values[0], values[1]);
        }}
      />
      <span className="text-[10px] tabular-nums w-7">{windowMax}</span>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={resetWindow}
        aria-label={t('editor.windowLevel.reset', { defaultValue: 'Reset' })}
      >
        <RotateCcw className="h-3 w-3" />
      </Button>
    </div>
  );
}
