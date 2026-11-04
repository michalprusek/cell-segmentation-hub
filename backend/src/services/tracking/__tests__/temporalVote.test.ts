/**
 * The microtubule temporal vote replaces geometry, so what it may touch is the
 * point of these tests: only frames the queue noted, only interior frames with
 * two microtubule neighbours, never a row that changed, never twice, and the
 * neighbours read before anything is written (one pass, as measured).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  imageFindMany,
  segmentationUpdateMany,
  axiosPost,
  getBuffer,
  generateAllThumbnails,
  configMock,
} = vi.hoisted(() => ({
  imageFindMany: vi.fn(),
  segmentationUpdateMany: vi.fn(),
  axiosPost: vi.fn(),
  getBuffer: vi.fn(),
  generateAllThumbnails: vi.fn(),
  configMock: {
    SEGMENTATION_SERVICE_URL: 'http://ml:8000',
    MT_TEMPORAL_VOTE: 'on' as 'on' | 'off',
  },
}));

vi.mock('../../../db/prismaClient', () => ({
  prisma: {
    image: { findMany: imageFindMany },
    segmentation: { updateMany: segmentationUpdateMany },
  },
}));
vi.mock('axios', () => ({ default: { post: axiosPost } }));
vi.mock('../../../utils/config', () => ({ config: configMock }));
vi.mock('../../../utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../../storage/index', () => ({
  getStorageProvider: () => ({ getBuffer }),
}));
// A class, not vi.fn(): the vitest config restores mock implementations
// between tests, and the module keeps the one instance it built.
vi.mock('../../thumbnailManager', () => ({
  ThumbnailManager: class {
    generateAllThumbnails = generateAllThumbnails;
  },
}));

import {
  freshFrameCount,
  noteFreshFrame,
  runTemporalVote,
} from '../temporalVote';

const WRITTEN = new Date('2026-11-04T20:00:00.000Z');

const curve = (k: number) => [
  { x: 10 + k, y: 20 },
  { x: 30 + k, y: 40 },
];

function frame(i: number, model = 'microtubule', updatedAt = WRITTEN) {
  return {
    id: `img-${i}`,
    name: `video.nd2 (frame ${i})`,
    mimeType: 'image/png',
    originalPath: `projects/p/images/v/frames/${String(i).padStart(4, '0')}/IRM.png`,
    width: 1024,
    height: 1024,
    frameIndex: i,
    segmentation: {
      id: `seg-${i}`,
      model,
      updatedAt,
      polygons: JSON.stringify([
        {
          id: 'polyline_1',
          geometry: 'polyline',
          type: 'external',
          points: curve(i),
        },
      ]),
    },
  };
}

function noteAll(frames: Array<ReturnType<typeof frame>>, at = WRITTEN) {
  for (const f of frames) {
    noteFreshFrame('vid', f.id, null, at);
  }
}

/** One form field of a call to the ML service, parsed. */
function fieldOf(form: unknown, name: string): unknown {
  const text = (form as { getBuffer(): Buffer }).getBuffer().toString('latin1');
  const m = new RegExp(
    `name="${name}"; filename="${name}\\.json"\\r\\nContent-Type: application/json\\r\\n\\r\\n([^\\r]*)`
  ).exec(text);
  return m ? JSON.parse(m[1]) : undefined;
}

/** The curve fields of the i-th ML call. */
function sent(call: number): Record<string, unknown> {
  const form = axiosPost.mock.calls[call][1];
  return {
    previous: fieldOf(form, 'previous'),
    current: fieldOf(form, 'current'),
    following: fieldOf(form, 'following'),
  };
}

const voted = (changed: boolean) => ({
  data: {
    applied: true,
    reason: null,
    changed,
    polylines: changed
      ? [
          {
            id: 'polyline_1',
            geometry: 'polyline',
            type: 'external',
            class: 'microtubule',
            instanceId: 'mt_abc',
            confidence: 1,
            points: [
              { x: 1, y: 2 },
              { x: 3, y: 4 },
            ],
          },
        ]
      : [],
  },
});

