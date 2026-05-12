/**
 * Bottom-of-canvas frame navigation strip for video-mode editor.
 *
 * Renders: prev/play-pause/next buttons, a slider scoped to [0, frameCount-1],
 * the current frame index & total, plus an FPS selector. All state comes
 * from useVideoFrames — this component is presentational.
 */

import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { useLanguage } from '@/contexts/useLanguage';

interface FrameSliderProps {
  frameIndex: number;
  frameCount: number;
  isPlaying: boolean;
  fps: number;
  onFrameChange: (i: number) => void;
  onStep: (delta: number) => void;
  onToggle: () => void;
  onFpsChange: (fps: number) => void;
}

export function FrameSlider({
  frameIndex,
  frameCount,
  isPlaying,
  fps,
  onFrameChange,
  onStep,
  onToggle,
  onFpsChange,
}: FrameSliderProps) {
  const { t } = useLanguage();
  const safeFrameCount = Math.max(1, frameCount);

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-background border-t">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => onStep(-1)}
        disabled={frameIndex <= 0}
        aria-label={t('editor.frameNavigation.prevFrame', {
          defaultValue: 'Previous frame',
        })}
      >
        <SkipBack className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={onToggle}
        aria-label={
          isPlaying
            ? t('editor.frameNavigation.pause', { defaultValue: 'Pause' })
            : t('editor.frameNavigation.play', { defaultValue: 'Play' })
        }
      >
        {isPlaying ? (
          <Pause className="h-4 w-4" />
        ) : (
          <Play className="h-4 w-4" />
        )}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => onStep(1)}
        disabled={frameIndex >= safeFrameCount - 1}
        aria-label={t('editor.frameNavigation.nextFrame', {
          defaultValue: 'Next frame',
        })}
      >
        <SkipForward className="h-4 w-4" />
      </Button>

      <Slider
        className="flex-1 mx-2"
        min={0}
        max={Math.max(0, safeFrameCount - 1)}
        step={1}
        value={[frameIndex]}
        onValueChange={values => onFrameChange(values[0])}
      />

      <Input
        type="number"
        className="w-16 h-8 text-center"
        min={1}
        max={safeFrameCount}
        value={frameIndex + 1}
        onChange={e => {
          const next = Number(e.target.value);
          if (Number.isFinite(next)) onFrameChange(next - 1);
        }}
        aria-label={t('editor.frameNavigation.frame', {
          defaultValue: 'Frame',
        })}
      />
      <span className="text-xs text-muted-foreground tabular-nums">
        /{safeFrameCount}
      </span>

      <select
        className="ml-2 h-8 rounded border bg-background px-1 text-xs"
        value={fps}
        onChange={e => onFpsChange(Number(e.target.value))}
        aria-label={t('editor.frameNavigation.fps', { defaultValue: 'FPS' })}
      >
        {[2, 5, 10, 15, 20, 30].map(v => (
          <option key={v} value={v}>
            {v} fps
          </option>
        ))}
      </select>
    </div>
  );
}
