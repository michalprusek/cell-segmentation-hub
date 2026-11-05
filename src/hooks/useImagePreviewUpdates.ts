import { useEffect, useLayoutEffect, useRef } from 'react';
import { useWebSocket } from '@/contexts/useWebSocket';
import WebSocketManager from '@/services/webSocketManager';

export interface PreviewChange {
  imageId: string;
  previewUrl: string;
}

/**
 * Live preview URLs for an open project page. The server sends
 * `imagePreviewsUpdated` to the project room after ANY change to what a
 * preview draws — an ML result, an editor save, a deleted segmentation, a
 * cross-frame track edit — so a card follows edits made in another tab or
 * by a collaborator without a reload.
 *
 * Not the only path: the listing always carries the current URL, so a
 * reload or a re-list after a missed message converges anyway.
 */
export function useImagePreviewUpdates(
  projectId: string | undefined,
  onPreviews: (previews: PreviewChange[]) => void
): void {
  const { manager: contextManager } = useWebSocket();
  // The latest callback without re-subscribing when its identity changes.
  // Synced in a layout effect, not during render: React documents a
  // render-phase ref write as unsupported.
  const onPreviewsRef = useRef(onPreviews);
  useLayoutEffect(() => {
    onPreviewsRef.current = onPreviews;
  }, [onPreviews]);

  useEffect(() => {
    if (!projectId) return;
    const manager = contextManager || WebSocketManager.getInstance();
    const listener = (data: unknown) => {
      const message = data as { projectId: string; previews: PreviewChange[] };
      if (message.projectId !== projectId) return;
      onPreviewsRef.current(
        message.previews.filter(
          p =>
            typeof p?.imageId === 'string' && typeof p?.previewUrl === 'string'
        )
      );
    };
    manager.on('image-previews-updated', listener);
    return () => manager.off('image-previews-updated', listener);
  }, [projectId, contextManager]);
}
