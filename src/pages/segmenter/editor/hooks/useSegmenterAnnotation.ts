import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import segmenterApi, { type SegmenterPolygon } from '@/lib/segmenterApi';
import { logger } from '@/lib/logger';

export interface UseSegmenterAnnotationResult {
  /** Polygons loaded from the backend for this image (empty until loaded,
   *  or if the image has no saved annotation yet). */
  initialPolygons: SegmenterPolygon[];
  initialImageWidth: number;
  initialImageHeight: number;
  loading: boolean;
  saving: boolean;
  loadError: string | null;
  save: (
    polygons: SegmenterPolygon[],
    imageWidth: number,
    imageHeight: number
  ) => Promise<boolean>;
}

/**
 * Loads (`GET .../annotations`) and saves (`PUT .../annotations`) one
 * image's polygon annotation. Kept deliberately dumb — it owns only the
 * network I/O; `useEditorState` owns the live, editable polygon state
 * (undo/redo, selection, drawing) and is seeded from this hook's
 * `initialPolygons` once they arrive.
 */
export function useSegmenterAnnotation(
  imageId: string | undefined
): UseSegmenterAnnotationResult {
  const [initialPolygons, setInitialPolygons] = useState<SegmenterPolygon[]>(
    []
  );
  const [initialImageWidth, setInitialImageWidth] = useState(0);
  const [initialImageHeight, setInitialImageHeight] = useState(0);
  const [loading, setLoading] = useState<boolean>(!!imageId);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!imageId) return undefined;
    let alive = true;
    // Reset immediately on imageId change so a slow in-flight fetch for the
    // PREVIOUS image can never be mistaken for this image's data, and so a
    // navigation between images never flashes stale polygons over the new
    // picture while the new fetch is in flight.
    setLoading(true);
    setLoadError(null);
    setInitialPolygons([]);
    setInitialImageWidth(0);
    setInitialImageHeight(0);

    segmenterApi
      .getAnnotations(imageId)
      .then(data => {
        if (!alive) return;
        if (data) {
          setInitialPolygons(data.polygons);
          setInitialImageWidth(data.imageWidth);
          setInitialImageHeight(data.imageHeight);
        }
      })
      .catch(err => {
        logger.error('Failed to load segmenter annotation', err as Error);
        if (alive) setLoadError('Failed to load annotation');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [imageId]);

  const save = useCallback(
    async (
      polygons: SegmenterPolygon[],
      imageWidth: number,
      imageHeight: number
    ): Promise<boolean> => {
      if (!imageId) return false;
      setSaving(true);
      try {
        await segmenterApi.putAnnotations(imageId, {
          polygons,
          imageWidth,
          imageHeight,
        });
        return true;
      } catch (err) {
        logger.error('Failed to save segmenter annotation', err as Error);
        toast.error('Failed to save annotation');
        return false;
      } finally {
        setSaving(false);
      }
    },
    [imageId]
  );

  return {
    initialPolygons,
    initialImageWidth,
    initialImageHeight,
    loading,
    saving,
    loadError,
    save,
  };
}
