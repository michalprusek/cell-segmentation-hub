/**
 * Behavioural test for the file-split routing added to UploadContext in
 * the microtubule + video PR.
 *
 * The contract this test pins down:
 *
 *  - Any file whose MIME starts with ``video/`` or whose extension is in
 *    the video set (``.mp4|.avi|.mov|.mkv|.webm|.nd2``) is sent to
 *    ``apiClient.uploadVideo`` SEQUENTIALLY, one POST per file.
 *  - Everything else takes the existing image path (``uploadImages``)
 *    AS A BATCH.
 *  - Mixed batches produce one combined session card; the upload
 *    progresses through both paths and the toast tally counts both.
 *  - axios.isCancel(err) on a video upload does not inflate the failed
 *    counter (no toast.error spawn from a user-initiated abort).
 *
 * The test uses minimal mocks of the API client + the WebSocket and
 * sonner; it doesn't try to assert the toast UI itself, just that the
 * right side-effects fire in the right order.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React, { ReactNode } from 'react';
import { UploadProvider } from '@/contexts/UploadContext';
import { useUpload } from '@/contexts/useUpload';

// --- mocks -------------------------------------------------------------
//
// vi.mock is hoisted to the top of the file by Vitest, so any locals it
// references must be hoisted too. vi.hoisted() does exactly that.

const { uploadImagesMock, uploadImagesChunkedMock, uploadVideoMock } =
  vi.hoisted(() => ({
    uploadImagesMock: vi.fn(),
    uploadImagesChunkedMock: vi.fn(),
    uploadVideoMock: vi.fn(),
  }));

vi.mock('@/lib/api', () => ({
  default: {
    uploadImages: uploadImagesMock,
    uploadImagesChunked: uploadImagesChunkedMock,
    uploadVideo: uploadVideoMock,
  },
}));

vi.mock('@/contexts/useWebSocket', () => ({
  useWebSocket: () => ({ socket: null }),
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

// Inline shim for axios so isCancel can be controlled per-test.
vi.mock('axios', () => ({
  default: {
    isCancel: (e: unknown) => Boolean((e as { __cancel?: boolean })?.__cancel),
  },
}));

// --- helpers -----------------------------------------------------------

const wrapper = ({ children }: { children: ReactNode }) => (
  <UploadProvider>{children}</UploadProvider>
);

function makeFile(name: string, type = ''): File {
  return new File(['payload'], name, { type });
}

/** Wait for the session matching ``predicate`` to reach a terminal status. */
async function waitForTerminalSession(
  getSessions: () => Record<string, { status: string }>,
  predicate: (s: { status: string }) => boolean
): Promise<{ status: string }> {
  for (let i = 0; i < 200; i++) {
    const sessions = getSessions();
    const session = Object.values(sessions).find(predicate);
    if (session && session.status !== 'uploading') return session;
    await new Promise(r => setTimeout(r, 10));
  }
  throw new Error('session never reached terminal status');
}

describe('UploadContext file-split routing', () => {
  beforeEach(() => {
    uploadImagesMock.mockReset();
    uploadImagesChunkedMock.mockReset();
    uploadVideoMock.mockReset();
  });

  it('routes a .mp4 to uploadVideo, not uploadImages', async () => {
    uploadVideoMock.mockResolvedValue({
      videoContainerId: 'c-1',
      frameCount: 5,
      channels: [],
    });
    const { result } = renderHook(() => useUpload(), { wrapper });
    await act(async () => {
      result.current.startUpload('proj-1', [makeFile('clip.mp4', 'video/mp4')]);
    });
    await waitForTerminalSession(
      () => result.current.sessions,
      s => s !== null
    );
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
    await waitForTerminalSession(
      () => result.current.sessions,
      s => s !== null
    );
    expect(uploadVideoMock).toHaveBeenCalledTimes(1);
    expect(uploadImagesMock).not.toHaveBeenCalled();
  });

  it('splits a mixed batch: videos serial via uploadVideo, images via the image path', async () => {
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
    await waitForTerminalSession(
      () => result.current.sessions,
      s => s !== null
    );
    // Exactly one POST per video, exactly one call to the image bulk path.
    expect(uploadVideoMock).toHaveBeenCalledTimes(1);
    expect(uploadImagesMock).toHaveBeenCalledTimes(1);
    // The image bulk call must have received only the two non-video files.
    const imageBatch = uploadImagesMock.mock.calls[0][1] as File[];
    expect(imageBatch.map(f => f.name).sort()).toEqual(['a.jpg', 'c.png']);
  });

  it('uploads multiple videos sequentially (preserves the 1-stream-per-WiFi rule)', async () => {
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
        makeFile('v1.mp4', 'video/mp4'),
        makeFile('v2.mp4', 'video/mp4'),
        makeFile('v3.mp4', 'video/mp4'),
      ]);
    });
    await waitForTerminalSession(
      () => result.current.sessions,
      s => s !== null
    );
    expect(uploadVideoMock).toHaveBeenCalledTimes(3);
    expect(maxConcurrent).toBe(1);
  });

  it('does not count a user-cancelled video upload as a failure', async () => {
    // First file succeeds, second is cancelled, third is never attempted
    // because the loop breaks on cancel.
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
      result.current.startUpload('proj-5', [
        makeFile('v1.mp4', 'video/mp4'),
        makeFile('v2.mp4', 'video/mp4'),
        makeFile('v3.mp4', 'video/mp4'),
      ]);
    });
    const final = await waitForTerminalSession(
      () => result.current.sessions,
      s => s !== null
    );
    // 1 success, 0 failures (cancel breaks the loop), v3 never attempted.
    expect(uploadVideoMock).toHaveBeenCalledTimes(2);
    expect(final.status).toBe('completed');
  });
});
