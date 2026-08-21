import { describe, it, expect, vi, beforeEach } from 'vitest';

// The suite mocks `fs/promises` globally, so reach the module the way the
// videoController tests do rather than touching a real directory.
const { accessMock } = vi.hoisted(() => ({ accessMock: vi.fn() }));
vi.mock('fs/promises', () => ({
  default: { access: accessMock },
  access: accessMock,
}));
vi.mock('../../db/prismaClient', () => ({
  prisma: { image: { findUnique: vi.fn(), update: vi.fn() } },
}));
vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const {
  proxyPathForPng,
  resolveFrameRepresentation,
} = await import('../playbackProxyService');

const PNG = '/uploads/projects/p/images/c/frames/0004/488_nm.png';
const WEBP = '/uploads/projects/p/images/c/frames/0004/488_nm.webp';

/** Make `fs.access` succeed for exactly these paths. */
function onDisk(...paths: string[]): void {
  accessMock.mockImplementation((p: string) =>
    paths.includes(p) ? Promise.resolve() : Promise.reject(new Error('ENOENT'))
  );
}

beforeEach(() => {
  accessMock.mockReset();
});

describe('proxyPathForPng', () => {
  it('puts the proxy beside the frame it stands for', () => {
    expect(proxyPathForPng(PNG)).toBe(WEBP);
  });

  it('rewrites only the extension, not a channel name containing it', () => {
    expect(proxyPathForPng('/u/frames/0004/png_channel.png')).toBe(
      '/u/frames/0004/png_channel.webp'
    );
  });

  it('is case-insensitive about the extension', () => {
    expect(proxyPathForPng('/u/frames/0004/irm.PNG')).toBe(
      '/u/frames/0004/irm.webp'
    );
  });
});

describe('resolveFrameRepresentation', () => {
  it('serves the original when no proxy was asked for, even though one exists', async () => {
    // Export and measurement ask with wantProxy=false and must always get full
    // depth — the existence of a proxy must never change what they receive.
    onDisk(PNG, WEBP);

    expect(await resolveFrameRepresentation(PNG, false)).toEqual({
      path: PNG,
      contentType: 'image/png',
      isProxy: false,
    });
  });

  it('serves the proxy when one has been built', async () => {
    onDisk(PNG, WEBP);

    expect(await resolveFrameRepresentation(PNG, true)).toEqual({
      path: WEBP,
      contentType: 'image/webp',
      isProxy: true,
    });
  });

  it('falls back to the original when the proxy is not there', async () => {
    // Covers both "batch has not reached this frame" and "the converter
    // refused it as over-range" — indistinguishable on disk, and the same
    // correct answer either way.
    onDisk(PNG);

    expect(await resolveFrameRepresentation(PNG, true)).toEqual({
      path: PNG,
      contentType: 'image/png',
      isProxy: false,
    });
  });

  it('does not stat anything when the caller does not want a proxy', async () => {
    onDisk(PNG, WEBP);

    await resolveFrameRepresentation(PNG, false);

    expect(accessMock).not.toHaveBeenCalled();
  });
});
