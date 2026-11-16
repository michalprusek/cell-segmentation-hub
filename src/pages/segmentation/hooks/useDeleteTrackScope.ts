import { useCallback, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import apiClient from '@/lib/api';
import { logger } from '@/lib/logger';
import { useLanguage } from '@/contexts/useLanguage';
import { isMicrotubuleProject, type ProjectType } from '@/types';
import type { Polygon } from '@/lib/segmentation';

export interface UseDeleteTrackScopeParams {
  projectType?: ProjectType;
  /** Video container id. Cross-frame ops address frames by `parentVideoId`. */
  videoId?: string;
  /** The frame currently open in the editor — the frame-scoped delete target. */
  imageId?: string;
  /** Reads the CURRENT polygons (an `editorRef` read, never a render snapshot). */
  getPolygons: () => Polygon[];
  /** Drop the polygon from local editor state and forget its hidden-state key.
   *  `silent` suppresses its generic toast; the scope handlers raise their own,
   *  which says which frames were touched. */
  removeLocally: (polygonId: string, options?: { silent?: boolean }) => void;
  /** Evict cached sibling-frame segmentations after the server changed them. */
  onServerMutation: () => void;
}

export interface DeleteTrackScopeHandlers {
  /**
   * Delete `polygonId`. For a tracked microtubule this is the WHOLE-track
   * delete — every frame of the video, applied server-side immediately.
   * Anything else falls through to a plain local delete.
   */
  deleteWholeTrack: (polygonId: string) => Promise<void>;
  /**
   * Remove a tracked microtubule from the CURRENT frame only. Untracked
   * polygons fall through to the same local delete (there is no other scope).
   */
  deleteFromCurrentFrame: (polygonId: string) => Promise<void>;
  /**
   * Entry point for delete gestures that carry no scope of their own (the
   * Delete key, the sidebar trash). Returns `true` when the polygon is a
   * tracked microtubule and the scope dialog was opened — the caller must then
   * NOT delete anything itself. Returns `false` for everything else, meaning
   * "you handle it".
   */
  requestDelete: (polygonId: string) => boolean;
  /**
   * The same, for a gesture that deletes MANY polygons at once (the delete
   * tool's scribble). Every tracked microtubule among `polygonIds` is claimed
   * and asked about in ONE dialog whose answer applies to all of them; the
   * returned ids are the ones NOT claimed, which the caller deletes itself.
   */
  requestDeleteMany: (polygonIds: string[]) => string[];
  /** Props for the editor-level {@link DeleteTrackScopeDialog}. */
  scopeDialog: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDeleteFrame: () => void;
    onDeleteTrack: () => void;
    /** How many microtubules the open dialog is asking about. */
    count: number;
  };
}

interface PendingTarget {
  polygonId: string;
  trackId: string;
}

/**
 * Owns the "this frame or the whole track?" decision for microtubule deletes.
 *
 * A microtubule with a `trackId` is one object spread across every frame of the
 * video, so a delete has two legitimate meanings and the editor must not pick
 * silently. It used to: the context menu deleted the whole track explicitly,
 * and the Delete key / delete-mode / sidebar paths deleted it locally — which
 * the backend's save-time diff then mirrored onto every sibling frame anyway,
 * with no prompt and no visible cue. Both scopes now go through an explicit
 * choice, and both write through the server:
 *
 *  - whole track  → `DELETE /segmentation/videos/:videoId/tracks/:trackId`
 *  - this frame   → `DELETE /segmentation/images/:imageId/tracks/:trackId`
 *
 * The frame-scoped call is what makes "this frame only" actually stick. Simply
 * dropping the polyline from editor state and saving is, on the wire,
 * indistinguishable from a whole-track delete, so `diffTrackOps` would remove
 * it everywhere. Writing the frame first moves that diff's baseline: the next
 * save compares against a stored frame which already lacks the track and emits
 * no delete op at all.
 *
 * A failed request never removes the polygon locally — doing so would leave the
 * editor one save away from the very propagation the user declined.
 */
