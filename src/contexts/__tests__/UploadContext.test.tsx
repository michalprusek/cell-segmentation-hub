/**
 * UploadContext — consolidated behaviour tests.
 *
 * Covers the full upload state machine exercised through a single shared
 * harness: image-batch (regular + chunked) uploads, video routing/outcomes,
 * cancellation, error handling, duplicate-upload guarding, and the WebSocket
 * progress/completed events.
 *
 * localStorage persistence (session hydration/serialisation) needs a distinct
 * Map-backed storage harness and lives in UploadContext.persistence.test.tsx.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React, { ReactNode } from 'react';
import { UploadProvider } from '@/contexts/UploadContext';
import { useUpload } from '@/contexts/useUpload';
import { DEFAULT_CHUNKING_CONFIG } from '@/lib/uploadUtils';
import { toast } from 'sonner';

// ─── hoisted mocks ────────────────────────────────────────────────────────────

const {
  uploadImagesMock,
  uploadImagesChunkedMock,
  uploadVideoMock,
  mockSocket,
} = vi.hoisted(() => ({
  uploadImagesMock: vi.fn(),
  uploadImagesChunkedMock: vi.fn(),
  uploadVideoMock: vi.fn(),
  mockSocket: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
}));

vi.mock('@/lib/api', () => ({
  default: {
    uploadImages: uploadImagesMock,
    uploadImagesChunked: uploadImagesChunkedMock,
    uploadVideo: uploadVideoMock,
  },
}));

// A live mock socket exercises the WebSocket progress path; behaviour tests
// that don't touch the socket are unaffected (handlers register but never fire).
vi.mock('@/contexts/useWebSocket', () => ({
  useWebSocket: () => ({ socket: mockSocket }),
}));

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

// axios.isCancel is only consulted on the video path; flag cancels with __cancel.
vi.mock('axios', () => ({
  default: {
    isCancel: (e: unknown) => Boolean((e as { __cancel?: boolean })?.__cancel),
  },
}));

// ─── shared helpers ─────────────────────────────────────────────────────────────

const wrapper = ({ children }: { children: ReactNode }) => (
  <UploadProvider>{children}</UploadProvider>
);

const makeFile = (name: string, type = 'image/png'): File =>
  new File(['payload'], name, { type });

const makeVideo = (name = 'clip.mp4'): File =>
  new File(['payload'], name, { type: 'video/mp4' });

/** Poll until any session (matching `predicate`) reaches a terminal status. */
async function waitForTerminal(
  getSessions: () => Record<string, { status: string }>,
  predicate: (s: { status: string }) => boolean = () => true
): Promise<{ status: string }> {
  for (let i = 0; i < 300; i++) {
    const s = Object.values(getSessions()).find(predicate);
    if (s && s.status !== 'uploading') return s;
    await new Promise(r => setTimeout(r, 10));
  }
  throw new Error('Session never reached terminal status');
}

/** Pull the handler the provider registered on the socket for `event`. */
function getSocketHandler(
  event: string
): ((...args: unknown[]) => void) | undefined {
  const calls = mockSocket.on.mock.calls as [
    string,
    (...args: unknown[]) => void,
  ][];
  return calls.find(([ev]) => ev === event)?.[1];
}

beforeEach(() => {
  uploadImagesMock.mockReset();
  uploadImagesChunkedMock.mockReset();
  uploadVideoMock.mockReset();
  mockSocket.on.mockReset();
  mockSocket.off.mockReset();
  mockSocket.emit.mockReset();
  vi.clearAllMocks();
});

// ─── error boundaries ───────────────────────────────────────────────────────────

describe('UploadContext — error boundaries', () => {
  it('throws when useUpload is used outside UploadProvider', () => {
    expect(() => renderHook(() => useUpload())).toThrow(
      'useUpload must be used within an UploadProvider'
    );
  });
});

// ─── initial state ─────────────────────────────────────────────────────────────

describe('UploadContext — initial state', () => {
  it('starts with empty sessions, no active session, and isUploading=false', () => {
    const { result } = renderHook(() => useUpload(), { wrapper });

    expect(result.current.sessions).toEqual({});
    expect(result.current.activeSession).toBeNull();
    expect(result.current.isUploading).toBe(false);
  });
});

// ─── startUpload: regular image batch ──────────────────────────────────────────

