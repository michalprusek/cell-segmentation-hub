import { useCallback, useEffect, useMemo, useState } from 'react';
// Default import matches the app-wide convention (SegmentationEditor et al.);
// the named `{ apiClient }` import broke test mocks that only expose `default`.
import apiClient, { type MTTypeLabel } from '@/lib/api';
import { logger } from '@/lib/logger';

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
  const [labels, setLabels] = useState<MTTypeLabel[]>([]);

  useEffect(() => {
    if (!enabled || !projectId) return;
    let alive = true;
    apiClient
      .getMtTypeLabels(projectId)
      .then(l => {
        if (alive) setLabels(l);
      })
      .catch(err =>
        logger.error('Failed to load MT type labels', err as Error)
      );
    return () => {
      alive = false;
    };
  }, [projectId, enabled]);

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
      await persist([...labels, label]);
      return label;
    },
    [labels, persist]
  );

  const renameLabel = useCallback(
    async (id: string, name: string, color: string) => {
      await persist(
        labels.map(l => (l.id === id ? { ...l, name: name.trim(), color } : l))
      );
    },
    [labels, persist]
  );

  const deleteLabel = useCallback(
    async (id: string) => {
      if (!projectId) return;
      const saved = await apiClient.deleteMtTypeLabel(projectId, id);
      setLabels(saved);
    },
    [projectId]
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