export const useDeleteTrackScope = ({
  projectType,
  videoId,
  imageId,
  getPolygons,
  removeLocally,
  onServerMutation,
}: UseDeleteTrackScopeParams): DeleteTrackScopeHandlers => {
  const { t } = useLanguage();
  /** The microtubules the open dialog is asking about, pinned at request
   *  time. One for the scope-less single gestures, several for a scribble. */
  const [pending, setPending] = useState<PendingTarget[] | null>(null);
  // The dialog's buttons fire after render, so read the pending target through a
  // ref rather than re-creating the handlers whenever it changes.
  const pendingRef = useRef<typeof pending>(null);
  pendingRef.current = pending;

  /**
   * The trackId of `polygonId` when deleting it is cross-frame AMBIGUOUS: a
   * microtubule carrying a non-empty trackId. `null` means the delete has only
   * one possible meaning and the caller may just remove it locally.
   *
   * Deliberately NOT gated on `videoId`. The container is a separate React
   * Query fetch that can still be resolving on a cold deep-link into a frame
   * URL, and treating that window as "unambiguous" would local-delete a tracked
   * polyline — whose next save then purges the track from every sibling frame,
   * silently, which is the exact bug this hook exists to prevent. Missing ids
   * are handled where the request is made, by refusing rather than deleting.
   */
  const ambiguousTrackId = useCallback(
    (polygonId: string): string | null => {
      if (!isMicrotubuleProject(projectType)) {
        return null;
      }
      const trackId = getPolygons().find(p => p.id === polygonId)?.trackId;
      return typeof trackId === 'string' && trackId.length > 0 ? trackId : null;
    },
    [projectType, getPolygons]
  );

  /**
   * The id the track currently has on this frame. A WebSocket reload can
   * replace `editor.polygons` with freshly-id'd copies while the dialog is
   * open, so the id captured at request time may be stale — the trackId is not.
   */
  const currentIdForTrack = useCallback(
    (trackId: string, fallbackId: string): string =>
      getPolygons().find(p => p.trackId === trackId)?.id ?? fallbackId,
    [getPolygons]
  );

  // `quiet` is the bulk path: it reports the whole batch in one toast, so
  // neither the per-item success nor the per-item failure toast is raised.
  // Both return whether the delete went through.
  const runWholeTrackDelete = useCallback(
    async (polygonId: string, trackId: string, quiet = false) => {
      if (!videoId) {
        // Container not resolved yet. Refusing costs the user a retry; deleting
        // locally would cost them the track on every other frame.
        toast.error(t('segmentation.trackOps.deleteScopeUnavailable'));
        return false;
      }
      try {
        const result = await apiClient.deleteTrack(videoId, trackId);
        // Remove it from the current frame + hidden-set locally for instant
        // feedback; the backend already purged every sibling frame. Silent —
        // the scope-aware toast below is the one worth reading.
        removeLocally(currentIdForTrack(trackId, polygonId), { silent: true });
        onServerMutation();
        if (!quiet) {
          toast.success(
            t('segmentation.trackOps.deleteTrackSuccess', {
              count: result.framesAffected,
            })
          );
        }
        return true;
      } catch (error) {
        logger.error('Failed to delete microtubule track', error);
        if (!quiet) toast.error(t('segmentation.trackOps.deleteTrackFailed'));
        return false;
      }
    },
    [videoId, removeLocally, currentIdForTrack, onServerMutation, t]
  );

  const runFrameDelete = useCallback(
    async (polygonId: string, trackId: string, quiet = false) => {
      if (!imageId) {
        toast.error(t('segmentation.trackOps.deleteScopeUnavailable'));
        return false;
      }
      try {
        await apiClient.deleteTrackFromFrame(imageId, trackId);
        removeLocally(currentIdForTrack(trackId, polygonId), { silent: true });
        // This frame's stored polygons changed under the cache; a scrub away
        // and back would otherwise repaint the deleted microtubule.
        onServerMutation();
        if (!quiet)
          toast.success(t('segmentation.trackOps.deleteFrameSuccess'));
        return true;
      } catch (error) {
        logger.error(
          'Failed to delete microtubule from the current frame',
          error
        );
        if (!quiet) toast.error(t('segmentation.trackOps.deleteFrameFailed'));
        return false;
      }
    },
    [imageId, removeLocally, currentIdForTrack, onServerMutation, t]
  );

  const deleteWholeTrack = useCallback(
    async (polygonId: string) => {
      const trackId = ambiguousTrackId(polygonId);
      if (!trackId) {
        removeLocally(polygonId);
        return;
      }
      await runWholeTrackDelete(polygonId, trackId);
    },
    [ambiguousTrackId, removeLocally, runWholeTrackDelete]
  );

  const deleteFromCurrentFrame = useCallback(
    async (polygonId: string) => {
      const trackId = ambiguousTrackId(polygonId);
      if (!trackId) {
        removeLocally(polygonId);
        return;
      }
      await runFrameDelete(polygonId, trackId);
    },
    [ambiguousTrackId, removeLocally, runFrameDelete]
  );

  const requestDelete = useCallback(
    (polygonId: string): boolean => {
      const trackId = ambiguousTrackId(polygonId);
      if (!trackId) {
        return false;
      }
      if (!videoId || !imageId) {
        // Ambiguous but not yet answerable — say so instead of guessing.
        toast.error(t('segmentation.trackOps.deleteScopeUnavailable'));
        return true;
      }
      setPending([{ polygonId, trackId }]);
      return true;
    },
    [ambiguousTrackId, videoId, imageId, t]
  );

  const requestDeleteMany = useCallback(
    (polygonIds: string[]): string[] => {
      const tracked: PendingTarget[] = [];
      const unclaimed: string[] = [];
      for (const polygonId of polygonIds) {
        const trackId = ambiguousTrackId(polygonId);
        if (trackId) tracked.push({ polygonId, trackId });
        else unclaimed.push(polygonId);
      }
      if (tracked.length === 0) return unclaimed;
      if (!videoId || !imageId) {
        // Claimed, not deleted — same refusal as the single path.
        toast.error(t('segmentation.trackOps.deleteScopeUnavailable'));
        return unclaimed;
      }
      setPending(tracked);
      return unclaimed;
    },
    [ambiguousTrackId, videoId, imageId, t]
  );

  /**
   * Apply the chosen scope to every pending microtubule, one request at a
   * time. A single target keeps the single-delete toasts exactly; a batch is
   * reported once — a success naming the count, or "N of M" when some failed.
   */
  const runPending = useCallback(
    async (
      targets: PendingTarget[],
      run: (
        polygonId: string,
        trackId: string,
        quiet: boolean
      ) => Promise<boolean>,
      successKey: string
    ) => {
      if (targets.length === 1) {
        await run(targets[0].polygonId, targets[0].trackId, false);
        return;
      }
      let done = 0;
      for (const target of targets) {
        if (await run(target.polygonId, target.trackId, true)) done++;
      }
      if (done === targets.length) {
        toast.success(t(successKey, { count: done }));
      } else {
        toast.warning(
          t('segmentation.trackOps.deleteSelectedPartial', {
            done,
            total: targets.length,
          })
        );
      }
    },
    [t]
  );

  const onOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setPending(null);
    }
  }, []);

  const onDeleteFrame = useCallback(() => {
    const targets = pendingRef.current;
    setPending(null);
    if (targets) {
      void runPending(
        targets,
        runFrameDelete,
        'segmentation.trackOps.deleteManyFrameSuccess'
      );
    }
  }, [runPending, runFrameDelete]);

  const onDeleteTrack = useCallback(() => {
    const targets = pendingRef.current;
    setPending(null);
    if (targets) {
      void runPending(
        targets,
        runWholeTrackDelete,
        'segmentation.trackOps.deleteManyTrackSuccess'
      );
    }
  }, [runPending, runWholeTrackDelete]);

  const scopeDialog = useMemo(
    () => ({
      open: pending !== null,
      onOpenChange,
      onDeleteFrame,
      onDeleteTrack,
      count: pending?.length ?? 1,
    }),
    [pending, onOpenChange, onDeleteFrame, onDeleteTrack]
  );

  return {
    deleteWholeTrack,
    deleteFromCurrentFrame,
    requestDelete,
    requestDeleteMany,
    scopeDialog,
  };
};
