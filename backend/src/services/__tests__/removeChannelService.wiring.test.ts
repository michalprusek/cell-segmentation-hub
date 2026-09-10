/**
 * `removeChannelFromFrames` — the wiring around `applyChannelRemoval`.
 *
 * The arithmetic is covered next door. What is covered HERE is everything that
 * decides which arguments reach it and what happens to the answer: that the
 * container's OWN frame list (not the selection) is what "full coverage"
 * is measured against, that the deleted paths are the ones the add path wrote,
 * that the playback proxies go with the PNG, and that an untouched container
 * is not written at all.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// `vi.mock` is hoisted above every `const` in the file, so the factory cannot
// close over a plain one — `vi.hoisted` is what lifts the object with it.
const prismaMock = vi.hoisted(() => ({
  project: { findUnique: vi.fn() },
  image: { findMany: vi.fn(), update: vi.fn() },
}));
vi.mock('../../db/prismaClient', () => ({ prisma: prismaMock }));
vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../utils/config', () => ({ config: { UPLOAD_DIR: '/uploads' } }));

const { rm, readdir } = vi.hoisted(() => ({
  rm: vi.fn(),
  readdir: vi.fn(),
}));
vi.mock('fs/promises', () => ({
  default: { rm: (...a: unknown[]) => rm(...a), readdir: (...a: unknown[]) => readdir(...a) },
  rm: (...a: unknown[]) => rm(...a),
  readdir: (...a: unknown[]) => readdir(...a),
}));

import { removeChannelFromFrames } from '../removeChannelService';

const CONTAINER = 'vid1';
function frame(id: string, frameIndex: number) {
  return { id, frameIndex, parentVideoId: CONTAINER, isVideoContainer: false };
}

beforeEach(() => {
  vi.clearAllMocks();
  rm.mockResolvedValue(undefined);
  readdir.mockResolvedValue([]);
  prismaMock.project.findUnique.mockResolvedValue({ id: 'p1', type: 'microtubules' });
  prismaMock.image.update.mockResolvedValue({});
});

/** findMany is called twice: selected frames, then the container rows, then
 *  each container's full frame list. Drive it by call order. */
function setupFindMany(opts: {
  selected: ReturnType<typeof frame>[];
  channels: unknown[];
  allFrames: ReturnType<typeof frame>[];
}) {
  prismaMock.image.findMany
    .mockResolvedValueOnce(opts.selected)
    .mockResolvedValueOnce([{ id: CONTAINER, channels: opts.channels }])
    .mockResolvedValueOnce(
      opts.allFrames.map(f => ({ ...f, originalPath: null }))
    );
}

/** A second channel that survives every removal below. Without one, the
 *  service refuses — stripping a frame of its last channel is frame deletion,
 *  not channel removal. The single-channel case has its own test. */
const SURVIVOR = {
  name: 'base',
  type: 'irm',
  isSegmentationSource: false,
};

