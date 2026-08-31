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
   * Delete key, delete-mode clicks, the sidebar trash). Returns `true` when the
   * polygon is a tracked microtubule and the scope dialog was opened — the
   * caller must then NOT delete anything itself. Returns `false` for everything
   * else, meaning "you handle it".
   */
  requestDelete: (polygonId: string) => boolean;
  /** Props for the editor-level {@link DeleteTrackScopeDialog}. */
  scopeDialog: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDeleteFrame: () => void;
    onDeleteTrack: () => void;
  };
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
  /** The microtubule the open dialog is asking about, pinned at request time. */
  const [pending, setPending] = useState<{
    polygonId: string;
    trackId: string;
  } | null>(null);
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

  const runWholeTrackDelete = useCallback(
    async (polygonId: string, trackId: string) => {
      if (!videoId) {
        // Container not resolved yet. Refusing costs the user a retry; deleting
        // locally would cost them the track on every other frame.
        toast.error(t('segmentation.trackOps.deleteScopeUnavailable'));
        return;
      }
      try {
        const result = await apiClient.deleteTrack(videoId, trackId);
        // Remove it from the current frame + hidden-set locally for instant
        // feedback; the backend already purged every sibling frame. Silent —
        // the scope-aware toast below is the one worth reading.
        removeLocally(currentIdForTrack(trackId, polygonId), { silent: true });
        onServerMutation();
        toast.success(
          t('segmentation.trackOps.deleteTrackSuccess', {
            count: result.framesAffected,
          })
        );
      } catch (error) {
        logger.error('Failed to delete microtubule track', error);
        toast.error(t('segmentation.trackOps.deleteTrackFailed'));
      }
    },
    [videoId, removeLocally, currentIdForTrack, onServerMutation, t]
  );

  const runFrameDelete = useCallback(
    async (polygonId: string, trackId: string) => {
      if (!imageId) {
        toast.error(t('segmentation.trackOps.deleteScopeUnavailable'));
        return;
      }
      try {
        await apiClient.deleteTrackFromFrame(imageId, trackId);
        removeLocally(currentIdForTrack(trackId, polygonId), { silent: true });
        // This frame's stored polygons changed under the cache; a scrub away
        // and back would otherwise repaint the deleted microtubule.
        onServerMutation();
        toast.success(t('segmentation.trackOps.deleteFrameSuccess'));
      } catch (error) {
        logger.error(
          'Failed to delete microtubule from the current frame',
          error
        );
        toast.error(t('segmentation.trackOps.deleteFrameFailed'));
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
      setPending({ polygonId, trackId });
      return true;
    },
    [ambiguousTrackId, videoId, imageId, t]
  );

  const onOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setPending(null);
    }
  }, []);

  const onDeleteFrame = useCallback(() => {
    const target = pendingRef.current;
    setPending(null);
    if (target) {
      void runFrameDelete(target.polygonId, target.trackId);
    }
  }, [runFrameDelete]);

  const onDeleteTrack = useCallback(() => {
    const target = pendingRef.current;
    setPending(null);
    if (target) {
      void runWholeTrackDelete(target.polygonId, target.trackId);
    }
  }, [runWholeTrackDelete]);

  const scopeDialog = useMemo(
    () => ({
      open: pending !== null,
      onOpenChange,
      onDeleteFrame,
      onDeleteTrack,
    }),
    [pending, onOpenChange, onDeleteFrame, onDeleteTrack]
  );

  return {
    deleteWholeTrack,
    deleteFromCurrentFrame,
    requestDelete,
    scopeDialog,
  };
};
