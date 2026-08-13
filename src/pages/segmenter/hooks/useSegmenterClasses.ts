import { useCallback, useEffect, useMemo, useState } from 'react';
import segmenterApi, { type SegmenterClass } from '@/lib/segmenterApi';
import { logger } from '@/lib/logger';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/exports';

/**
 * Generic fork of `useMtTypeLabels` (`@/pages/segmentation/hooks/useMtTypeLabels.ts`)
 * for the `/segmenter` module's per-dataset class registry. Same public shape
 * (`{id,name,color}`, "every mutation returns the whole current list") but
 * backed by real per-row REST verbs (`POST`/`PUT`/`DELETE .../classes[/:id]`)
 * rather than a whole-list PUT — the segmenter class table is a real Prisma
 * model, not a JSON blob column like the MT type-label palette. Not tied to
 * microtubules — any dataset can define arbitrary classes.
 */

export interface UseSegmenterClassesResult {
  classes: SegmenterClass[];
  loading: boolean;
  classById: Map<string, SegmenterClass>;
  colorById: Map<string, string>;
  createClass: (name: string, color: string) => Promise<SegmenterClass | null>;
  renameClass: (id: string, name: string, color: string) => Promise<void>;
  deleteClass: (id: string) => Promise<void>;
}

/**
 * Loads + mutates a segmenter dataset's class palette. The palette is the
 * SSOT for class name + colour; polygons reference a class by id via
 * `classId`.
 */
export function useSegmenterClasses(
  datasetId: string | undefined
): UseSegmenterClassesResult {
  const { t } = useLanguage();
  const [classes, setClasses] = useState<SegmenterClass[]>([]);
  const [loading, setLoading] = useState<boolean>(!!datasetId);

  useEffect(() => {
    if (!datasetId) return;
    let alive = true;
    setLoading(true);
    segmenterApi
      .getClasses(datasetId)
      .then(c => {
        if (alive) setClasses(c);
      })
      .catch(err => {
        logger.error('Failed to load segmenter classes', err as Error);
        if (alive) toast.error(t('segmenter.classes.loadFailed') as string);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [datasetId, t]);

  const colorById = useMemo(
    () => new Map(classes.map(c => [c.id, c.color])),
    [classes]
  );
  const classById = useMemo(
    () => new Map(classes.map(c => [c.id, c])),
    [classes]
  );

  const createClass = useCallback(
    async (name: string, color: string): Promise<SegmenterClass | null> => {
      const trimmed = name.trim();
      if (!trimmed || !datasetId) return null;
      // Reuse an existing class with the same (case-insensitive) name
      // instead of creating a duplicate — unlike the MT type-label palette,
      // the backend does NOT dedupe by name server-side (it's a real table,
      // every POST inserts a new row).
      const existing = classes.find(
        c => c.name.toLowerCase() === trimmed.toLowerCase()
      );
      if (existing) return existing;
      try {
        const prevIds = new Set(classes.map(c => c.id));
        const updated = await segmenterApi.createClass(
          datasetId,
          trimmed,
          color
        );
        setClasses(updated);
        // The server assigns the id; the newly-inserted row is whichever one
        // wasn't in our previous snapshot (falls back to the last entry —
        // classes are returned ordered by `createdAt asc`).
        return (
          updated.find(c => !prevIds.has(c.id)) ??
          updated[updated.length - 1] ??
          null
        );
      } catch (err) {
        logger.error('Failed to create segmenter class', err as Error);
        toast.error(t('segmenter.classes.createFailed') as string);
        return null;
      }
    },
    [classes, datasetId, t]
  );

  const renameClass = useCallback(
    async (id: string, name: string, color: string) => {
      if (!datasetId) return;
      const trimmed = name.trim();
      // Guard against renaming onto ANOTHER class's name — purely a client-
      // side UX nicety (the backend allows duplicate names since classes
      // are identified by id, not name).
      const clash = classes.some(
        c => c.id !== id && c.name.toLowerCase() === trimmed.toLowerCase()
      );
      if (clash) {
        toast.error(t('segmenter.classes.nameClash') as string);
        return;
      }
      try {
        const updated = await segmenterApi.updateClass(datasetId, id, {
          name: trimmed,
          color,
        });
        setClasses(updated);
      } catch (err) {
        logger.error('Failed to rename segmenter class', err as Error);
        toast.error(t('segmenter.classes.renameFailed') as string);
      }
    },
    [classes, datasetId, t]
  );

  const deleteClass = useCallback(
    async (id: string) => {
      if (!datasetId) return;
      try {
        const result = await segmenterApi.deleteClass(datasetId, id);
        setClasses(result.classes);
      } catch (err) {
        logger.error('Failed to delete segmenter class', err as Error);
        toast.error(t('segmenter.classes.deleteFailed') as string);
      }
    },
    [datasetId, t]
  );

  return {
    classes,
    loading,
    classById,
    colorById,
    createClass,
    renameClass,
    deleteClass,
  };
}
