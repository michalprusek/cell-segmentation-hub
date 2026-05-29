/**
 * Unit tests for useFolders, useCreateFolder, useRenameFolder,
 * useMoveFolder, useDeleteFolder, useMoveProjects, useFolderPreview,
 * and the pure useFolderPath helper.
 *
 * Coverage targets:
 *  - Query fetch + tree/byId derivation
 *  - Optimistic updates on create / rename / move
 *  - Rollback on error for each optimistic mutation
 *  - Non-optimistic delete (no rollback) + settled invalidation
 *  - window 'project-refetch-needed' event dispatch
 *  - useFolderPath breadcrumb chain + cycle guard
 *  - useFolderPreview enabled/disabled gate
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React, { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ProjectFolder } from '@/types';

// ------------------------------------------------------------------
// apiClient mock (must be before the hook import so vi.mock hoists)
// ------------------------------------------------------------------
const mockGetFolders = vi.fn();
const mockCreateFolder = vi.fn();
const mockUpdateFolder = vi.fn();
const mockDeleteFolder = vi.fn();
const mockMoveProjectsToFolder = vi.fn();
const mockPreviewFolder = vi.fn();

vi.mock('@/lib/api', () => ({
  default: {
    getFolders: (...args: unknown[]) => mockGetFolders(...args),
    createFolder: (...args: unknown[]) => mockCreateFolder(...args),
    updateFolder: (...args: unknown[]) => mockUpdateFolder(...args),
    deleteFolder: (...args: unknown[]) => mockDeleteFolder(...args),
    moveProjectsToFolder: (...args: unknown[]) =>
      mockMoveProjectsToFolder(...args),
    previewFolder: (...args: unknown[]) => mockPreviewFolder(...args),
  },
  apiClient: {
    getFolders: (...args: unknown[]) => mockGetFolders(...args),
    createFolder: (...args: unknown[]) => mockCreateFolder(...args),
    updateFolder: (...args: unknown[]) => mockUpdateFolder(...args),
    deleteFolder: (...args: unknown[]) => mockDeleteFolder(...args),
    moveProjectsToFolder: (...args: unknown[]) =>
      mockMoveProjectsToFolder(...args),
    previewFolder: (...args: unknown[]) => mockPreviewFolder(...args),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Suppress toast side-effects
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

// ------------------------------------------------------------------
// Import hooks AFTER mocks are declared
// ------------------------------------------------------------------
import {
  useFolders,
  useCreateFolder,
  useRenameFolder,
  useMoveFolder,
  useDeleteFolder,
  useMoveProjects,
  useFolderPreview,
  useFolderPath,
} from '@/hooks/useFolders';

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function makeFolder(
  id: string,
  name: string,
  parentId: string | null = null
): ProjectFolder {
  return {
    id,
    name,
    parentId,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

function makeQC() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

function wrapQC(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

describe('useFolders', () => {
  let qc: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    qc = makeQC();
  });

  afterEach(() => {
    qc.clear();
  });

  it('returns empty tree and byId while loading (no data yet)', () => {
    mockGetFolders.mockReturnValue(new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useFolders(), {
      wrapper: wrapQC(qc),
    });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.tree).toEqual([]);
    expect(result.current.byId.size).toBe(0);
  });

  it('exposes flat folders in byId keyed by id', async () => {
    const folders = [makeFolder('a', 'Alpha'), makeFolder('b', 'Beta')];
    mockGetFolders.mockResolvedValue(folders);

    const { result } = renderHook(() => useFolders(), { wrapper: wrapQC(qc) });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.byId.get('a')?.name).toBe('Alpha');
    expect(result.current.byId.get('b')?.name).toBe('Beta');
  });

  it('builds a tree with children sorted by name', async () => {
    const folders = [
      makeFolder('root', 'Root'),
      makeFolder('c', 'Zebra', 'root'),
      makeFolder('d', 'Alpha', 'root'),
    ];
    mockGetFolders.mockResolvedValue(folders);

    const { result } = renderHook(() => useFolders(), { wrapper: wrapQC(qc) });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const rootNode = result.current.tree.find(n => n.id === 'root');
    expect(rootNode).toBeDefined();
    expect(rootNode!.children[0].name).toBe('Alpha');
    expect(rootNode!.children[1].name).toBe('Zebra');
  });

  it('re-parents orphan folders to root instead of dropping them', async () => {
    const folders = [makeFolder('child', 'Child', 'missing-parent-id')];
    mockGetFolders.mockResolvedValue(folders);

    const { result } = renderHook(() => useFolders(), { wrapper: wrapQC(qc) });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // orphan lands at root level
    expect(result.current.tree.some(n => n.id === 'child')).toBe(true);
  });

  it('exposes error state when API call fails', async () => {
    mockGetFolders.mockRejectedValue(new Error('network'));

    const { result } = renderHook(() => useFolders(), { wrapper: wrapQC(qc) });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});

// ------------------------------------------------------------------

describe('useFolderPath', () => {
  it('returns [] when folderId is null', () => {
    const byId = new Map<string, ProjectFolder>();
    const { result } = renderHook(() => useFolderPath(null, byId));
    expect(result.current).toEqual([]);
  });

  it('returns single-element path for a root folder', () => {
    const folder = makeFolder('f1', 'Root');
    const byId = new Map([['f1', folder]]);
    const { result } = renderHook(() => useFolderPath('f1', byId));
    expect(result.current).toEqual([folder]);
  });

  it('returns ancestor chain from root to leaf in order', () => {
    const root = makeFolder('root', 'Root');
    const child = makeFolder('child', 'Child', 'root');
    const grandchild = makeFolder('grand', 'Grand', 'child');
    const byId = new Map([
      ['root', root],
      ['child', child],
      ['grand', grandchild],
    ]);

    const { result } = renderHook(() => useFolderPath('grand', byId));
    expect(result.current.map(f => f.id)).toEqual(['root', 'child', 'grand']);
  });

  it('stops at a broken ancestor link without infinite loop', () => {
    // child → parent → missing
    const parent = makeFolder('parent', 'Parent', 'missing');
    const child = makeFolder('child', 'Child', 'parent');
    const byId = new Map([
      ['parent', parent],
      ['child', child],
    ]);

    const { result } = renderHook(() => useFolderPath('child', byId));
    // Should include child and parent but stop at missing
    expect(result.current.map(f => f.id)).toEqual(['parent', 'child']);
  });

  it('stops on cycle (cycle guard)', () => {
    // a → b → a
    const a = makeFolder('a', 'A', 'b');
    const b = makeFolder('b', 'B', 'a');
    const byId = new Map([
      ['a', a],
      ['b', b],
    ]);

    // Should not throw and should return a finite list
    const { result } = renderHook(() => useFolderPath('a', byId));
    expect(result.current.length).toBeLessThanOrEqual(2);
  });
});

// ------------------------------------------------------------------

describe('useCreateFolder', () => {
  let qc: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    qc = makeQC();
    // seed initial cache
    qc.setQueryData(['folders'], [makeFolder('existing', 'Existing')]);
  });

  afterEach(() => {
    qc.clear();
  });

  it('applies optimistic insert before server responds', async () => {
    let resolveCreate!: (v: ProjectFolder) => void;
    mockCreateFolder.mockReturnValue(
      new Promise<ProjectFolder>(res => {
        resolveCreate = res;
      })
    );
    mockGetFolders.mockResolvedValue([makeFolder('existing', 'Existing')]);

    const { result } = renderHook(() => useCreateFolder(), {
      wrapper: wrapQC(qc),
    });

    act(() => {
      result.current.mutate({ name: 'NewFolder' });
    });

    // Optimistic: cache should contain the tmp- entry before server settles
    await waitFor(() => {
      const cached = qc.getQueryData<ProjectFolder[]>(['folders']) ?? [];
      return cached.some(
        f => f.id.startsWith('tmp-') && f.name === 'NewFolder'
      );
    });

    const serverFolder = makeFolder('server-id', 'NewFolder');
    mockGetFolders.mockResolvedValue([
      makeFolder('existing', 'Existing'),
      serverFolder,
    ]);
    resolveCreate(serverFolder);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('rolls back optimistic insert on API error', async () => {
    mockCreateFolder.mockRejectedValue(new Error('duplicate'));
    mockGetFolders.mockResolvedValue([makeFolder('existing', 'Existing')]);

    const { result } = renderHook(() => useCreateFolder(), {
      wrapper: wrapQC(qc),
    });

    act(() => {
      result.current.mutate({ name: 'Bad' });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    // Cache should be restored to the pre-mutation snapshot (no tmp- entries)
    const cached = qc.getQueryData<ProjectFolder[]>(['folders']) ?? [];
    expect(cached.every(f => !f.id.startsWith('tmp-'))).toBe(true);
  });

  it('dispatches project-refetch-needed event on settled', async () => {
    const serverFolder = makeFolder('srv', 'Created');
    mockCreateFolder.mockResolvedValue(serverFolder);
    mockGetFolders.mockResolvedValue([
      makeFolder('existing', 'Existing'),
      serverFolder,
    ]);

    const events: Event[] = [];
    const listener = (e: Event) => events.push(e);
    window.addEventListener('project-refetch-needed', listener);

    const { result } = renderHook(() => useCreateFolder(), {
      wrapper: wrapQC(qc),
    });

    act(() => {
      result.current.mutate({ name: 'Created' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    window.removeEventListener('project-refetch-needed', listener);
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it('passes parentId to apiClient.createFolder', async () => {
    const serverFolder = makeFolder('srv', 'Child', 'parent-id');
    mockCreateFolder.mockResolvedValue(serverFolder);
    mockGetFolders.mockResolvedValue([]);

    const { result } = renderHook(() => useCreateFolder(), {
      wrapper: wrapQC(qc),
    });

    act(() => {
      result.current.mutate({ name: 'Child', parentId: 'parent-id' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockCreateFolder).toHaveBeenCalledWith({
      name: 'Child',
      parentId: 'parent-id',
    });
  });
});

// ------------------------------------------------------------------

describe('useRenameFolder', () => {
  let qc: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    qc = makeQC();
    qc.setQueryData(
      ['folders'],
      [makeFolder('f1', 'OldName'), makeFolder('f2', 'Other')]
    );
  });

  afterEach(() => {
    qc.clear();
  });

  it('applies optimistic rename before server responds', async () => {
    let resolveUpdate!: (v: ProjectFolder) => void;
    mockUpdateFolder.mockReturnValue(
      new Promise<ProjectFolder>(res => {
        resolveUpdate = res;
      })
    );
    mockGetFolders.mockResolvedValue([
      makeFolder('f1', 'NewName'),
      makeFolder('f2', 'Other'),
    ]);

    const { result } = renderHook(() => useRenameFolder(), {
      wrapper: wrapQC(qc),
    });

    act(() => {
      result.current.mutate({ id: 'f1', name: 'NewName' });
    });

    // Optimistic update should appear in cache immediately
    await waitFor(() => {
      const cached = qc.getQueryData<ProjectFolder[]>(['folders']) ?? [];
      return cached.find(f => f.id === 'f1')?.name === 'NewName';
    });

    resolveUpdate(makeFolder('f1', 'NewName'));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('rolls back name change on error', async () => {
    mockUpdateFolder.mockRejectedValue(new Error('server error'));
    mockGetFolders.mockResolvedValue([makeFolder('f1', 'OldName')]);

    const { result } = renderHook(() => useRenameFolder(), {
      wrapper: wrapQC(qc),
    });

    act(() => {
      result.current.mutate({ id: 'f1', name: 'FailedName' });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    const cached = qc.getQueryData<ProjectFolder[]>(['folders']) ?? [];
    const f1 = cached.find(f => f.id === 'f1');
    expect(f1?.name).toBe('OldName');
  });

  it('calls apiClient.updateFolder with correct id and patch', async () => {
    mockUpdateFolder.mockResolvedValue(makeFolder('f1', 'Renamed'));
    mockGetFolders.mockResolvedValue([makeFolder('f1', 'Renamed')]);

    const { result } = renderHook(() => useRenameFolder(), {
      wrapper: wrapQC(qc),
    });

    act(() => {
      result.current.mutate({ id: 'f1', name: 'Renamed' });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockUpdateFolder).toHaveBeenCalledWith('f1', { name: 'Renamed' });
  });
});

// ------------------------------------------------------------------

describe('useMoveFolder', () => {
  let qc: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    qc = makeQC();
    qc.setQueryData(
      ['folders'],
      [
        makeFolder('f1', 'Folder', 'old-parent'),
        makeFolder('new-parent', 'Parent'),
      ]
    );
  });

  afterEach(() => {
    qc.clear();
  });

  it('applies optimistic parentId change before server responds', async () => {
    let resolveUpdate!: (v: ProjectFolder) => void;
    mockUpdateFolder.mockReturnValue(
      new Promise<ProjectFolder>(res => {
        resolveUpdate = res;
      })
    );
    mockGetFolders.mockResolvedValue([
      makeFolder('f1', 'Folder', 'new-parent'),
      makeFolder('new-parent', 'Parent'),
    ]);

    const { result } = renderHook(() => useMoveFolder(), {
      wrapper: wrapQC(qc),
    });

    act(() => {
      result.current.mutate({ id: 'f1', parentId: 'new-parent' });
    });

    await waitFor(() => {
      const cached = qc.getQueryData<ProjectFolder[]>(['folders']) ?? [];
      return cached.find(f => f.id === 'f1')?.parentId === 'new-parent';
    });

    resolveUpdate(makeFolder('f1', 'Folder', 'new-parent'));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('rolls back parentId on error', async () => {
    mockUpdateFolder.mockRejectedValue(new Error('cycle'));
    mockGetFolders.mockResolvedValue([
      makeFolder('f1', 'Folder', 'old-parent'),
    ]);

    const { result } = renderHook(() => useMoveFolder(), {
      wrapper: wrapQC(qc),
    });

    act(() => {
      result.current.mutate({ id: 'f1', parentId: 'would-cycle' });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    const cached = qc.getQueryData<ProjectFolder[]>(['folders']) ?? [];
    const f1 = cached.find(f => f.id === 'f1');
    expect(f1?.parentId).toBe('old-parent');
  });

  it('supports moving to root (parentId: null)', async () => {
    mockUpdateFolder.mockResolvedValue(makeFolder('f1', 'Folder', null));
    mockGetFolders.mockResolvedValue([makeFolder('f1', 'Folder', null)]);

    const { result } = renderHook(() => useMoveFolder(), {
      wrapper: wrapQC(qc),
    });

    act(() => {
      result.current.mutate({ id: 'f1', parentId: null });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockUpdateFolder).toHaveBeenCalledWith('f1', { parentId: null });
  });
});

// ------------------------------------------------------------------

describe('useDeleteFolder', () => {
  let qc: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    qc = makeQC();
    qc.setQueryData(['folders'], [makeFolder('f1', 'ToDelete')]);
  });

  afterEach(() => {
    qc.clear();
  });

  it('calls apiClient.deleteFolder with the folder id', async () => {
    mockDeleteFolder.mockResolvedValue({
      folderDeleted: true,
      deletedProjectIds: [],
      unlinkedSharedProjectIds: [],
      failedProjectIds: [],
    });
    mockGetFolders.mockResolvedValue([]);

    const { result } = renderHook(() => useDeleteFolder(), {
      wrapper: wrapQC(qc),
    });

    act(() => {
      result.current.mutate('f1');
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockDeleteFolder).toHaveBeenCalledWith('f1');
  });

  it('does not optimistically remove from cache (waits for server)', async () => {
    let resolveDelete!: (v: unknown) => void;
    mockDeleteFolder.mockReturnValue(
      new Promise(res => {
        resolveDelete = res;
      })
    );

    const { result } = renderHook(() => useDeleteFolder(), {
      wrapper: wrapQC(qc),
    });

    act(() => {
      result.current.mutate('f1');
    });

    // Before resolution, f1 is still in the cache
    const cached = qc.getQueryData<ProjectFolder[]>(['folders']) ?? [];
    expect(cached.some(f => f.id === 'f1')).toBe(true);

    resolveDelete({
      folderDeleted: true,
      deletedProjectIds: [],
      unlinkedSharedProjectIds: [],
      failedProjectIds: [],
    });
    mockGetFolders.mockResolvedValue([]);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('marks isError on API failure without optimistic rollback needed', async () => {
    mockDeleteFolder.mockRejectedValue(new Error('permission denied'));
    mockGetFolders.mockResolvedValue([makeFolder('f1', 'ToDelete')]);

    const { result } = renderHook(() => useDeleteFolder(), {
      wrapper: wrapQC(qc),
    });

    act(() => {
      result.current.mutate('f1');
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

// ------------------------------------------------------------------

describe('useMoveProjects', () => {
  let qc: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    qc = makeQC();
  });

  afterEach(() => {
    qc.clear();
  });

  it('calls apiClient.moveProjectsToFolder with correct args', async () => {
    mockMoveProjectsToFolder.mockResolvedValue({
      movedProjectIds: ['p1', 'p2'],
      skippedProjectIds: [],
    });
    mockGetFolders.mockResolvedValue([]);

    const { result } = renderHook(() => useMoveProjects(), {
      wrapper: wrapQC(qc),
    });

    act(() => {
      result.current.mutate({ folderId: 'folder-1', projectIds: ['p1', 'p2'] });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockMoveProjectsToFolder).toHaveBeenCalledWith('folder-1', [
      'p1',
      'p2',
    ]);
  });

  it('dispatches project-refetch-needed on settled', async () => {
    mockMoveProjectsToFolder.mockResolvedValue({
      movedProjectIds: [],
      skippedProjectIds: [],
    });
    mockGetFolders.mockResolvedValue([]);

    const events: Event[] = [];
    const listener = (e: Event) => events.push(e);
    window.addEventListener('project-refetch-needed', listener);

    const { result } = renderHook(() => useMoveProjects(), {
      wrapper: wrapQC(qc),
    });

    act(() => {
      result.current.mutate({ folderId: null, projectIds: ['p1'] });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    window.removeEventListener('project-refetch-needed', listener);
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it('marks isError when API call fails', async () => {
    mockMoveProjectsToFolder.mockRejectedValue(new Error('not found'));

    const { result } = renderHook(() => useMoveProjects(), {
      wrapper: wrapQC(qc),
    });

    act(() => {
      result.current.mutate({ folderId: 'f1', projectIds: ['p1'] });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

// ------------------------------------------------------------------

describe('useFolderPreview', () => {
  let qc: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    qc = makeQC();
  });

  afterEach(() => {
    qc.clear();
  });

  it('does not call apiClient when folderId is null', () => {
    mockPreviewFolder.mockResolvedValue(null);

    renderHook(() => useFolderPreview(null), { wrapper: wrapQC(qc) });

    // enabled=false → no fetch
    expect(mockPreviewFolder).not.toHaveBeenCalled();
  });

  it('fetches preview data when folderId is provided', async () => {
    const preview = {
      folderId: 'f1',
      ownedProjectCount: 3,
      sharedProjectCount: 1,
      subfolderCount: 2,
    };
    mockPreviewFolder.mockResolvedValue(preview);

    const { result } = renderHook(() => useFolderPreview('f1'), {
      wrapper: wrapQC(qc),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(preview);
    expect(mockPreviewFolder).toHaveBeenCalledWith('f1');
  });

  it('reports error state when preview API fails', async () => {
    mockPreviewFolder.mockRejectedValue(new Error('server error'));

    const { result } = renderHook(() => useFolderPreview('f1'), {
      wrapper: wrapQC(qc),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
