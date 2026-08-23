import { describe, it, expect, vi, beforeEach } from 'vitest';

// The suite mocks `fs/promises` globally, so reach the module the way the
// videoController tests do rather than touching a real directory.
const { readdirMock, spawnMock, statsMock, findUniqueMock, updateMock } =
  vi.hoisted(() => ({
    readdirMock: vi.fn(),
    spawnMock: vi.fn(),
    statsMock: vi.fn(),
    findUniqueMock: vi.fn(),
    updateMock: vi.fn(),
  }));
vi.mock('fs/promises', () => ({
  default: { readdir: readdirMock },
  readdir: readdirMock,
}));
vi.mock('child_process', () => ({ spawn: spawnMock }));
vi.mock('sharp', () => ({
  default: () => ({ stats: statsMock }),
}));
vi.mock('../../db/prismaClient', () => ({
  prisma: { image: { findUnique: findUniqueMock, update: updateMock } },
}));
vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const {
  proxyRangeFromName,
  resolveFrameRepresentation,
  ensureChannelProxies,
  __resetRunningForTests,
} = await import('../playbackProxyService');

/** A spawned converter that exits cleanly with no output. */
function fakeConverter() {
  const handlers: Record<string, (arg?: unknown) => void> = {};
  return {
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: (event: string, cb: (arg?: unknown) => void) => {
      handlers[event] = cb;
      // Exit 0 on the next tick, once the caller has wired up its listeners.
      if (event === 'close') queueMicrotask(() => cb(0));
    },
    handlers,
  };
}

/** Let the fire-and-forget batch inside ensureChannelProxies settle. */
const settle = () => new Promise(r => setTimeout(r, 0));

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

describe('ensureChannelProxies', () => {
  const CONTAINER = 'container-1';
  const FRAMES = '/uploads/projects/p/images/c/frames';

  beforeEach(() => {
    __resetRunningForTests();
    spawnMock.mockReset().mockImplementation(() => fakeConverter());
    statsMock.mockReset().mockResolvedValue({ channels: [{ max: 1566 }] });
    findUniqueMock.mockReset().mockResolvedValue({
      channels: [{ name: '488_nm' }, { name: '640_nm' }],
    });
    updateMock.mockReset().mockResolvedValue({});
    // Two different callers: the range sampler asks with `withFileTypes` and
    // reads `isDirectory()`, the representation resolver asks for plain names.
    readdirMock
      .mockReset()
      .mockImplementation((_dir: string, opts?: { withFileTypes?: boolean }) =>
        Promise.resolve(
          opts?.withFileTypes
            ? ['0000', '0001', '0002'].map(name => ({
                name,
                isDirectory: () => true,
              }))
            : ['0000', '0001', '0002']
        )
      );
  });

  it('derives the container range once and runs the converter', async () => {
    ensureChannelProxies(CONTAINER, '488_nm', FRAMES);
    await settle();

    // 1566 rounds up to 2047, and it is stored on EVERY channel so any of them
    // can answer the client.
    const stored = updateMock.mock.calls[0][0].data.channels;
    expect(stored.every((c: { proxyRangeMax: number }) => c.proxyRangeMax === 2047)).toBe(true);
    expect(spawnMock).toHaveBeenCalledOnce();
  });

  it('passes the converter no range — it derives one per frame', async () => {
    ensureChannelProxies(CONTAINER, '488_nm', FRAMES);
    await settle();

    const args: string[] = spawnMock.mock.calls[0][1];
    expect(args).toContain('--channel');
    expect(args).toContain('488_nm');
    // Reintroducing --range-max would silently pin every frame to one range.
    expect(args).not.toContain('--range-max');
  });

  it('does not convert when the range cannot be derived', async () => {
    // The editor would never ask for a proxy without a range, so converting
    // would be minutes of CPU and 85 MB of disk that nothing reads.
    findUniqueMock.mockResolvedValue({ channels: [{ name: 'something-else' }] });

    ensureChannelProxies(CONTAINER, '488_nm', FRAMES);
    await settle();

    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('reuses a range already stored rather than re-sampling', async () => {
    findUniqueMock.mockResolvedValue({
      channels: [{ name: '488_nm', proxyRangeMax: 4095 }],
    });

    ensureChannelProxies(CONTAINER, '488_nm', FRAMES);
    await settle();

    expect(statsMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(spawnMock).toHaveBeenCalledOnce();
  });

  it('runs one batch per channel however many frames ask for it', async () => {
    // At ten frame requests a second during the first playthrough, one process
    // per request would be dozens of them fighting over the same files.
    spawnMock.mockImplementation(() => ({
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(), // never closes: the batch stays in flight
    }));

    ensureChannelProxies(CONTAINER, '488_nm', FRAMES);
    await settle();
    ensureChannelProxies(CONTAINER, '488_nm', FRAMES);
    ensureChannelProxies(CONTAINER, '488_nm', FRAMES);
    await settle();

    expect(spawnMock).toHaveBeenCalledOnce();
  });

  it('treats a different channel of the same container as its own batch', async () => {
    spawnMock.mockImplementation(() => ({
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
    }));

    ensureChannelProxies(CONTAINER, '488_nm', FRAMES);
    ensureChannelProxies(CONTAINER, '640_nm', FRAMES);
    await settle();

    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it('releases the in-flight slot when the batch finishes, so a retry can resume', async () => {
    // A converter killed halfway leaves some frames done; the next request has
    // to be able to pick up where it stopped rather than being locked out.
    ensureChannelProxies(CONTAINER, '488_nm', FRAMES);
    await settle();
    ensureChannelProxies(CONTAINER, '488_nm', FRAMES);
    await settle();

    expect(spawnMock).toHaveBeenCalledTimes(2);
  });
});