describe('runTemporalVote', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configMock.MT_TEMPORAL_VOTE = 'on';
    getBuffer.mockResolvedValue(Buffer.from('png'));
    segmentationUpdateMany.mockResolvedValue({ count: 1 });
    generateAllThumbnails.mockResolvedValue(undefined);
  });

  it('votes the interior frames and writes only a changed one, in the stored shape', async () => {
    const frames = [0, 1, 2, 3].map(i => frame(i));
    imageFindMany.mockResolvedValue(frames);
    noteAll(frames);
    // the vote moves frame 1 only
    axiosPost.mockImplementation(async (_url: string, form: unknown) =>
      voted(
        JSON.stringify(fieldOf(form, 'current')) ===
          JSON.stringify([[[11, 20], [31, 40]]])
      )
    );

    const summary = await runTemporalVote('vid');

    expect(axiosPost).toHaveBeenCalledTimes(2);
    expect(axiosPost.mock.calls[0][0]).toBe(
      'http://ml:8000/api/v1/microtubule/temporal-vote'
    );
    expect(summary).toMatchObject({ noted: 4, requested: 2, changed: 1 });
    expect(summary?.skipped).toEqual({ no_two_neighbours: 2, unchanged: 1 });
    expect(segmentationUpdateMany).toHaveBeenCalledTimes(1);
    const write = segmentationUpdateMany.mock.calls[0][0];
    expect(write.where).toEqual({ id: 'seg-1', updatedAt: WRITTEN });
    expect(JSON.parse(write.data.polygons)).toEqual([
      expect.objectContaining({ id: 'polyline_1', area: 0, confidence: 1 }),
    ]);
    expect(generateAllThumbnails).toHaveBeenCalledWith('seg-1');
    // every frame's file is the one the queue read: no channel was noted
    expect(getBuffer).toHaveBeenCalledWith(frames[1].originalPath);
  });

  it('sends each frame the per-frame curves of its neighbours, read before any write', async () => {
    const frames = [0, 1, 2, 3].map(i => frame(i));
    imageFindMany.mockResolvedValue(frames);
    noteAll(frames);
    axiosPost.mockResolvedValue(voted(true));

    await runTemporalVote('vid');

    const byCurrent = new Map(
      [0, 1].map(c => [JSON.stringify(sent(c).current), sent(c)])
    );
    const f2 = byCurrent.get(JSON.stringify([[[12, 20], [32, 40]]]));
    // frame 1 was rewritten before or during frame 2's call; frame 2 still sees its original curves
    expect(f2?.previous).toEqual([[[11, 20], [31, 40]]]);
    expect(f2?.following).toEqual([[[13, 20], [33, 40]]]);
    expect(segmentationUpdateMany).toHaveBeenCalledTimes(2);
  });

  it('consumes the notes, so a later tracker-only pass never re-votes', async () => {
    const frames = [0, 1, 2].map(i => frame(i));
    imageFindMany.mockResolvedValue(frames);
    noteAll(frames);
    axiosPost.mockResolvedValue(voted(true));

    await runTemporalVote('vid');
    expect(freshFrameCount('vid')).toBe(0);
    axiosPost.mockClear();
    expect(await runTemporalVote('vid')).toBeNull();
    expect(axiosPost).not.toHaveBeenCalled();
  });

  it('votes only noted frames whose two neighbours were noted too', async () => {
    const frames = [0, 1, 2, 3, 4].map(i => frame(i));
    imageFindMany.mockResolvedValue(frames);
    for (const i of [1, 2, 3]) {
      noteFreshFrame('vid', `img-${i}`, null, WRITTEN);
    }
    axiosPost.mockResolvedValue(voted(true));

    const summary = await runTemporalVote('vid');

    // 1 and 3 have an un-noted neighbour (0, 4), whose curves may already be voted ones
    expect(axiosPost).toHaveBeenCalledTimes(1);
    expect(sent(0).current).toEqual([[[12, 20], [32, 40]]]);
    expect(summary?.skipped).toEqual({ neighbour_not_per_frame: 2 });
  });

  it('does not let an edited neighbour vote', async () => {
    const edited = new Date('2026-11-04T20:05:00.000Z');
    const frames = [frame(0), frame(1), frame(2, 'microtubule', edited), frame(3), frame(4)];
    imageFindMany.mockResolvedValue(frames);
    noteAll(frames);
    axiosPost.mockResolvedValue(voted(true));

    const summary = await runTemporalVote('vid');

    // 1 and 3 would take 2's edited curves as a neighbour; 2 itself changed
    expect(axiosPost).not.toHaveBeenCalled();
    expect(summary?.skipped).toMatchObject({
      neighbour_not_per_frame: 2,
      changed_since_segmented: 1,
    });
  });

  it('gives up after three failures in a row instead of waiting out every frame', async () => {
    const frames = Array.from({ length: 12 }, (_, i) => frame(i));
    imageFindMany.mockResolvedValue(frames);
    noteAll(frames);
    axiosPost.mockRejectedValue(
      Object.assign(new Error('Internal Server Error'), {
        response: { status: 500 },
      })
    );

    const summary = await runTemporalVote('vid');

    expect(axiosPost.mock.calls.length).toBeLessThanOrEqual(4);
    expect(summary?.skipped.gave_up).toBeGreaterThanOrEqual(6);
  });

  it('skips a frame whose row changed after the queue wrote it', async () => {
    const edited = new Date('2026-11-04T20:05:00.000Z');
    const frames = [frame(0), frame(1, 'microtubule', edited), frame(2)];
    imageFindMany.mockResolvedValue(frames);
    noteAll(frames);

    const summary = await runTemporalVote('vid');

    expect(axiosPost).not.toHaveBeenCalled();
    expect(summary?.skipped).toMatchObject({ changed_since_segmented: 1 });
  });

  it('lets an edit made during the vote win', async () => {
    const frames = [0, 1, 2].map(i => frame(i));
    imageFindMany.mockResolvedValue(frames);
    noteAll(frames);
    axiosPost.mockResolvedValue(voted(true));
    segmentationUpdateMany.mockResolvedValue({ count: 0 });

    const summary = await runTemporalVote('vid');

    expect(summary?.changed).toBe(0);
    expect(summary?.skipped).toMatchObject({ changed_during_vote: 1 });
    expect(generateAllThumbnails).not.toHaveBeenCalled();
  });

  it('writes nothing when the ML service refuses the frame', async () => {
    const frames = [0, 1, 2].map(i => frame(i));
    imageFindMany.mockResolvedValue(frames);
    noteAll(frames);
    axiosPost.mockResolvedValue({
      data: { applied: false, reason: 'not_per_frame', changed: false, polylines: [] },
    });

    const summary = await runTemporalVote('vid');

    expect(segmentationUpdateMany).not.toHaveBeenCalled();
    expect(summary?.skipped).toMatchObject({ not_per_frame: 1 });
  });

  it('needs two microtubule neighbours', async () => {
    const frames = [frame(0), frame(1), frame(2, 'hrnet'), frame(3), frame(4)];
    imageFindMany.mockResolvedValue(frames);
    noteAll(frames);
    axiosPost.mockResolvedValue(voted(true));

    await runTemporalVote('vid');

    // 1 has no microtubule t+1, 2 is not microtubule, 3 has no microtubule t-1; 0 and 4 are ends
    expect(axiosPost).not.toHaveBeenCalled();
  });

  it('stops asking an ML image that has no such route', async () => {
    const frames = [0, 1, 2, 3, 4, 5, 6, 7].map(i => frame(i));
    imageFindMany.mockResolvedValue(frames);
    noteAll(frames);
    axiosPost.mockRejectedValue(
      Object.assign(new Error('Not Found'), { response: { status: 404 } })
    );

    const summary = await runTemporalVote('vid');

    // at most the two calls already in flight when the first 404 came back
    expect(axiosPost.mock.calls.length).toBeLessThanOrEqual(2);
    expect(summary?.skipped.route_missing).toBeGreaterThanOrEqual(5);
    expect(segmentationUpdateMany).not.toHaveBeenCalled();
  });

  it('keeps the per-frame curves of a frame whose call fails, and goes on', async () => {
    const frames = [0, 1, 2, 3].map(i => frame(i));
    imageFindMany.mockResolvedValue(frames);
    noteAll(frames);
    axiosPost
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce(voted(true));

    const summary = await runTemporalVote('vid');

    expect(summary?.skipped).toMatchObject({ error: 1 });
    expect(summary?.changed).toBe(1);
  });

  it('reads the channel the queue segmented', async () => {
    const frames = [0, 1, 2].map(i => frame(i));
    imageFindMany.mockResolvedValue(frames);
    noteFreshFrame('vid', 'img-0', '640_nm', WRITTEN);
    noteFreshFrame('vid', 'img-1', '640_nm', WRITTEN);
    noteFreshFrame('vid', 'img-2', '640_nm', WRITTEN);
    axiosPost.mockResolvedValue(voted(false));

    await runTemporalVote('vid');

    expect(getBuffer).toHaveBeenCalledWith(
      'projects/p/images/v/frames/0001/640_nm.png'
    );
  });

  it('does nothing, and forgets the notes, when MT_TEMPORAL_VOTE is off', async () => {
    configMock.MT_TEMPORAL_VOTE = 'off';
    const frames = [0, 1, 2].map(i => frame(i));
    imageFindMany.mockResolvedValue(frames);
    noteAll(frames);

    expect(await runTemporalVote('vid')).toBeNull();
    expect(imageFindMany).not.toHaveBeenCalled();
    expect(axiosPost).not.toHaveBeenCalled();
    expect(freshFrameCount('vid')).toBe(0);
  });
});
