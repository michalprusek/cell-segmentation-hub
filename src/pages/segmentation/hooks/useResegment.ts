import { useState, useCallback, useRef } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import apiClient, { type SegmentationPolygon } from '@/lib/api';
import { logger } from '@/lib/logger';
import { handleCancelledError } from '@/lib/errorUtils';
import { toast } from 'sonner';
import { setCachedSegmentationPolygons } from './segmentationPolygonCache';

interface UseResegmentParams {
  projectId: string | undefined;
  imageId: string | undefined;
  /** The project's resolved model and its calibrated threshold. `undefined`
   *  only while the project is still loading — the resolver never returns a
   *  model incompatible with the project, so absence is a race, not a
   *  misconfiguration. */
  selectedModel: string | undefined;
  confidenceThreshold: number | undefined;
  detectHoles: boolean;
  /**
   * Channels from `video.container?.channels` (or null for standalone images).
   * Only the count is read here (to decide whether to open the channel picker),
   * so the element shape is intentionally opaque.
   */
  videoChannels: readonly unknown[] | null | undefined;
  queryClient: QueryClient;
  /** Translation function. */
  t: (key: string) => string;
  /** Liaison callback that bumps reloadNonce + sets segmentationPolygons. */
  onReloaded: (polys: SegmentationPolygon[] | null) => void;
  /** Setter from useSegmentationLoader — called when fresh dims arrive. */
  setImageDimensions: React.Dispatch<
    React.SetStateAction<{ width: number; height: number } | null>
  >;
  /** Ref tracking the currently-active imageId (written by orchestrator). */
  currentImageIdRef: React.MutableRefObject<string | undefined>;
}

interface UseResegmentResult {
  isResegmenting: boolean;
  showResegmentChannelDialog: boolean;
  setShowResegmentChannelDialog: React.Dispatch<React.SetStateAction<boolean>>;
  runResegment: (channel?: string) => Promise<void>;
  handleResegmentCurrentFrame: () => void;
}

/**
 * Owns the resegment + completion-poll cluster:
 *   - isResegmenting + showResegmentChannelDialog state
 *   - resegPollSeqRef (invalidation token)
 *   - startResegmentPoll (background HTTP poll — fires success toast + reloadNonce bump)
 *   - runResegment (batch endpoint call + poll kickoff)
 *   - handleResegmentCurrentFrame (top-toolbar entry point, opens channel picker or delegates)
 *
 * HAZARD — TDZ: this hook takes videoChannels as a PARAMETER so it never
 * calls useVideoFrames itself (would duplicate the query). The orchestrator
 * must call this hook AFTER `const video = useVideoFrames(...)` and pass
 * `video.container?.channels ?? null` (CLAUDE.md production bug #11).
 */
