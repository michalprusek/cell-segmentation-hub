/**
 * useDeleteTrackScope — the "this frame or the whole track?" decision.
 *
 * These tests are about WIRING, not about the helpers: which polygons get a
 * scope question at all, which endpoint each answer reaches, and — the safety
 * property the feature turns on — that a failed request leaves the polygon in
 * the editor rather than one save away from a cross-frame purge.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const { apiMock, toastMock } = vi.hoisted(() => ({
  apiMock: {
    deleteTrack: vi.fn(),
    deleteTrackFromFrame: vi.fn(),
  },
  toastMock: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/lib/api', () => ({ default: apiMock }));
vi.mock('sonner', () => ({ toast: toastMock }));
vi.mock('@/contexts/useLanguage', () => ({
  useLanguage: () => ({ t: (k: string) => k }),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { useDeleteTrackScope } from '../useDeleteTrackScope';

const TRACKED = {
  id: 'poly-1',
  points: [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ],
  type: 'external',
  geometry: 'polyline',
  trackId: 'mt_a1b2c3',
};
const UNTRACKED = { ...TRACKED, id: 'poly-2', trackId: undefined };

let removeLocally: ReturnType<typeof vi.fn>;
let onServerMutation: ReturnType<typeof vi.fn>;
/** Mutable so a test can simulate a reload replacing the polygons mid-dialog. */
let polygons: Array<Record<string, unknown>>;

const setup = (overrides: Record<string, unknown> = {}) =>
  renderHook(() =>
    useDeleteTrackScope({
      projectType: 'microtubules',
      videoId: 'vid-1',
      imageId: 'img-5',
      getPolygons: () => polygons as never,
      removeLocally,
      onServerMutation,
      ...overrides,
    } as never)
  );

beforeEach(() => {
  vi.clearAllMocks();
  removeLocally = vi.fn();
  onServerMutation = vi.fn();
  polygons = [TRACKED, UNTRACKED];
  apiMock.deleteTrack.mockResolvedValue({ framesAffected: 12 });
  apiMock.deleteTrackFromFrame.mockResolvedValue({ removed: 1 });
});

describe('useDeleteTrackScope — which deletes get a scope question', () => {
  it('asks for a tracked microtubule on a video', () => {
    const { result } = setup();
    expect(result.current.requestDelete('poly-1')).toBe(true);
  });

  it('does not ask for a polyline without a trackId', () => {
    const { result } = setup();
    expect(result.current.requestDelete('poly-2')).toBe(false);
  });

  it('does not ask outside a microtubule project', () => {
    const { result } = setup({ projectType: 'spheroid' });
    expect(result.current.requestDelete('poly-1')).toBe(false);
  });

  // The container is a separate query that can still be resolving on a cold
  // deep-link into a frame URL. Treating that window as "unambiguous" would
  // local-delete a tracked polyline, and the next save would purge it from
  // every sibling frame — silently, which is what this hook exists to stop.
  it('claims a tracked delete even while the container is unresolved, and deletes nothing', () => {
    const { result } = setup({ videoId: undefined });

    expect(result.current.requestDelete('poly-1')).toBe(true);
    expect(result.current.scopeDialog.open).toBe(false);
    expect(removeLocally).not.toHaveBeenCalled();
    expect(apiMock.deleteTrack).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledWith(
      'segmentation.trackOps.deleteScopeUnavailable'
    );
  });

  it('refuses a whole-track delete rather than falling back to a local one', async () => {
    const { result } = setup({ videoId: undefined });
    await act(async () => {
      await result.current.deleteWholeTrack('poly-1');
    });
    expect(removeLocally).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledWith(
      'segmentation.trackOps.deleteScopeUnavailable'
    );
  });

  it('opens the dialog only after a request, and closing clears the target', () => {
    const { result } = setup();
    expect(result.current.scopeDialog.open).toBe(false);

    act(() => {
      result.current.requestDelete('poly-1');
    });
    expect(result.current.scopeDialog.open).toBe(true);

    act(() => {
      result.current.scopeDialog.onOpenChange(false);
    });
    expect(result.current.scopeDialog.open).toBe(false);
    // Cancelling deletes nothing anywhere.
    expect(apiMock.deleteTrack).not.toHaveBeenCalled();
    expect(apiMock.deleteTrackFromFrame).not.toHaveBeenCalled();
    expect(removeLocally).not.toHaveBeenCalled();
  });
});

