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
vi.mock('sharp', () => ({ default: () => ({ stats: statsMock }) }));
vi.mock('../../db/prismaClient', () => ({
  prisma: { image: { findUnique: findUniqueMock, update: updateMock } },
}));
vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const {
  proxyRangeFromName,
  resolveFrameRepresentation,
  ensureProxySupport,
  __resetRunningForTests,
} = await import('../playbackProxyService');

const DIR = '/uploads/projects/p/images/c/frames/0004';
const PNG = `${DIR}/488_nm.png`;
const CONTAINER = 'container-1';
const FRAMES = '/uploads/projects/p/images/c/frames';

/** What `fs.readdir` should report for a single frame directory. */
function inDir(...names: string[]): void {
  readdirMock.mockResolvedValue(names);
}

/**
 * A spawned converter. `lines` are the JSON rows it prints before exiting with
 * `code`; `hang` leaves it running so in-flight behaviour can be observed.
 */
function fakeConverter({
  lines = [] as unknown[],
  code = 0,
  hang = false,
} = {}) {
  return {
    stdout: {
      on: (_e: string, cb: (chunk: string) => void) => {
        if (lines.length) cb(lines.map(l => JSON.stringify(l)).join('\n'));
      },
    },
    stderr: { on: vi.fn() },
    on: (event: string, cb: (arg?: unknown) => void) => {
      if (event === 'close' && !hang) queueMicrotask(() => cb(code));
    },
  };
}

/** Let the fire-and-forget work inside ensureProxySupport settle. */
const settle = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
  __resetRunningForTests();
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
  spawnMock.mockReset().mockImplementation(() => fakeConverter());
  statsMock.mockReset().mockResolvedValue({ channels: [{ max: 1566 }] });
  findUniqueMock.mockReset().mockResolvedValue({
    channels: [{ name: '488_nm' }, { name: '640_nm' }],
  });
  updateMock.mockReset().mockResolvedValue({});
});

describe('proxyRangeFromName', () => {
  it('reads the range a proxy was mapped against', () => {
    expect(proxyRangeFromName('488_nm.p2047.v2.webp', '488_nm')).toBe(2047);
  });

  it('ignores the original and unrelated files', () => {
    expect(proxyRangeFromName('488_nm.png', '488_nm')).toBeNull();
    expect(
      proxyRangeFromName('488_nm.p2047.v2.webp.partial', '488_nm')
    ).toBeNull();
  });

  it('rejects a v1 proxy so the frame is re-encoded', () => {
    // v1 encoded against the peak rounded UP to a power of two, and the range
    // in the name cannot tell the schemes apart: `p2047` is both a v1 file for
    // a peak of 1566 and an ordinary v2 peak. Without the marker the 6 838
    // proxies already on disk would be served forever and the encoding change
    // would do nothing at all.
    expect(proxyRangeFromName('488_nm.p2047.webp', '488_nm')).toBeNull();
    expect(proxyRangeFromName('488_nm.p2047.v2.webp', '488_nm')).toBe(2047);
  });

  it('does not accept a channel whose name merely starts the same', () => {
    // `488_nm` must not claim `488_nm_extra`'s proxy, or a two-channel
    // container would draw one channel with the other's pixels.
    expect(proxyRangeFromName('488_nm_extra.p2047.v2.webp', '488_nm')).toBeNull();
    expect(proxyRangeFromName('488_nm_extra.p2047.v2.webp', '488_nm_extra')).toBe(
      2047
    );
  });

  it('refuses a name whose range is not a positive number', () => {
    expect(proxyRangeFromName('488_nm.pXX.webp', '488_nm')).toBeNull();
    expect(proxyRangeFromName('488_nm.p0.v2.webp', '488_nm')).toBeNull();
    expect(proxyRangeFromName('488_nm.p.v2.webp', '488_nm')).toBeNull();
  });
});

describe('resolveFrameRepresentation', () => {
  it('serves the original when no proxy was asked for, even though one exists', async () => {
    // Export and measurement ask with wantProxy=false and must always get full
    // depth — the existence of a proxy must never change what they receive.
    inDir('488_nm.png', '488_nm.p2047.v2.webp');

    expect(await resolveFrameRepresentation(PNG, false)).toEqual({
      kind: 'png',
      path: PNG,
      contentType: 'image/png',
    });
    expect(readdirMock).not.toHaveBeenCalled();
  });

  it('serves the proxy and the range it was mapped against', async () => {
    inDir('488_nm.png', '640_nm.png', '488_nm.p2047.v2.webp');

    expect(await resolveFrameRepresentation(PNG, true)).toEqual({
      kind: 'proxy',
      path: `${DIR}/488_nm.p2047.v2.webp`,
      contentType: 'image/webp',
      rangeMax: 2047,
    });
  });

  it("picks THIS channel's proxy out of a directory holding several", async () => {
    inDir('488_nm.p2047.v2.webp', '640_nm.p1023.v2.webp', 'irm.p32767.v2.webp');

    const rep = await resolveFrameRepresentation(PNG, true);

    expect(rep.kind === 'proxy' && rep.rangeMax).toBe(2047);
  });

  it('falls back to the original when this frame has no proxy yet', async () => {
    inDir('488_nm.png', '640_nm.p1023.v2.webp');

    expect(await resolveFrameRepresentation(PNG, true)).toEqual({
      kind: 'png',
      path: PNG,
      contentType: 'image/png',
    });
  });

  it('falls back when the directory cannot be read at all', async () => {
    readdirMock.mockRejectedValue(new Error('ENOENT'));

    expect((await resolveFrameRepresentation(PNG, true)).kind).toBe('png');
  });
});

