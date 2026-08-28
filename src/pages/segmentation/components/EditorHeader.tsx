import React, { startTransition } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/useLanguage';
import { motion } from 'framer-motion';
import {
  ChevronLeft,
  ChevronRight,
  Home,
  FolderOpen,
  Image as ImageIcon,
  Pause,
  Play,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import SegmentationStatusIndicator from './SegmentationStatusIndicator';
import type {
  SegmentationUpdate,
  QueueStats,
} from '@/hooks/useSegmentationQueue';
import { logger } from '@/lib/logger';

interface EditorHeaderProps {
  projectId: string;
  projectTitle: string;
  imageName: string;
  currentImageIndex: number;
  totalImages: number;
  onNavigate: (direction: 'prev' | 'next') => void;
  hasUnsavedChanges?: boolean;
  onSave?: () => Promise<void>;
  imageId?: string;
  segmentationStatus?: string;
  lastUpdate?: SegmentationUpdate | null;
  queueStats?: QueueStats | null;
  isWebSocketConnected?: boolean;
  /** Video-mode props — supplied only when the editor is showing a
   *  frame inside a video container. When ``videoFrameCount > 1`` the
   *  header swaps the static progress bar for a scrubber + editable
   *  frame # input and renders a Play/Pause button between Back/Next. */
  videoFrameCount?: number;
  videoFrameIndex?: number;
  onVideoFrameChange?: (frameIndex: number) => void;
  videoIsPlaying?: boolean;
  onVideoToggle?: () => void;
}

const EditorHeader = ({
  projectId,
  projectTitle,
  imageName,
  currentImageIndex,
  totalImages,
  onNavigate,
  hasUnsavedChanges = false,
  onSave,
  imageId,
  segmentationStatus,
  lastUpdate,
  queueStats,
  isWebSocketConnected = false,
  videoFrameCount,
  videoFrameIndex,
  onVideoFrameChange,
  videoIsPlaying,
  onVideoToggle,
}: EditorHeaderProps) => {
  const navigate = useNavigate();
  const { t } = useLanguage();

  // Video mode is "on" when the parent supplied a frame count > 1 plus
  // the wiring needed to actually navigate. Falling through to false
  // keeps the header backwards-compatible for standalone images.
  const isVideoMode =
    typeof videoFrameCount === 'number' &&
    videoFrameCount > 1 &&
    typeof videoFrameIndex === 'number' &&
    typeof onVideoFrameChange === 'function';

  const handleBackClick = () => {
    // Use startTransition to ensure navigation works with React 18 concurrent features
    // This fixes navigation freezing issues after segmentation
    startTransition(() => {
      // Navigate immediately - don't block UI
      navigate(`/project/${projectId}`);
    });

    // Fire background save if needed
    if (hasUnsavedChanges && onSave) {
      // Create timeout promise (3 seconds)
      const timeoutPromise = new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('Save timeout')), 3000)
      );

      // Race between save and timeout
      Promise.race([onSave(), timeoutPromise]).catch(error => {
        // Log error but don't block navigation
        logger.warn(
          'Background autosave failed or timed out during navigation',
          {
            error: error.message,
            destination: 'project',
            projectId,
          }
        );
      });
    }
  };

  const handleHomeClick = () => {
    // Use startTransition to ensure navigation works with React 18 concurrent features
    // This fixes navigation freezing issues after segmentation
    startTransition(() => {
      // Navigate immediately - don't block UI
      navigate('/dashboard');
    });

    // Fire background save if needed
    if (hasUnsavedChanges && onSave) {
      // Create timeout promise (3 seconds)
      const timeoutPromise = new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('Save timeout')), 3000)
      );

      // Race between save and timeout
      Promise.race([onSave(), timeoutPromise]).catch(error => {
        // Log error but don't block navigation
        logger.warn(
          'Background autosave failed or timed out during navigation',
          {
            error: error.message,
            destination: 'dashboard',
          }
        );
      });
    }
  };

  return (
    <motion.header
      className="z-20 flex h-12 w-full items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 shadow-sm sm:px-6 dark:border-gray-700 dark:bg-gray-900"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Left section - Breadcrumb Navigation */}
      <div className="flex min-w-0 items-center gap-1 sm:gap-2">
        <Button
          variant="ghost"
          size="sm"
          aria-label={String(t('common.dashboard'))}
          className="shrink-0 px-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
          onClick={handleHomeClick}
        >
          <Home className="h-4 w-4" />
        </Button>

        <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />

        <Button
          variant="ghost"
          size="sm"
          className="min-w-0 max-w-24 shrink px-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900 sm:max-w-48 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
          onClick={handleBackClick}
        >
          <FolderOpen className="mr-2 h-4 w-4 shrink-0" />
          <span className="truncate text-sm font-medium">{projectTitle}</span>
        </Button>

        <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />

        <div className="flex min-w-0 items-center gap-2">
          <ImageIcon className="h-4 w-4 shrink-0 text-blue-500" />
          <span
            className="truncate text-sm font-medium text-slate-900 dark:text-white"
            title={imageName}
          >
            {imageName}
          </span>
        </div>
      </div>

      {/* Right section - Navigation and Progress */}
      <div className="flex shrink-0 items-center gap-3">
        {/* WebSocket Connection Status. Deliberately not a live region: the
            editor socket flaps in some sessions, and re-announcing
            "Online"/"Offline" on every flip is noise. The colour and the
            title carry it. */}
        <div
          className={`flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs ${
            isWebSocketConnected
              ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400'
              : 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400'
          }`}
          title={
            isWebSocketConnected
              ? t('websocket.connected')
              : t('websocket.disconnected')
          }
        >
          {isWebSocketConnected ? (
            <Wifi className="h-3 w-3" />
          ) : (
            <WifiOff className="h-3 w-3" />
          )}
          <span className="hidden sm:inline">
            {isWebSocketConnected ? t('status.online') : t('status.offline')}
          </span>
        </div>

        {/* Segmentation Status Indicator. Width-capped and `lg`-gated: this
            is the only variable-width item on this side, and an uncapped
            localized phrase (cs/de are long) used to push Back/Play/Next past
            the header edge. Measured with a phrase longer than any real
            translation, the header now overflows by 0 px at 768/1024/1440.
            Below `lg` the status yields to the frame controls — a transient
            state that toasts also report, versus the only way to change
            frame. */}
        {imageId && (
          <div className="hidden min-w-0 max-w-[10rem] overflow-hidden lg:block">
            <SegmentationStatusIndicator
              imageId={imageId}
              segmentationStatus={segmentationStatus}
              lastUpdate={lastUpdate}
              queuePosition={queueStats?.position}
            />
          </div>
        )}

        {/* Progress indicator — in video mode the frame # becomes an
            editable input and the progress gradient is replaced with a
            real scrubber slider; standalone images keep the original
            "X / Y" label + gradient bar. */}
        <div className="hidden shrink-0 items-center gap-3 md:flex">
          {/* `tabular-nums` + a min width: without them the counter's pixel
              width changes with every digit while scrubbing, so the slider
              beside it jitters left and right under the cursor. */}
          <div className="flex items-center gap-2 text-sm tabular-nums text-slate-600 dark:text-slate-300">
            {isVideoMode ? (
              <Input
                type="number"
                min={1}
                max={videoFrameCount}
                value={(videoFrameIndex as number) + 1}
                onChange={e => {
                  const next = Number(e.target.value);
                  if (!Number.isFinite(next) || !onVideoFrameChange) return;
                  onVideoFrameChange(
                    Math.max(
                      0,
                      Math.min((videoFrameCount as number) - 1, next - 1)
                    )
                  );
                }}
                aria-label={String(t('editor.frameNavigation.frame'))}
                className="h-8 w-16 px-1 text-center text-base font-semibold tabular-nums text-blue-600 dark:text-blue-400"
              />
            ) : (
              <span className="min-w-[2ch] text-right text-base font-semibold tabular-nums text-blue-600 dark:text-blue-400">
                {currentImageIndex + 1}
              </span>
            )}
            <span className="text-slate-400">/</span>
            <span className="min-w-[2ch]">
              {isVideoMode ? videoFrameCount : totalImages}
            </span>
          </div>

          {isVideoMode ? (
            // A 600-frame scrubber in 160 px gives ~4 frames per pixel. The
            // track grows with the viewport so the frame you aim at is the
            // frame you land on.
            <Slider
              className="w-36 lg:w-52 xl:w-72"
              min={0}
              max={(videoFrameCount as number) - 1}
              step={1}
              value={[videoFrameIndex as number]}
              onValueChange={v => onVideoFrameChange?.(v[0])}
              aria-label={String(t('editor.frameNavigation.frame'))}
            />
          ) : (
            <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <div
                className="h-full bg-blue-600 transition-all duration-300"
                style={{
                  width: `${((currentImageIndex + 1) / totalImages) * 100}%`,
                }}
              />
            </div>
          )}
        </div>

        {/* Navigation buttons — in video mode the Play/Pause button
            sits between Back and Next so frame nav becomes a 3-button
            tactile group (Back ⏵ ⏸ Next). */}
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onNavigate('prev')}
            disabled={currentImageIndex <= 0}
            className="h-9"
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            <span className="hidden sm:inline">{t('common.back')}</span>
          </Button>
          {isVideoMode && onVideoToggle && (
            <Button
              variant="outline"
              size="icon"
              onClick={onVideoToggle}
              aria-label={String(
                videoIsPlaying
                  ? t('editor.frameNavigation.pause')
                  : t('editor.frameNavigation.play')
              )}
              className="h-9 w-9"
            >
              {videoIsPlaying ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => onNavigate('next')}
            disabled={currentImageIndex >= totalImages - 1}
            className="h-9"
          >
            <span className="hidden sm:inline">{t('common.next')}</span>
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </div>
    </motion.header>
  );
};

export default EditorHeader;