describe('UploadContext — startUpload (image batch)', () => {
  it('creates a new session with metadata and returns a sessionId', async () => {
    // Keep the upload pending so we can inspect the live session.
    let resolveUpload!: (value: unknown) => void;
    uploadImagesMock.mockReturnValueOnce(
      new Promise(resolve => {
        resolveUpload = resolve;
      })
    );

    const { result } = renderHook(() => useUpload(), { wrapper });

    let sessionId!: string;
    act(() => {
      sessionId = result.current.startUpload(
        'project-named',
        [makeFile('a.png'), makeFile('b.png')],
        'My Named Project'
      );
    });

    expect(sessionId).toMatch(/^upload_/);
    const session = result.current.sessions[sessionId];
    expect(session).toBeDefined();
    expect(session.projectId).toBe('project-named');
    expect(session.projectName).toBe('My Named Project');
    expect(session.totalFiles).toBe(2);
    expect(session.status).toBe('uploading');
    expect(session.startedAt).toBeGreaterThan(0);
    expect(result.current.isUploading).toBe(true);

    resolveUpload([]);
  });

  it('marks the session completed and fires onComplete on a successful upload', async () => {
    uploadImagesMock.mockResolvedValueOnce([
      { id: '1', filename: 'img.png' },
      { id: '2', filename: 'img2.png' },
    ]);
    const onComplete = vi.fn();

    const { result } = renderHook(() => useUpload(), { wrapper });

    let sessionId!: string;
    act(() => {
      sessionId = result.current.startUpload(
        'project-success',
        [makeFile('img.png'), makeFile('img2.png')],
        'My Project',
        onComplete
      );
    });

    await waitFor(() => {
      expect(result.current.sessions[sessionId]?.status).toBe('completed');
    });

    expect(result.current.sessions[sessionId].successCount).toBe(2);
    expect(result.current.sessions[sessionId].overallProgress).toBe(100);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('derives isUploading/activeSession true while active and false once completed', async () => {
    uploadImagesMock.mockResolvedValueOnce([
      { id: '1', filename: 'derive.png' },
    ]);

    const { result } = renderHook(() => useUpload(), { wrapper });

    let sessionId!: string;
    act(() => {
      sessionId = result.current.startUpload('project-derive', [
        makeFile('derive.png'),
      ]);
    });

    // Immediately after startUpload the session is active.
    expect(result.current.isUploading).toBe(true);
    expect(result.current.activeSession?.id).toBe(sessionId);

    await waitFor(() => {
      expect(result.current.sessions[sessionId]?.status).toBe('completed');
    });

    expect(result.current.isUploading).toBe(false);
    expect(result.current.activeSession).toBeNull();
  });
});

// ─── startUpload: chunked image batch (files > chunkSize) ───────────────────────

describe('UploadContext — startUpload (chunked image batch)', () => {
  const OVER_LIMIT = DEFAULT_CHUNKING_CONFIG.chunkSize + 1;

  const manyImages = (count = OVER_LIMIT): File[] =>
    Array.from({ length: count }, (_, i) => makeFile(`img${i}.png`));

  it('routes large batches through uploadImagesChunked → completed + toast.success', async () => {
    uploadImagesChunkedMock.mockResolvedValue({
      success: [
        Array.from({ length: OVER_LIMIT }, (_, i) => ({ id: `i${i}` })),
      ],
      failed: [],
    });

    const { result } = renderHook(() => useUpload(), { wrapper });
    await act(async () => {
      result.current.startUpload('proj-chunk-ok', manyImages());
    });
    const session = await waitForTerminal(() => result.current.sessions);

    expect(uploadImagesChunkedMock).toHaveBeenCalledTimes(1);
    expect(uploadImagesMock).not.toHaveBeenCalled();
    expect(session.status).toBe('completed');
    expect(toast.success).toHaveBeenCalled();
  });

  it('shows toast.warning when some chunks partially fail', async () => {
    uploadImagesChunkedMock.mockResolvedValue({
      success: [[{ id: 'img1' }, { id: 'img2' }]],
      failed: [{ chunk: 1, files: [makeFile('bad.png')], error: 'err' }],
    });

    const { result } = renderHook(() => useUpload(), { wrapper });
    await act(async () => {
      result.current.startUpload('proj-chunk-partial', manyImages());
    });
    await waitForTerminal(() => result.current.sessions);

    expect(toast.warning).toHaveBeenCalled();
  });

  it('sets status=failed and toast.error when all chunks fail', async () => {
    uploadImagesChunkedMock.mockResolvedValue({
      success: [[]],
      failed: [{ chunk: 0, files: manyImages(), error: 'total failure' }],
    });

    const { result } = renderHook(() => useUpload(), { wrapper });
    await act(async () => {
      result.current.startUpload('proj-chunk-allfail', manyImages());
    });
    const session = await waitForTerminal(() => result.current.sessions);

    expect(session.status).toBe('failed');
    expect(toast.error).toHaveBeenCalled();
  });

  it('invokes the overallProgress callback that lifts session.overallProgress', async () => {
    uploadImagesChunkedMock.mockImplementation(
      async (
        _projectId: string,
        _files: File[],
        onProgress: (pct: number) => void
      ) => {
        onProgress(50);
        onProgress(100);
        return { success: [[{ id: 'x' }]], failed: [] };
      }
    );

    const { result } = renderHook(() => useUpload(), { wrapper });
    let sessionId!: string;
    await act(async () => {
      sessionId = result.current.startUpload('proj-progress', manyImages());
    });
    await waitForTerminal(() => result.current.sessions);

    expect(
      result.current.sessions[sessionId].overallProgress
    ).toBeGreaterThanOrEqual(100);
  });

  it('invokes the chunkProgress callback', async () => {
    const chunkData = {
      chunkIndex: 0,
      totalChunks: 2,
      filesInChunk: 5,
      overallProgress: 50,
      currentOperation: 'Uploading chunk 1/2',
    };
    uploadImagesChunkedMock.mockImplementation(
      async (
        _projectId: string,
        _files: File[],
        _onProgress: (pct: number) => void,
        onChunkProgress: (cp: typeof chunkData) => void
      ) => {
        onChunkProgress(chunkData);
        return { success: [[{ id: 'x' }]], failed: [] };
      }
    );

    const { result } = renderHook(() => useUpload(), { wrapper });
    let sessionId!: string;
    await act(async () => {
      sessionId = result.current.startUpload(
        'proj-chunk-progress',
        manyImages()
      );
    });
    await waitForTerminal(() => result.current.sessions);

    // chunkProgress is cleared at completion; assert the callback path completed.
    expect(result.current.sessions[sessionId].status).toBe('completed');
  });
});

// ─── startUpload: video routing ────────────────────────────────────────────────

describe('UploadContext — startUpload (video routing)', () => {
  it('routes a .mp4 to uploadVideo, not the image paths', async () => {
    uploadVideoMock.mockResolvedValue({
      videoContainerId: 'c-1',
      frameCount: 5,
      channels: [],
    });

    const { result } = renderHook(() => useUpload(), { wrapper });
    await act(async () => {
      result.current.startUpload('proj-1', [makeFile('clip.mp4', 'video/mp4')]);
    });
    await waitForTerminal(() => result.current.sessions);

    expect(uploadVideoMock).toHaveBeenCalledTimes(1);
    expect(uploadVideoMock.mock.calls[0][1].name).toBe('clip.mp4');
    expect(uploadImagesMock).not.toHaveBeenCalled();
    expect(uploadImagesChunkedMock).not.toHaveBeenCalled();
  });

  it('routes an .nd2 file with octet-stream MIME via the extension fallback', async () => {
    uploadVideoMock.mockResolvedValue({
      videoContainerId: 'c-2',
      frameCount: 100,
      channels: [],
    });

    const { result } = renderHook(() => useUpload(), { wrapper });
    await act(async () => {
      result.current.startUpload('proj-2', [
        makeFile('stack.nd2', 'application/octet-stream'),
      ]);
    });
    await waitForTerminal(() => result.current.sessions);

    expect(uploadVideoMock).toHaveBeenCalledTimes(1);
    expect(uploadImagesMock).not.toHaveBeenCalled();
  });

  it('splits a mixed batch: videos via uploadVideo, images via the image path', async () => {
    uploadVideoMock.mockResolvedValue({
      videoContainerId: 'cX',
      frameCount: 30,
      channels: [],
    });
    uploadImagesMock.mockResolvedValue([{ id: 'img-1' }, { id: 'img-2' }]);

    const { result } = renderHook(() => useUpload(), { wrapper });
    await act(async () => {
      result.current.startUpload('proj-3', [
        makeFile('a.jpg', 'image/jpeg'),
        makeFile('b.mp4', 'video/mp4'),
        makeFile('c.png', 'image/png'),
      ]);
    });
    await waitForTerminal(() => result.current.sessions);

    expect(uploadVideoMock).toHaveBeenCalledTimes(1);
    expect(uploadImagesMock).toHaveBeenCalledTimes(1);
    const imageBatch = uploadImagesMock.mock.calls[0][1] as File[];
    expect(imageBatch.map(f => f.name).sort()).toEqual(['a.jpg', 'c.png']);
  });

  it('uploads multiple videos sequentially (one stream at a time)', async () => {
    let active = 0;
    let maxConcurrent = 0;
    uploadVideoMock.mockImplementation(async () => {
      active++;
      maxConcurrent = Math.max(maxConcurrent, active);
      await new Promise(r => setTimeout(r, 20));
      active--;
      return { videoContainerId: 'c', frameCount: 1, channels: [] };
    });

    const { result } = renderHook(() => useUpload(), { wrapper });
    await act(async () => {
      result.current.startUpload('proj-4', [
        makeVideo('v1.mp4'),
        makeVideo('v2.mp4'),
        makeVideo('v3.mp4'),
      ]);
    });
    await waitForTerminal(() => result.current.sessions);

    expect(uploadVideoMock).toHaveBeenCalledTimes(3);
    expect(maxConcurrent).toBe(1);
  });
});

// ─── startUpload: video-only outcomes ──────────────────────────────────────────

describe('UploadContext — startUpload (video outcomes)', () => {
  it('all videos succeed → status=completed, toast.success', async () => {
    uploadVideoMock.mockResolvedValue({
      videoContainerId: 'c1',
      frameCount: 10,
      channels: [],
    });

    const { result } = renderHook(() => useUpload(), { wrapper });
    await act(async () => {
      result.current.startUpload('proj', [
        makeVideo('a.mp4'),
        makeVideo('b.mp4'),
      ]);
    });
    const session = await waitForTerminal(() => result.current.sessions);

    expect(session.status).toBe('completed');
    expect(toast.success).toHaveBeenCalled();
  });

  it('success + cancel → completed, breaks the loop, and shows an info toast', async () => {
    uploadVideoMock
      .mockResolvedValueOnce({
        videoContainerId: 'ok',
        frameCount: 1,
        channels: [],
      })
      .mockRejectedValueOnce(
        Object.assign(new Error('canceled'), { __cancel: true })
      );

    const { result } = renderHook(() => useUpload(), { wrapper });
    await act(async () => {
      result.current.startUpload('proj-mix', [
        makeVideo('v1.mp4'),
        makeVideo('v2.mp4'),
        makeVideo('v3.mp4'),
      ]);
    });
    const session = await waitForTerminal(() => result.current.sessions);

    // 1 success + 1 cancel → 'completed'; the cancel breaks the loop so v3 is
    // never attempted and does not count as a failure.
    expect(session.status).toBe('completed');
    expect(uploadVideoMock).toHaveBeenCalledTimes(2);
    expect(toast.info).toHaveBeenCalledWith(
      expect.stringContaining('cancelled')
    );
  });

  it('all cancelled → status=cancelled, info toast', async () => {
    uploadVideoMock.mockRejectedValue(
      Object.assign(new Error('canceled'), { __cancel: true })
    );

    const { result } = renderHook(() => useUpload(), { wrapper });
    await act(async () => {
      result.current.startUpload('proj-allcancel', [makeVideo('a.mp4')]);
    });
    const session = await waitForTerminal(() => result.current.sessions);

    expect(session.status).toBe('cancelled');
    expect(toast.info).toHaveBeenCalled();
  });

  it('partial failure + success → completed, toast.warning', async () => {
    uploadVideoMock
      .mockResolvedValueOnce({
        videoContainerId: 'ok',
        frameCount: 1,
        channels: [],
      })
      .mockRejectedValueOnce(new Error('IO error'));

    const { result } = renderHook(() => useUpload(), { wrapper });
    await act(async () => {
      result.current.startUpload('proj-pf', [
        makeVideo('a.mp4'),
        makeVideo('b.mp4'),
      ]);
    });
    const session = await waitForTerminal(() => result.current.sessions);

    expect(session.status).toBe('completed');
    expect(toast.warning).toHaveBeenCalled();
  });

  it('all fail → status=failed, toast.error', async () => {
    uploadVideoMock.mockRejectedValue(new Error('server down'));

    const { result } = renderHook(() => useUpload(), { wrapper });
    await act(async () => {
      result.current.startUpload('proj-allfail', [makeVideo('a.mp4')]);
    });
    const session = await waitForTerminal(() => result.current.sessions);

    expect(session.status).toBe('failed');
    expect(toast.error).toHaveBeenCalled();
  });
});

// ─── cancelUpload ──────────────────────────────────────────────────────────────

describe('UploadContext — cancelUpload', () => {
  it('aborts the active upload and sets status to cancelled', async () => {
    uploadImagesMock.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          setTimeout(() => {
            const err = new Error('Upload cancelled');
            err.name = 'AbortError';
            reject(err);
          }, 50);
        })
    );

    const { result } = renderHook(() => useUpload(), { wrapper });

    let sessionId!: string;
    act(() => {
      sessionId = result.current.startUpload('project-cancel', [
        makeFile('big.png'),
      ]);
    });
    expect(result.current.sessions[sessionId].status).toBe('uploading');

    act(() => {
      result.current.cancelUpload(sessionId);
    });

    await waitFor(() => {
      expect(result.current.sessions[sessionId]?.status).toBe('cancelled');
    });
  });

  it('emits upload:cancel on the socket with the session projectId', async () => {
    let reject!: (e: Error) => void;
    uploadImagesMock.mockReturnValueOnce(
      new Promise((_resolve, r) => {
        reject = r;
      })
    );

    const { result } = renderHook(() => useUpload(), { wrapper });

    let sessionId!: string;
    act(() => {
      sessionId = result.current.startUpload('proj-cancel-sock', [
        makeFile('f.png'),
      ]);
    });
    await waitFor(() =>
      expect(result.current.sessions[sessionId]?.status).toBe('uploading')
    );

    act(() => {
      result.current.cancelUpload(sessionId);
    });

    expect(mockSocket.emit).toHaveBeenCalledWith(
      'upload:cancel',
      expect.objectContaining({ projectId: 'proj-cancel-sock' })
    );

    const abortErr = new Error('Request cancelled');
    abortErr.name = 'AbortError';
    reject(abortErr);
  });
});