describe('useDeleteTrackScope — each answer reaches its own endpoint', () => {
  it('"this frame only" calls the frame-scoped route and never the video one', async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.deleteFromCurrentFrame('poly-1');
    });

    expect(apiMock.deleteTrackFromFrame).toHaveBeenCalledWith(
      'img-5',
      'mt_a1b2c3'
    );
    expect(apiMock.deleteTrack).not.toHaveBeenCalled();
    // Silent: the scope-aware toast below replaces the editor's generic one.
    expect(removeLocally).toHaveBeenCalledWith('poly-1', { silent: true });
    expect(onServerMutation).toHaveBeenCalled();
    expect(toastMock.success).toHaveBeenCalledWith(
      'segmentation.trackOps.deleteFrameSuccess'
    );
    expect(toastMock.success).toHaveBeenCalledTimes(1);
  });

  it('"all frames" calls the video-scoped route and never the frame one', async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.deleteWholeTrack('poly-1');
    });

    expect(apiMock.deleteTrack).toHaveBeenCalledWith('vid-1', 'mt_a1b2c3');
    expect(apiMock.deleteTrackFromFrame).not.toHaveBeenCalled();
    expect(removeLocally).toHaveBeenCalledWith('poly-1', { silent: true });
  });

  it('routes the dialog buttons to the matching scope', async () => {
    const { result } = setup();
    act(() => {
      result.current.requestDelete('poly-1');
    });
    await act(async () => {
      result.current.scopeDialog.onDeleteFrame();
    });
    expect(apiMock.deleteTrackFromFrame).toHaveBeenCalledWith(
      'img-5',
      'mt_a1b2c3'
    );
    expect(apiMock.deleteTrack).not.toHaveBeenCalled();

    act(() => {
      result.current.requestDelete('poly-1');
    });
    await act(async () => {
      result.current.scopeDialog.onDeleteTrack();
    });
    expect(apiMock.deleteTrack).toHaveBeenCalledWith('vid-1', 'mt_a1b2c3');
  });

  it('survives a reload that re-ids the polygon while the dialog is open', async () => {
    // A WebSocket completion can replace editor.polygons with freshly-id'd
    // copies behind the modal. The trackId is what identifies the microtubule,
    // so the request must still be right and the CURRENT id must be removed.
    const { result } = setup();
    act(() => {
      result.current.requestDelete('poly-1');
    });

    polygons = [{ ...TRACKED, id: 'poly-1-reloaded' }, UNTRACKED];

    await act(async () => {
      result.current.scopeDialog.onDeleteFrame();
    });

    expect(apiMock.deleteTrackFromFrame).toHaveBeenCalledWith(
      'img-5',
      'mt_a1b2c3'
    );
    expect(removeLocally).toHaveBeenCalledWith('poly-1-reloaded', {
      silent: true,
    });
  });

  it('an untracked polygon just deletes locally, with no request at all', async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.deleteWholeTrack('poly-2');
    });
    expect(apiMock.deleteTrack).not.toHaveBeenCalled();
    expect(removeLocally).toHaveBeenCalledWith('poly-2');
  });
});

