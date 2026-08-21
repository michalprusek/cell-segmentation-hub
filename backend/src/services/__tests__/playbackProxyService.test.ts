import { describe, it, expect, vi, beforeEach } from 'vitest';

// The suite mocks `fs/promises` globally, so reach the module the way the
// videoController tests do rather than touching a real directory.
const { readdirMock } = vi.hoisted(() => ({ readdirMock: vi.fn() }));
vi.mock('fs/promises', () => ({
  default: { readdir: readdirMock },
  readdir: readdirMock,
}));
vi.mock('../../db/prismaClient', () => ({
  prisma: { image: { findUnique: vi.fn(), update: vi.fn() } },
}));
vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { proxyRangeFromName, resolveFrameRepresentation } = await import(
  '../playbackProxyService'
);

const DIR = '/uploads/projects/p/images/c/frames/0004';
const PNG = `${DIR}/488_nm.png`;

/** What `fs.readdir` should report for the frame directory. */
function inDir(...names: string[]): void {
  readdirMock.mockResolvedValue(names);
}

beforeEach(() => {
  readdirMock.mockReset();
});

describe('proxyRangeFromName', () => {
  it('reads the range a proxy was mapped against', () => {
    expect(proxyRangeFromName('488_nm.p2047.webp', '488_nm')).toBe(2047);
  });

  it('ignores the original and unrelated files', () => {
    expect(proxyRangeFromName('488_nm.png', '488_nm')).toBeNull();
    expect(proxyRangeFromName('488_nm.p2047.webp.partial', '488_nm')).toBeNull();
  });

  it('does not accept a channel whose name merely starts the same', () => {
    // `488_nm` must not claim `488_nm_extra`'s proxy, or a two-channel
    // container would draw one channel with the other's pixels.
    expect(proxyRangeFromName('488_nm_extra.p2047.webp', '488_nm')).toBeNull();
    expect(
      proxyRangeFromName('488_nm_extra.p2047.webp', '488_nm_extra')
    ).toBe(2047);
  });

  it('refuses a name whose range is not a positive number', () => {
    expect(proxyRangeFromName('488_nm.pXX.webp', '488_nm')).toBeNull();
    expect(proxyRangeFromName('488_nm.p0.webp', '488_nm')).toBeNull();
    expect(proxyRangeFromName('488_nm.p.webp', '488_nm')).toBeNull();
  });
});

describe('resolveFrameRepresentation', () => {
  it('serves the original when no proxy was asked for, even though one exists', async () => {
    // Export and measurement ask with wantProxy=false and must always get full
    // depth — the existence of a proxy must never change what they receive.
    inDir('488_nm.png', '488_nm.p2047.webp');

    expect(await resolveFrameRepresentation(PNG, false)).toEqual({
      path: PNG,
      contentType: 'image/png',
      isProxy: false,
      rangeMax: null,
    });
    expect(readdirMock).not.toHaveBeenCalled();
  });

  it('serves the proxy and the range it was mapped against', async () => {
    inDir('488_nm.png', '640_nm.png', '488_nm.p2047.webp');

    expect(await resolveFrameRepresentation(PNG, true)).toEqual({
      path: `${DIR}/488_nm.p2047.webp`,
      contentType: 'image/webp',
      isProxy: true,
      rangeMax: 2047,
    });
  });

  it('picks THIS channel\'s proxy out of a directory holding several', async () => {
    inDir('488_nm.p2047.webp', '640_nm.p1023.webp', 'irm.p32767.webp');

    const rep = await resolveFrameRepresentation(PNG, true);

    expect(rep.rangeMax).toBe(2047);
  });

  it('falls back to the original when this frame has no proxy yet', async () => {
    inDir('488_nm.png', '640_nm.p1023.webp');

    const rep = await resolveFrameRepresentation(PNG, true);

    expect(rep.isProxy).toBe(false);
    expect(rep.path).toBe(PNG);
    expect(rep.rangeMax).toBeNull();
  });

  it('falls back when the directory cannot be read at all', async () => {
    readdirMock.mockRejectedValue(new Error('ENOENT'));

    expect((await resolveFrameRepresentation(PNG, true)).isProxy).toBe(false);
  });
});