// ─── error handling ─────────────────────────────────────────────────────────────

describe('UploadContext — error handling', () => {
  it('sets status=failed, surfaces the error, and does not fire onComplete', async () => {
    uploadImagesMock.mockRejectedValueOnce(new Error('Network failure'));
    const onComplete = vi.fn();

    const { result } = renderHook(() => useUpload(), { wrapper });

    let sessionId!: string;
    act(() => {
      sessionId = result.current.startUpload(
        'project-err',
        [makeFile('err.png')],
        undefined,
        onComplete
      );
    });

    await waitFor(() => {
      expect(result.current.sessions[sessionId]?.status).toBe('failed');
    });

    expect(result.current.sessions[sessionId].error).toBe('Network failure');
    expect(result.current.sessions[sessionId].currentOperation).toBe(
      'Upload failed'
    );
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('sets status=cancelled when the upload rejects with an ERR_CANCELED code', async () => {
    const cancelErr = new Error('Request cancelled');
    (cancelErr as unknown as { code: string }).code = 'ERR_CANCELED';
    uploadImagesMock.mockRejectedValueOnce(cancelErr);

    const { result } = renderHook(() => useUpload(), { wrapper });

    let sessionId!: string;
    act(() => {
      sessionId = result.current.startUpload('project-axcancel', [
        makeFile('axcancel.png'),
      ]);
    });

    await waitFor(() => {
      expect(result.current.sessions[sessionId]?.status).toBe('cancelled');
    });
  });
});

// ─── clearSession ──────────────────────────────────────────────────────────────

describe('UploadContext — clearSession', () => {
  it('removes the target session from the map without affecting others', async () => {
    uploadImagesMock.mockResolvedValue([{ id: '1' }]);

    const { result } = renderHook(() => useUpload(), { wrapper });

    let s1!: string;
    act(() => {
      s1 = result.current.startUpload('proj-cls1', [makeFile('a.png')]);
    });
    await waitForTerminal(
      () => result.current.sessions,
      s => s.status === 'completed'
    );

    uploadImagesMock.mockResolvedValue([{ id: '2' }]);
    let s2!: string;
    act(() => {
      s2 = result.current.startUpload('proj-cls2', [makeFile('b.png')]);
    });
    await waitForTerminal(
      () => result.current.sessions,
      s =>
        s.status === 'completed' &&
        Object.values(result.current.sessions).some(
          ss => ss.id === s2 && ss.status === 'completed'
        )
    );

    act(() => {
      result.current.clearSession(s1);
    });

    expect(result.current.sessions[s1]).toBeUndefined();
    expect(result.current.sessions[s2]).toBeDefined();
  });
});

// NOTE: The startUpload duplicate-upload guard captures its result as a side
// effect inside a functional setSessions updater, relying on React's eager-state
// optimization to run synchronously. That optimization does not apply in the
// renderHook/act harness (the updater runs deferred), so the guard branch is not
// exercisable here — the original tests for it only asserted "no crash" and were
// removed as non-deterministic smoke tests.

// ─── WebSocket progress/completed events ────────────────────────────────────────

describe('UploadContext — WebSocket events', () => {
  /** Start an upload that stays in-flight so socket handlers are registered. */
  async function startPendingUpload(
    result: { current: ReturnType<typeof useUpload> },
    projectId: string,
    files: File[]
  ): Promise<string> {
    // Never-resolving promise keeps the session 'uploading' while WS events fire.
    uploadImagesMock.mockReturnValueOnce(new Promise(() => {}));
    let sessionId!: string;
    act(() => {
      sessionId = result.current.startUpload(projectId, files);
    });
    await waitFor(() =>
      expect(mockSocket.on).toHaveBeenCalledWith(
        'uploadProgress',
        expect.any(Function)
      )
    );
    return sessionId;
  }

  it('sets currentOperation to "Uploading ..." on an uploading progress event', async () => {
    const { result } = renderHook(() => useUpload(), { wrapper });
    const sessionId = await startPendingUpload(result, 'proj-ws', [
      makeFile('img.png'),
    ]);

    const handler = getSocketHandler('uploadProgress');
    expect(handler).toBeDefined();

    await act(async () => {
      handler!({
        filename: 'frame.png',
        fileSize: 1000,
        progress: 50,
        currentFileStatus: 'uploading',
        filesCompleted: 0,
        filesTotal: 1,
        percentComplete: 50,
      });
    });

    await waitFor(() => {
      const op = result.current.sessions[sessionId]?.currentOperation;
      expect(op).toContain('Uploading');
      expect(op).toContain('frame.png');
    });
  });

  it('sets currentOperation to "Processing ..." on a processing progress event', async () => {
    const { result } = renderHook(() => useUpload(), { wrapper });
    const sessionId = await startPendingUpload(result, 'proj-ws-proc', [
      makeFile('img.png'),
    ]);

    const handler = getSocketHandler('uploadProgress');
    await act(async () => {
      handler!({
        filename: 'frame.png',
        fileSize: 1000,
        progress: 60,
        currentFileStatus: 'processing',
        filesCompleted: 0,
        filesTotal: 1,
        percentComplete: 60,
      });
    });

    await waitFor(() => {
      expect(result.current.sessions[sessionId]?.currentOperation).toContain(
        'Processing'
      );
    });
  });

  it('throttles progress events whose delta < 1', async () => {
    const { result } = renderHook(() => useUpload(), { wrapper });
    const sessionId = await startPendingUpload(result, 'proj-ws-thr', [
      makeFile('img.png'),
    ]);

    const handler = getSocketHandler('uploadProgress');
    const event = {
      filename: 'f.png',
      fileSize: 100,
      progress: 50,
      currentFileStatus: 'uploading' as const,
      filesCompleted: 0,
      filesTotal: 1,
      percentComplete: 50,
    };

    await act(async () => {
      handler!(event);
    });
    const opAfterFirst = result.current.sessions[sessionId]?.currentOperation;

    // Same percentComplete (delta 0 < 1) → no update.
    await act(async () => {
      handler!(event);
    });
    expect(result.current.sessions[sessionId]?.currentOperation).toBe(
      opAfterFirst
    );
  });

  it('updates successCount/failedCount from an uploadCompleted summary', async () => {
    const { result } = renderHook(() => useUpload(), { wrapper });
    const sessionId = await startPendingUpload(result, 'proj-ws-cmp', [
      makeFile('a.png'),
      makeFile('b.png'),
    ]);

    const handler = getSocketHandler('uploadCompleted');
    expect(handler).toBeDefined();

    await act(async () => {
      handler!({ summary: { totalFiles: 2, successCount: 1, failedCount: 1 } });
    });

    expect(result.current.sessions[sessionId]?.successCount).toBe(1);
    expect(result.current.sessions[sessionId]?.failedCount).toBe(1);
  });
});
