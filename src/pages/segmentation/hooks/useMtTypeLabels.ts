import { useCallback, useEffect, useMemo, useState } from 'react';
// Default import matches the app-wide convention (SegmentationEditor et al.);
// the named `{ apiClient }` import broke test mocks that only expose `default`.
import apiClient, { type MTTypeLabel } from '@/lib/api';
import { logger } from '@/lib/logger';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/useLanguage';

/** Short unique id for a new label. Prefers crypto.randomUUID (secure context),
 *  falls back to a timestamp+random string for older/non-secure runtimes. */
function newLabelId(): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '')
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `mt_type_${rand.slice(0, 8)}`;
}

export interface UseMtTypeLabelsResult {
  labels: MTTypeLabel[];
  labelById: Map<string, MTTypeLabel>;
  colorById: Map<string, string>;
  createLabel: (name: string, color: string) => Promise<MTTypeLabel | null>;
  renameLabel: (id: string, name: string, color: string) => Promise<void>;
  deleteLabel: (id: string) => Promise<void>;
}

/**
 * Loads + mutates a microtubule project's type-label palette. `enabled` gates
 * the fetch to microtubule projects so other project types never request it.
 * The palette is the SSOT for label name + colour; polylines reference labels
 * by id via their `mtType`.
 */
export function useMtTypeLabels(
  projectId: string | undefined,
  enabled: boolean
): UseMtTypeLabelsResult {
  const { t } = useLanguage();
  const [labels, setLabels] = useState<MTTypeLabel[]>([]);

  useEffect(() => {
    if (!enabled || !projectId) return;
    let alive = true;
    apiClient
      .getMtTypeLabels(projectId)
      .then(l => {
        if (alive) setLabels(l);
      })
      .catch(err => {
        logger.error('Failed to load MT type labels', err as Error);
        // Surface the failure — otherwise the panel shows an empty label list
        // for a project that HAS labels, and typed MTs render neutral, which
        // reads as "labels were wiped".
        if (alive) toast.error(t('microtubule.type.loadFailed'));
      });
    return () => {
      alive = false;
    };
  }, [projectId, enabled, t]);

  const colorById = useMemo(
    () => new Map(labels.map(l => [l.id, l.color])),
    [labels]
  );
  const labelById = useMemo(
    () => new Map(labels.map(l => [l.id, l])),
    [labels]
  );

  const persist = useCallback(
    async (next: MTTypeLabel[]) => {
      if (!projectId) return;
      const saved = await apiClient.putMtTypeLabels(projectId, next);
      setLabels(saved);
    },
    [projectId]
  );

  const createLabel = useCallback(
    async (name: string, color: string): Promise<MTTypeLabel | null> => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      // Reuse an existing label with the same (case-insensitive) name instead
      // of creating a duplicate the server would dedupe away anyway.
      const existing = labels.find(
        l => l.name.toLowerCase() === trimmed.toLowerCase()
      );
      if (existing) return existing;
      const label: MTTypeLabel = { id: newLabelId(), name: trimmed, color };
      try {
        await persist([...labels, label]);
        return label;
      } catch (err) {
        logger.error('Failed to create MT type label', err as Error);
        toast.error(t('microtubule.type.createFailed'));
        return null;
      }
    },
    [labels, persist, t]
  );

  const renameLabel = useCallback(
    async (id: string, name: string, color: string) => {
      const trimmed = name.trim();
      // Guard against renaming onto ANOTHER label's name: the server dedupes by
      // case-insensitive name (first wins), which would silently drop this label
      // and dangle every MT pointing at its id.
      const clash = labels.some(
        l => l.id !== id && l.name.toLowerCase() === trimmed.toLowerCase()
      );
      if (clash) {
        toast.error(t('microtubule.type.duplicateName'));
        return;
      }
      try {
        await persist(
          labels.map(l => (l.id === id ? { ...l, name: trimmed, color } : l))
        );
      } catch (err) {
        logger.error('Failed to rename MT type label', err as Error);
        toast.error(t('microtubule.type.renameFailed'));
      }
    },
    [labels, persist, t]
  );

  const deleteLabel = useCallback(
    async (id: string) => {
      if (!projectId) return;
      try {
        const saved = await apiClient.deleteMtTypeLabel(projectId, id);
        setLabels(saved);
      } catch (err) {
        logger.error('Failed to delete MT type label', err as Error);
        toast.error(t('microtubule.type.deleteFailed'));
      }
    },
    [projectId, t]
  );

  return {
    labels,
    labelById,
    colorById,
    createLabel,
    renameLabel,
    deleteLabel,
  };
}
