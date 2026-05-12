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
      className="w-full h-12 px-6 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between z-20 shadow-sm"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Left section - Breadcrumb Navigation */}
      <div className="flex items-center space-x-3">
        <Button
          variant="ghost"
          size="sm"
          className="text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-white/60 dark:hover:bg-slate-800/60 dark:bg-gray-900"
          onClick={handleHomeClick}
        >
          <Home className="h-4 w-4" />
        </Button>

        <ChevronRight className="h-4 w-4 text-slate-400" />

        <Button
          variant="ghost"
          size="sm"
          className="text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-white/60 dark:hover:bg-slate-800/60 max-w-32 sm:max-w-48 dark:bg-gray-900"
          onClick={handleBackClick}
        >
          <FolderOpen className="h-4 w-4 mr-2" />
          <span className="truncate text-sm font-medium">{projectTitle}</span>
        </Button>

        <ChevronRight className="h-4 w-4 text-slate-400" />

        <div className="flex items-center space-x-2">
          <ImageIcon className="h-4 w-4 text-blue-500" />
          <span className="text-sm font-medium text-slate-900 dark:text-white truncate max-w-32 sm:max-w-48">
            {imageName}
          </span>
        </div>
      </div>

      {/* Right section - Navigation and Progress */}
      <div className="flex items-center space-x-4">
        {/* WebSocket Connection Status */}
        <div
          className={`flex items-center space-x-1 px-2 py-1 rounded-md text-xs ${
            isWebSocketConnected
              ? 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20'
              : 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20'
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

        {/* Segmentation Status Indicator */}
        {imageId && (
          <SegmentationStatusIndicator
            imageId={imageId}
            segmentationStatus={segmentationStatus}
            lastUpdate={lastUpdate}
            queuePosition={queueStats?.position}
          />
        )}

        {/* Progress indicator — in video mode the frame # becomes an
            editable input and the progress gradient is replaced with a
            real scrubber slider; standalone images keep the original
            "X / Y" label + gradient bar. */}
        <div className="hidden md:flex items-center space-x-3">
          <div className="text-sm text-slate-600 dark:text-slate-300 flex items-center space-x-2">
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
                aria-label={t('editor.frameNavigation.frame')}
                className="w-16 h-8 text-center text-lg font-bold text-blue-600 dark:text-blue-400"
              />
            ) : (
              <span className="text-lg font-bold text-blue-600 dark:text-blue-400">
                {currentImageIndex + 1}
              </span>
            )}
            <span className="text-slate-400">/</span>
            <span>{isVideoMode ? videoFrameCount : totalImages}</span>
          </div>

          {isVideoMode ? (
            <Slider
              className="w-40"
              min={0}
              max={(videoFrameCount as number) - 1}
              step={1}
              value={[videoFrameIndex as number]}
              onValueChange={v => onVideoFrameChange?.(v[0])}
              aria-label={t('editor.frameNavigation.frame')}
            />
          ) : (
            <div className="w-24 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all duration-300"
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
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onNavigate('prev')}
            disabled={currentImageIndex <= 0}
            className="h-9 bg-white/60 dark:bg-slate-800/60 border-white/40 dark:border-slate-600/40 hover:bg-white dark:hover:bg-slate-700 dark:bg-gray-900"
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            <span className="hidden sm:inline">{t('common.back')}</span>
          </Button>
          {isVideoMode && onVideoToggle && (
            <Button
              variant="outline"
              size="icon"
              onClick={onVideoToggle}
              aria-label={
                videoIsPlaying
                  ? t('editor.frameNavigation.pause')
                  : t('editor.frameNavigation.play')
              }
              className="h-9 w-9 bg-white/60 dark:bg-slate-800/60 border-white/40 dark:border-slate-600/40 hover:bg-white dark:hover:bg-slate-700 dark:bg-gray-900"
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
            className="h-9 bg-white/60 dark:bg-slate-800/60 border-white/40 dark:border-slate-600/40 hover:bg-white dark:hover:bg-slate-700 dark:bg-gray-900"
          >
            <span className="hidden sm:inline">{t('common.next')}</span>
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </div>
    </motion.header>
  );
};

export default EditorHeader;