export function useResegment({
  projectId: _projectId,
  imageId,
  selectedModel,
  confidenceThreshold,
  detectHoles,
  videoChannels,
  queryClient,
  t,
  onReloaded,
  setImageDimensions,
  currentImageIdRef,
}: UseResegmentParams): UseResegmentResult {
  const [isResegmenting, setIsResegmenting] = useState(false);

  // Channel picker state for multi-channel video frames.
  const [showResegmentChannelDialog, setShowResegmentChannelDialog] =
    useState(false);

  // Monotonic token for the background resegment-completion poll so a new
  // resegment (or image switch) invalidates a still-running poll.
  const resegPollSeqRef = useRef(0);

  // `selectedModel` arrives already resolved against this project's type
  // (`useProjectModel` in the editor), so there is nothing left to correct
  // here. This used to hold an `effectiveResegmentModel` memo that forced the
  // whitelisted model whenever a type had exactly one — a patch for the global
  // model setting, which could not help the spheroid type where the choice was
  // real. The resolver is right for every type, so the patch is gone rather
  // than merely unused.

  // Background poll that refreshes the editor when a resegment completes.
  // The WebSocket completion event is not a dependable trigger, so we poll
  // the result's `updatedAt` over plain HTTP (no AbortController, so a
  // re-rendering editor can't cancel it) and apply the fresh polygons
  // directly once it advances. A seq token invalidates a stale poll when a
  // new resegment starts or the user switches frames.
  const startResegmentPoll = useCallback(
    (targetImageId: string, prevStamp: string | null, announce: boolean) => {
      const seq = ++resegPollSeqRef.current;
      const deadline = Date.now() + 120_000;
      const tick = async () => {
        if (
          seq !== resegPollSeqRef.current ||
          targetImageId !== currentImageIdRef.current ||
          Date.now() > deadline
        ) {
          return;
        }
        let fresh = null;
        try {
          fresh = await apiClient.getSegmentationResults(targetImageId);
        } catch {
          // transient — keep polling
        }
        if (
          seq !== resegPollSeqRef.current ||
          targetImageId !== currentImageIdRef.current
        ) {
          return;
        }
        if (fresh && fresh.updatedAt && fresh.updatedAt !== prevStamp) {
          // Apply the already-fetched fresh result DIRECTLY rather than via
          // reloadSegmentation. reloadSegmentation runs a second fetch behind
          // its own AbortController + cleanup, which a concurrent reload (or
          // the editor's churn) can cancel — leaving onPolygonsLoaded (and
          // the reloadNonce bump) unfired. Here we:
          //   1. write the React Query cache so the editor's load effect
          //      (which re-runs on the segmentationStatus flip and reads
          //      cache-first) can't clobber us back to the stale result, and
          //   2. push state + bump reloadNonce via onReloaded so
          //      the canvas re-syncs even at an unchanged polygon count.
          if (fresh.imageWidth && fresh.imageHeight) {
            setImageDimensions({
              width: fresh.imageWidth,
              height: fresh.imageHeight,
            });
          }
          setCachedSegmentationPolygons(queryClient, targetImageId, {
            polygons: fresh.polygons ?? null,
            imageWidth: fresh.imageWidth,
            imageHeight: fresh.imageHeight,
          });
          onReloaded(fresh.polygons ?? null);
          if (announce) {
            toast.success(t('segmentation.toolbar.resegmentSuccess'));
          }
          return;
        }
        setTimeout(tick, 2000);
      };
      setTimeout(tick, 2000);
    },
    [onReloaded, setImageDimensions, queryClient, t, currentImageIdRef]
  );

  // Pure request helper — shared by the direct (single-channel) path
  // and the dialog's onConfirm callback.
  const runResegment = useCallback(
    async (channel?: string) => {
      // `selectedModel` is absent only in the window before the project has
      // loaded. Bail rather than dispatching a request with no model, which
      // the backend would reject with a 400 the user cannot act on.
      if (
        !imageId ||
        isResegmenting ||
        !selectedModel ||
        confidenceThreshold === undefined
      ) {
        return;
      }
      setIsResegmenting(true);
      try {
        // Snapshot the current result timestamp so the completion poll can
        // tell when the ML has written the *new* segmentation.
        const prevStamp =
          (await apiClient.getSegmentationResults(imageId).catch(() => null))
            ?.updatedAt ?? null;
        const result = await apiClient.requestBatchSegmentation(
          [imageId],
          selectedModel,
          confidenceThreshold,
          detectHoles,
          channel
        );
        // Batch endpoint returns HTTP 200 even when every image failed;
        // surface the per-image outcome (review pass-2 silent-failure #5).
        if (result.successful === 0) {
          const firstError = result.results?.[0]?.error;
          logger.error('Resegment returned 0 successes', { firstError });
          toast.error(
            firstError
              ? `${t('segmentation.toolbar.resegmentFailed')}: ${firstError}`
              : t('segmentation.toolbar.resegmentFailed')
          );
          return;
        }
        // Defense-in-depth: a 1-image call is always all-or-nothing,
        // but if the helper is ever reused with >1 imageIds a partial
        // failure must not be hidden by the success toast.
        if (result.failed > 0) {
          const firstError = result.results?.find(r => !r.success)?.error;
          logger.warn('Resegment partial failure', { result });
          toast.warning(
            firstError
              ? `${t('segmentation.toolbar.resegmentSuccess')} (${result.failed} failed: ${firstError})`
              : `${t('segmentation.toolbar.resegmentSuccess')} (${result.failed} failed)`
          );
        }
        // The job is now QUEUED — the ML has not produced the new polygons
        // yet. Kick off a non-blocking background poll that refreshes the
        // canvas + fires the success toast once the new segmentation lands;
        // isResegmenting is cleared right away (finally) so the button never
        // appears stuck while the ML runs.
        startResegmentPoll(imageId, prevStamp, result.failed === 0);
      } catch (err) {
        if (handleCancelledError(err, 'resegment current frame')) return;
        logger.error('Resegment failed', err);
        toast.error(t('segmentation.toolbar.resegmentFailed'));
      } finally {
        setIsResegmenting(false);
      }
    },
    [
      imageId,
      isResegmenting,
      selectedModel,
      confidenceThreshold,
      detectHoles,
      startResegmentPoll,
      t,
    ]
  );

  // Top-toolbar Resegment entry point. Multichannel videos open the
  // channel picker first (per CLAUDE.md spec); single-channel cases
  // commit immediately.
  const handleResegmentCurrentFrame = useCallback(() => {
    if (!imageId || isResegmenting) return;
    const channels = videoChannels ?? [];
    if (channels.length > 1) {
      setShowResegmentChannelDialog(true);
      return;
    }
    void runResegment();
  }, [imageId, isResegmenting, videoChannels, runResegment]);

  return {
    isResegmenting,
    showResegmentChannelDialog,
    setShowResegmentChannelDialog,
    runResegment,
    handleResegmentCurrentFrame,
  };
}
