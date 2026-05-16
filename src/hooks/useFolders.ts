import { useMemo } from 'react';
import {
  useQuery,
  useMutation,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import { toast } from 'sonner';
import apiClient from '@/lib/api';
import { logger } from '@/lib/logger';
import type { ProjectFolder } from '@/types';

const FOLDERS_KEY: QueryKey = ['folders'];

export interface FolderNode extends ProjectFolder {
  /** Direct children, sorted by name. Empty array for leaf folders. */
  children: FolderNode[];
}

/**
 * Builds a tree of FolderNodes from the flat list returned by the API.
 *
 * The flat shape (id + parentId) is what the wire format ships; building the
 * tree is a pure function so it lives in a memo and re-runs only when the
 * underlying array reference changes. Orphans (parentId pointing at a deleted
 * folder we somehow have in cache) get re-parented to root rather than dropped,
 * so the user never loses sight of their data.
 */
function buildTree(flat: ProjectFolder[]): FolderNode[] {
  const byId = new Map<string, FolderNode>();
  for (const f of flat) {
    byId.set(f.id, { ...f, children: [] });
  }
  const roots: FolderNode[] = [];
  for (const node of Array.from(byId.values())) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortByName = (a: FolderNode, b: FolderNode) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  const sortRec = (nodes: FolderNode[]) => {
    nodes.sort(sortByName);
    for (const n of nodes) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}

/** Flat list query + memoised tree derivation. */
export function useFolders() {
  const query = useQuery({
    queryKey: FOLDERS_KEY,
    queryFn: () => apiClient.getFolders(),
    staleTime: 60_000,
  });
  const tree = useMemo(
    () => (query.data ? buildTree(query.data) : []),
    [query.data]
  );
  const byId = useMemo(() => {
    const map = new Map<string, ProjectFolder>();
    for (const f of query.data ?? []) map.set(f.id, f);
    return map;
  }, [query.data]);
  return { ...query, tree, byId };
}

/**
 * Returns the breadcrumb chain from root → folderId, inclusive.
 * Empty array when folderId is null (at root). Each entry is a `ProjectFolder`
 * so callers can render with `name` and link with `id`.
 */
export function useFolderPath(
  folderId: string | null,
  byId: Map<string, ProjectFolder>
): ProjectFolder[] {
  return useMemo(() => {
    if (!folderId) return [];
    const path: ProjectFolder[] = [];
    let cursor: string | null | undefined = folderId;
    const seen = new Set<string>(); // defensive: stop on accidental cycle
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const node = byId.get(cursor);
      if (!node) break;
      path.unshift(node);
      cursor = node.parentId;
    }
    return path;
  }, [folderId, byId]);
}

// ----- Mutations -----------------------------------------------------------
//
// All folder mutations invalidate ['folders'] AND any cached project list,
// because moving a folder/project changes both. The `projects` invalidation
// is a prefix wildcard — useDashboardProjects manages its own state, so the
// invalidation is mostly useful for future React-Query-based callers.

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  // Notify the (non-React-Query) useDashboardProjects state manager that
  // its in-memory project list is stale and a refetch is needed. The
  // listener lives in useDashboardProjects.ts and was originally wired
  // for failed mutations; we reuse it as the universal post-move signal
  // so the dashboard refreshes immediately after any folder operation,
  // without forcing the user to hit F5.
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('project-refetch-needed'));
  }
  return Promise.all([
    qc.invalidateQueries({ queryKey: FOLDERS_KEY }),
    qc.invalidateQueries({ queryKey: ['projects'] }),
  ]);
}

export function useCreateFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { name: string; parentId?: string | null }) =>
      apiClient.createFolder(vars),
    onMutate: async vars => {
      await qc.cancelQueries({ queryKey: FOLDERS_KEY });
      const previous = qc.getQueryData<ProjectFolder[]>(FOLDERS_KEY);
      // Optimistic insert with a temporary id; the real id replaces it on
      // settlement when the server response arrives. Using a "tmp-" prefix
      // makes it trivial to identify and skip in any later code that
      // distinguishes server-persisted folders.
      const optimistic: ProjectFolder = {
        id: `tmp-${Date.now()}`,
        name: vars.name,
        parentId: vars.parentId ?? null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      qc.setQueryData<ProjectFolder[]>(FOLDERS_KEY, [
        ...(previous ?? []),
        optimistic,
      ]);
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(FOLDERS_KEY, ctx.previous);
      logger.error('Failed to create folder', err);
      toast.error((err as Error).message ?? 'Failed to create folder');
    },
    onSettled: () => invalidateAll(qc),
  });
}

export function useRenameFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; name: string }) =>
      apiClient.updateFolder(vars.id, { name: vars.name }),
    onMutate: async vars => {
      await qc.cancelQueries({ queryKey: FOLDERS_KEY });
      const previous = qc.getQueryData<ProjectFolder[]>(FOLDERS_KEY);
      if (previous) {
        qc.setQueryData<ProjectFolder[]>(
          FOLDERS_KEY,
          previous.map(f => (f.id === vars.id ? { ...f, name: vars.name } : f))
        );
      }
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(FOLDERS_KEY, ctx.previous);
      logger.error('Failed to rename folder', err);
      toast.error((err as Error).message ?? 'Failed to rename folder');
    },
    onSettled: () => invalidateAll(qc),
  });
}

export function useMoveFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; parentId: string | null }) =>
      apiClient.updateFolder(vars.id, { parentId: vars.parentId }),
    onMutate: async vars => {
      await qc.cancelQueries({ queryKey: FOLDERS_KEY });
      const previous = qc.getQueryData<ProjectFolder[]>(FOLDERS_KEY);
      if (previous) {
        qc.setQueryData<ProjectFolder[]>(
          FOLDERS_KEY,
          previous.map(f =>
            f.id === vars.id ? { ...f, parentId: vars.parentId } : f
          )
        );
      }
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(FOLDERS_KEY, ctx.previous);
      logger.error('Failed to move folder', err);
      toast.error((err as Error).message ?? 'Failed to move folder');
    },
    onSettled: () => invalidateAll(qc),
  });
}

export function useDeleteFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.deleteFolder(id),
    // No optimistic removal — the cascade may affect many projects; we'd
    // rather wait for the server's verdict than show partial UI. Errors
    // here are user-facing (cycle, permission), not "stale optimistic state".
    onError: err => {
      logger.error('Failed to delete folder', err);
      toast.error((err as Error).message ?? 'Failed to delete folder');
    },
    onSettled: () => invalidateAll(qc),
  });
}

export function useMoveProjects() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { folderId: string | null; projectIds: string[] }) =>
      apiClient.moveProjectsToFolder(vars.folderId, vars.projectIds),
    onError: err => {
      logger.error('Failed to move projects', err);
      toast.error((err as Error).message ?? 'Failed to move projects');
    },
    onSettled: () => invalidateAll(qc),
  });
}

/** Pre-flight count of folder contents for the delete-confirmation dialog. */
export function useFolderPreview(folderId: string | null) {
  return useQuery({
    queryKey: ['folder-preview', folderId],
    queryFn: () =>
      folderId ? apiClient.previewFolder(folderId) : Promise.resolve(null),
    enabled: !!folderId,
    staleTime: 5_000,
  });
}