describe('useDeleteTrackScope — a failed request keeps the polygon', () => {
  // Removing it locally after a failed frame-scoped delete would leave the
  // editor one save away from the cross-frame purge the user just declined.
  it('does not remove the polygon when the frame-scoped delete fails', async () => {
    apiMock.deleteTrackFromFrame.mockRejectedValueOnce(new Error('boom'));
    const { result } = setup();

    await act(async () => {
      await result.current.deleteFromCurrentFrame('poly-1');
    });

    expect(removeLocally).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledWith(
      'segmentation.trackOps.deleteFrameFailed'
    );
  });

  it('does not remove the polygon when the whole-track delete fails', async () => {
    apiMock.deleteTrack.mockRejectedValueOnce(new Error('boom'));
    const { result } = setup();

    await act(async () => {
      await result.current.deleteWholeTrack('poly-1');
    });

    expect(removeLocally).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledWith(
      'segmentation.trackOps.deleteTrackFailed'
    );
  });
});

// A scribble in delete mode can touch many shapes at once. The tracked
// microtubules among them get ONE scope question for the lot — the owner's
// choice, matching the Shift multi-select bulk delete — while everything else
// is handed back to be deleted locally right away.
describe('useDeleteTrackScope — one question for many microtubules', () => {
  const TRACKED_B = { ...TRACKED, id: 'poly-3', trackId: 'mt_d4e5f6' };

  it('requestDeleteMany returns untracked ids and asks once', () => {
    polygons = [TRACKED, UNTRACKED, TRACKED_B];
    const { result } = setup();

    let unclaimed: string[] = [];
    act(() => {
      unclaimed = result.current.requestDeleteMany([
        'poly-1',
        'poly-2',
        'poly-3',
      ]);
    });

    expect(unclaimed).toEqual(['poly-2']);
    expect(result.current.scopeDialog.open).toBe(true);
    expect(result.current.scopeDialog.count).toBe(2);
    expect(removeLocally).not.toHaveBeenCalled();
  });

  it('onDeleteFrame applies to every pending track with one toast', async () => {
    polygons = [TRACKED, UNTRACKED, TRACKED_B];
    const { result } = setup();
    act(() => {
      result.current.requestDeleteMany(['poly-1', 'poly-3']);
    });

    await act(async () => {
      result.current.scopeDialog.onDeleteFrame();
    });

    expect(apiMock.deleteTrackFromFrame).toHaveBeenCalledWith(
      'img-5',
      'mt_a1b2c3'
    );
    expect(apiMock.deleteTrackFromFrame).toHaveBeenCalledWith(
      'img-5',
      'mt_d4e5f6'
    );
    expect(removeLocally).toHaveBeenCalledWith('poly-1', { silent: true });
    expect(removeLocally).toHaveBeenCalledWith('poly-3', { silent: true });
    expect(toastMock.success).toHaveBeenCalledTimes(1);
    expect(toastMock.success).toHaveBeenCalledWith(
      'segmentation.trackOps.deleteManyFrameSuccess'
    );
    expect(result.current.scopeDialog.open).toBe(false);
  });

  it('onDeleteTrack applies to every pending track and reports a partial failure', async () => {
    polygons = [TRACKED, UNTRACKED, TRACKED_B];
    apiMock.deleteTrack
      .mockResolvedValueOnce({ framesAffected: 12 })
      .mockRejectedValueOnce(new Error('boom'));
    const { result } = setup();
    act(() => {
      result.current.requestDeleteMany(['poly-1', 'poly-3']);
    });

    await act(async () => {
      result.current.scopeDialog.onDeleteTrack();
    });

    expect(apiMock.deleteTrack).toHaveBeenCalledTimes(2);
    // Only the one that reached the server leaves the editor.
    expect(removeLocally).toHaveBeenCalledTimes(1);
    expect(removeLocally).toHaveBeenCalledWith('poly-1', { silent: true });
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.warning).toHaveBeenCalledWith(
      'segmentation.trackOps.deleteSelectedPartial'
    );
  });

  it('cancelling the dialog deletes none of the pending tracks', () => {
    polygons = [TRACKED, UNTRACKED, TRACKED_B];
    const { result } = setup();
    act(() => {
      result.current.requestDeleteMany(['poly-1', 'poly-3']);
    });
    act(() => {
      result.current.scopeDialog.onOpenChange(false);
    });
    expect(result.current.scopeDialog.open).toBe(false);
    expect(apiMock.deleteTrack).not.toHaveBeenCalled();
    expect(apiMock.deleteTrackFromFrame).not.toHaveBeenCalled();
    expect(removeLocally).not.toHaveBeenCalled();
  });

  // The loop sends one request at a time. If the user moves to the next frame
  // while it runs, the editor's live polygons are the NEXT frame's — and
  // removing "the same track" there locally is a delete the next save turns
  // into a whole-track delete: exactly what "this frame only" refused.
  it('a frame change mid-loop removes nothing locally on the new frame', async () => {
    polygons = [TRACKED, UNTRACKED, TRACKED_B];
    let release!: () => void;
    apiMock.deleteTrackFromFrame.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          release = () => resolve({ removed: 1 });
        })
    );
    const { result, rerender } = renderHook(
      ({ imageId }: { imageId: string }) =>
        useDeleteTrackScope({
          projectType: 'microtubules',
          videoId: 'vid-1',
          imageId,
          getPolygons: () => polygons as never,
          removeLocally,
          onServerMutation,
        } as never),
      { initialProps: { imageId: 'img-5' } }
    );
    act(() => {
      result.current.requestDeleteMany(['poly-1', 'poly-3']);
    });
    let done!: Promise<void>;
    act(() => {
      done = Promise.resolve(result.current.scopeDialog.onDeleteFrame());
    });

    // The user scrubs to the next frame; its polygons carry the same tracks.
    polygons = [
      { ...TRACKED, id: 'next-1' },
      { ...TRACKED_B, id: 'next-3' },
    ];
    rerender({ imageId: 'img-6' });
    await act(async () => {
      release();
      await done;
      await new Promise(r => setTimeout(r, 0));
    });

    // Both deletes went to the frame the dialog was answered on...
    expect(apiMock.deleteTrackFromFrame).toHaveBeenNthCalledWith(
      1,
      'img-5',
      'mt_a1b2c3'
    );
    expect(apiMock.deleteTrackFromFrame).toHaveBeenNthCalledWith(
      2,
      'img-5',
      'mt_d4e5f6'
    );
    // ...and nothing was removed from the frame now open.
    expect(removeLocally).not.toHaveBeenCalled();
    // The stale cache of the answered frame is still evicted.
    expect(onServerMutation).toHaveBeenCalled();
  });

  it('requestDeleteMany on a non-MT project claims nothing', () => {
    const { result } = setup({ projectType: 'spheroid' });
    let unclaimed: string[] = [];
    act(() => {
      unclaimed = result.current.requestDeleteMany(['poly-1', 'poly-2']);
    });
    expect(unclaimed).toEqual(['poly-1', 'poly-2']);
    expect(result.current.scopeDialog.open).toBe(false);
  });

  it('claims tracked ids but deletes nothing while the container is unresolved', () => {
    const { result } = setup({ videoId: undefined });
    let unclaimed: string[] = [];
    act(() => {
      unclaimed = result.current.requestDeleteMany(['poly-1', 'poly-2']);
    });
    expect(unclaimed).toEqual(['poly-2']);
    expect(result.current.scopeDialog.open).toBe(false);
    expect(toastMock.error).toHaveBeenCalledWith(
      'segmentation.trackOps.deleteScopeUnavailable'
    );
  });

  it('a single pending track keeps the single-delete count and toast', async () => {
    const { result } = setup();
    act(() => {
      result.current.requestDelete('poly-1');
    });
    expect(result.current.scopeDialog.count).toBe(1);
    await act(async () => {
      result.current.scopeDialog.onDeleteFrame();
    });
    expect(toastMock.success).toHaveBeenCalledWith(
      'segmentation.trackOps.deleteFrameSuccess'
    );
  });
});