describe('removeChannelFromFrames', () => {
  const CH = { name: 'extra', type: 'fluorescent', isSegmentationSource: false };

  it('deletes the per-frame PNG the add path wrote, at its own frameIndex', async () => {
    setupFindMany({
      selected: [frame('f2', 2)],
      channels: [SURVIVOR, CH],
      allFrames: [frame('f0', 0), frame('f1', 1), frame('f2', 2)],
    });

    const res = await removeChannelFromFrames({
      projectId: 'p1',
      channelName: 'extra',
      imageIds: ['f2'],
    });

    expect(rm).toHaveBeenCalledWith(
      '/uploads/projects/p1/images/vid1/frames/0002/extra.png',
      { force: true }
    );
    expect(res.framesAffected).toBe(1);
  });

  it('deletes the playback proxies beside the PNG', async () => {
    readdir.mockResolvedValue([
      'extra.png',
      'extra.p2047.v2.webp',
      'other.p2047.v2.webp',
      'extra_more.p9.v2.webp',
    ]);
    setupFindMany({
      selected: [frame('f0', 0)],
      channels: [SURVIVOR, CH],
      allFrames: [frame('f0', 0), frame('f1', 1)],
    });

    await removeChannelFromFrames({
      projectId: 'p1',
      channelName: 'extra',
      imageIds: ['f0'],
    });

    const deleted = rm.mock.calls.map(c => String(c[0]));
    expect(deleted).toContain('/uploads/projects/p1/images/vid1/frames/0000/extra.p2047.v2.webp');
    // A different channel's proxy, and a channel whose name merely STARTS with
    // this one's, must both survive — the dot after the name is what separates
    // them, and channel names ban dots.
    expect(deleted.some(p => p.includes('other.p2047'))).toBe(false);
    expect(deleted.some(p => p.includes('extra_more'))).toBe(false);
  });

  it('measures full coverage against the CONTAINER, not the selection', async () => {
    // One frame selected out of three: the channel must end up partial, not
    // deleted. Passing the selection as "all frames" would wipe the channel.
    setupFindMany({
      selected: [frame('f0', 0)],
      channels: [SURVIVOR, CH],
      allFrames: [frame('f0', 0), frame('f1', 1), frame('f2', 2)],
    });

    await removeChannelFromFrames({
      projectId: 'p1',
      channelName: 'extra',
      imageIds: ['f0'],
    });

    const written = prismaMock.image.update.mock.calls[0][0].data.channels;
    const extra = written.find((c: { name: string }) => c.name === 'extra');
    expect(extra.frameIds).toEqual(['f1', 'f2']);
  });

  it('does not write a container nothing changed on', async () => {
    setupFindMany({
      selected: [frame('f0', 0)],
      channels: [{ ...CH, frameIds: ['f1'] }],
      allFrames: [frame('f0', 0), frame('f1', 1)],
    });

    const res = await removeChannelFromFrames({
      projectId: 'p1',
      channelName: 'absent-from-f0',
      imageIds: ['f0'],
    });

    expect(prismaMock.image.update).not.toHaveBeenCalled();
    expect(rm).not.toHaveBeenCalled();
    expect(res.containersAffected).toBe(0);
  });

  it('reports a cleared segmentation source instead of silently dropping it', async () => {
    setupFindMany({
      selected: [frame('f0', 0)],
      channels: [SURVIVOR, { ...CH, isSegmentationSource: true }],
      allFrames: [frame('f0', 0)],
    });

    const res = await removeChannelFromFrames({
      projectId: 'p1',
      channelName: 'extra',
      imageIds: ['f0'],
    });

    expect(res.segmentationSourceCleared).toBe(true);
  });

  it('refuses a project that is not a microtubule project', async () => {
    prismaMock.project.findUnique.mockResolvedValue({ id: 'p1', type: 'spheroid' });
    await expect(
      removeChannelFromFrames({ projectId: 'p1', channelName: 'extra', imageIds: ['f0'] })
    ).rejects.toThrow(/microtubule/i);
  });
});

describe('removeChannelFromFrames — the frame row still points at the file', () => {
  const CH = { name: 'extra', type: 'fluorescent', isSegmentationSource: false };
  const OTHER = { name: 'base', type: 'irm', isSegmentationSource: true };

  it('repoints a frame whose originalPath was the removed channel', async () => {
    // The gallery renders each frame from its `originalPath`. Deleting the PNG
    // without moving that column leaves a 404 per frame — observed in a real
    // browser on 2026-09-10, which is why this test exists.
    prismaMock.image.findMany
      .mockResolvedValueOnce([
        {
          id: 'f0',
          frameIndex: 0,
          parentVideoId: CONTAINER,
          isVideoContainer: false,
        },
      ])
      .mockResolvedValueOnce([{ id: CONTAINER, channels: [OTHER, CH] }])
      .mockResolvedValueOnce([
        {
          id: 'f0',
          frameIndex: 0,
          originalPath:
            'projects/p1/images/vid1/frames/0000/extra.png',
        },
        { id: 'f1', frameIndex: 1, originalPath: null },
      ]);

    await removeChannelFromFrames({
      projectId: 'p1',
      channelName: 'extra',
      imageIds: ['f0'],
    });

    const frameWrite = prismaMock.image.update.mock.calls.find(
      c => c[0].where.id === 'f0'
    );
    expect(frameWrite).toBeDefined();
    expect(frameWrite![0].data.originalPath).toBe(
      'projects/p1/images/vid1/frames/0000/base.png'
    );
  });

  it('refuses to strip a frame of its last remaining channel', async () => {
    // Not the same axis as "which channel may go": a frame with no channels
    // left has no pixels at all, which is deleting the frame, and that is a
    // separate operation the gallery already offers.
    prismaMock.image.findMany
      .mockResolvedValueOnce([
        {
          id: 'f0',
          frameIndex: 0,
          parentVideoId: CONTAINER,
          isVideoContainer: false,
        },
      ])
      .mockResolvedValueOnce([{ id: CONTAINER, channels: [CH] }])
      .mockResolvedValueOnce([
        { id: 'f0', frameIndex: 0, originalPath: null },
      ]);

    await expect(
      removeChannelFromFrames({
        projectId: 'p1',
        channelName: 'extra',
        imageIds: ['f0'],
      })
    ).rejects.toThrow(/last|only channel/i);
    // And nothing was deleted on the way to finding out.
    expect(rm).not.toHaveBeenCalled();
  });
});