describe('ensureProxySupport', () => {
  it('seeds the range WITHOUT converting when no proxy was asked for', async () => {
    // The bootstrap fix. The client only asks for a proxy once a range is
    // stored, so if seeding needed a proxy request the feature could never
    // start on any container — which is exactly what shipped.
    ensureProxySupport(CONTAINER, '488_nm', FRAMES, { convert: false });
    await settle();

    const stored = updateMock.mock.calls[0][0].data.channels;
    expect(
      stored.every((c: { proxyRangeMax: number }) => c.proxyRangeMax === 2047)
    ).toBe(true);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('converts as well when a proxy was asked for', async () => {
    ensureProxySupport(CONTAINER, '488_nm', FRAMES, { convert: true });
    await settle();

    expect(spawnMock).toHaveBeenCalledOnce();
  });

  it('passes the converter no range — it derives one per frame', async () => {
    ensureProxySupport(CONTAINER, '488_nm', FRAMES, { convert: true });
    await settle();

    const args: string[] = spawnMock.mock.calls[0][1];
    expect(args).toContain('--channel');
    // Reintroducing --range-max would silently pin every frame to one range.
    expect(args).not.toContain('--range-max');
  });

  it('does not convert when the range cannot be derived', async () => {
    findUniqueMock.mockResolvedValue({ channels: [{ name: 'something-else' }] });

    ensureProxySupport(CONTAINER, '488_nm', FRAMES, { convert: true });
    await settle();

    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('reuses a range already stored rather than re-sampling', async () => {
    findUniqueMock.mockResolvedValue({
      channels: [{ name: '488_nm', proxyRangeMax: 4095 }],
    });

    ensureProxySupport(CONTAINER, '488_nm', FRAMES, { convert: true });
    await settle();

    expect(statsMock).not.toHaveBeenCalled();
    expect(spawnMock).toHaveBeenCalledOnce();
  });

  it('widens the stored range to the widest a frame was encoded against', async () => {
    // Three sampled frames can miss a bright one, whose proxy is then encoded
    // against more than the stored figure — which would make the client's
    // banding guard optimistic in the one direction it must not be.
    findUniqueMock.mockResolvedValue({
      channels: [{ name: '488_nm', proxyRangeMax: 2047 }],
    });
    spawnMock.mockImplementation(() =>
      fakeConverter({
        lines: [
          { frame: '0000', status: 'written', rangeMax: 2047 },
          { frame: '0001', status: 'written', rangeMax: 16383 },
        ],
      })
    );

    ensureProxySupport(CONTAINER, '488_nm', FRAMES, { convert: true });
    await settle();
    await settle();

    const stored = updateMock.mock.calls.at(-1)?.[0].data.channels;
    expect(stored[0].proxyRangeMax).toBe(16383);
  });

  it('never lowers a stored range', async () => {
    findUniqueMock.mockResolvedValue({
      channels: [{ name: '488_nm', proxyRangeMax: 32767 }],
    });
    spawnMock.mockImplementation(() =>
      fakeConverter({
        lines: [{ frame: '0000', status: 'written', rangeMax: 1023 }],
      })
    );

    ensureProxySupport(CONTAINER, '488_nm', FRAMES, { convert: true });
    await settle();
    await settle();

    const stored = updateMock.mock.calls.at(-1)?.[0].data.channels;
    expect(stored[0].proxyRangeMax).toBe(32767);
  });

  it('runs one batch per channel however many frames ask for it', async () => {
    // At ten frame requests a second during the first playthrough, one process
    // per request would be dozens of them fighting over the same files.
    spawnMock.mockImplementation(() => fakeConverter({ hang: true }));

    ensureProxySupport(CONTAINER, '488_nm', FRAMES, { convert: true });
    await settle();
    ensureProxySupport(CONTAINER, '488_nm', FRAMES, { convert: true });
    ensureProxySupport(CONTAINER, '488_nm', FRAMES, { convert: true });
    await settle();

    expect(spawnMock).toHaveBeenCalledOnce();
  });

  it('treats a different channel of the same container as its own batch', async () => {
    spawnMock.mockImplementation(() => fakeConverter({ hang: true }));

    ensureProxySupport(CONTAINER, '488_nm', FRAMES, { convert: true });
    ensureProxySupport(CONTAINER, '640_nm', FRAMES, { convert: true });
    await settle();

    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a failed container on the next frame request', async () => {
    // Otherwise a container whose range is underivable is retried at playback
    // rate — ~20 database reads, directory listings and log lines a second,
    // for a condition that never changes on its own.
    findUniqueMock.mockResolvedValue({ channels: [{ name: 'something-else' }] });

    ensureProxySupport(CONTAINER, '488_nm', FRAMES, { convert: true });
    await settle();
    const afterFirst = findUniqueMock.mock.calls.length;

    ensureProxySupport(CONTAINER, '488_nm', FRAMES, { convert: true });
    ensureProxySupport(CONTAINER, '488_nm', FRAMES, { convert: true });
    await settle();

    expect(findUniqueMock.mock.calls.length).toBe(afterFirst);
  });

  it('releases the slot after a success, so the next request can resume a partial batch', async () => {
    ensureProxySupport(CONTAINER, '488_nm', FRAMES, { convert: true });
    await settle();
    ensureProxySupport(CONTAINER, '488_nm', FRAMES, { convert: true });
    await settle();

    expect(spawnMock).toHaveBeenCalledTimes(2);
  });
});
