import { describe, it, expect, beforeEach, vi } from 'vitest';

// Hoisted mocks so the service pulls in test doubles for its IO deps.
vi.mock('../../db/prismaClient', () => ({
  prisma: {
    project: { findUnique: vi.fn() },
    image: { findMany: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock('../../utils/config', () => ({ config: { UPLOAD_DIR: '/app/uploads' } }));
vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  copyFile: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('sharp', () => ({
  default: vi.fn(() => ({
    metadata: vi.fn().mockResolvedValue({ width: 512, height: 512 }),
    grayscale: vi.fn().mockReturnThis(),
    png: vi.fn().mockReturnThis(),
    toFile: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock('../video/videoExtractor', () => ({
  detectVideoKind: vi.fn(),
  extractVideoSafe: vi.fn(),
}));
vi.mock('../video/pythonExtractor', () => ({ alignChannelFrames: vi.fn() }));
vi.mock('../videoUploadService', () => ({
  frameStorageKey: vi.fn(
    (pid: string, cid: string, i: number, name: string) =>
      `projects/${pid}/images/${cid}/frames/${String(i).padStart(4, '0')}/${name}.png`
  ),
}));

import {
  addChannelToFrames,
  slugifyChannelName,
  uniqueName,
} from '../addChannelService';
import { prisma } from '../../db/prismaClient';
import { detectVideoKind, extractVideoSafe } from '../video/videoExtractor';

const mockProject = prisma.project.findUnique as ReturnType<typeof vi.fn>;
const mockImageFindMany = prisma.image.findMany as ReturnType<typeof vi.fn>;
const mockDetectKind = detectVideoKind as ReturnType<typeof vi.fn>;
const mockExtract = extractVideoSafe as ReturnType<typeof vi.fn>;

const baseParams = {
  projectId: 'p1',
  originalName: 'ref.png',
  tempFilePath: '/tmp/x.png',
  channelName: 'GFP',
  align: false,
  imageIds: ['f1', 'f2'],
};

describe('slugifyChannelName', () => {
  it('keeps a path-safe name', () => {
    expect(slugifyChannelName('GFP_640')).toBe('GFP_640');
  });
  it('replaces runs of unsafe chars with a single underscore', () => {
    expect(slugifyChannelName('  GFP 640 nm! ')).toBe('GFP_640_nm');
  });
  it('throws when nothing usable remains', () => {
    expect(() => slugifyChannelName('   ')).toThrow();
    expect(() => slugifyChannelName('!!!')).toThrow();
  });
  it('truncates to 64 chars', () => {
    expect(slugifyChannelName('a'.repeat(200))).toHaveLength(64);
  });
});

describe('uniqueName', () => {
  it('returns the base when free', () => {
    expect(uniqueName('GFP', new Set())).toBe('GFP');
  });
  it('suffixes on collision', () => {
    expect(uniqueName('GFP', new Set(['GFP']))).toBe('GFP_2');
    expect(uniqueName('GFP', new Set(['GFP', 'GFP_2']))).toBe('GFP_3');
  });
});

describe('addChannelToFrames validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a non-microtubule project', async () => {
    mockProject.mockResolvedValue({ type: 'spheroid' });
    await expect(addChannelToFrames(baseParams)).rejects.toThrow(/microtubule/i);
  });

  it('rejects an empty selection', async () => {
    mockProject.mockResolvedValue({ type: 'microtubules' });
    await expect(
      addChannelToFrames({ ...baseParams, imageIds: [] })
    ).rejects.toThrow(/No images selected/i);
  });

  it('rejects a selection with no video frames', async () => {
    mockProject.mockResolvedValue({ type: 'microtubules' });
    mockImageFindMany.mockResolvedValueOnce([
      { id: 'f1', parentVideoId: null, frameIndex: null, isVideoContainer: false },
    ]);
    await expect(addChannelToFrames(baseParams)).rejects.toThrow(
      /video frames/i
    );
  });

  it('rejects a dimension mismatch', async () => {
    mockProject.mockResolvedValue({ type: 'microtubules' });
    mockDetectKind.mockReturnValue(null); // single image path → 512x512 (sharp mock)
    mockImageFindMany
      .mockResolvedValueOnce([
        { id: 'f1', parentVideoId: 'c1', frameIndex: 0, isVideoContainer: false },
        { id: 'f2', parentVideoId: 'c1', frameIndex: 1, isVideoContainer: false },
      ])
      .mockResolvedValueOnce([
        { id: 'c1', channels: [], width: 1024, height: 1024, frameCount: 5 },
      ]);
    await expect(addChannelToFrames(baseParams)).rejects.toThrow(
      /Dimension mismatch/i
    );
  });

  it('rejects a multi-frame source spanning multiple videos', async () => {
    mockProject.mockResolvedValue({ type: 'microtubules' });
    mockDetectKind.mockReturnValue('tiff-stack');
    mockExtract.mockResolvedValue({
      kind: 'single',
      result: {
        frameCount: 2,
        width: 512,
        height: 512,
        channels: [{ name: 'c0', type: 'fluorescent', isSegmentationSource: false }],
      },
    });
    mockImageFindMany.mockResolvedValueOnce([
      { id: 'f1', parentVideoId: 'c1', frameIndex: 0, isVideoContainer: false },
      { id: 'f2', parentVideoId: 'c2', frameIndex: 0, isVideoContainer: false },
    ]);
    await expect(addChannelToFrames(baseParams)).rejects.toThrow(
      /single video/i
    );
  });

  it('adds a single-image channel to the selected frames (partial coverage)', async () => {
    mockProject.mockResolvedValue({ type: 'microtubules' });
    mockDetectKind.mockReturnValue(null); // image path
    mockImageFindMany
      .mockResolvedValueOnce([
        { id: 'f1', parentVideoId: 'c1', frameIndex: 0, isVideoContainer: false },
        { id: 'f2', parentVideoId: 'c1', frameIndex: 1, isVideoContainer: false },
      ])
      .mockResolvedValueOnce([
        {
          id: 'c1',
          channels: [
            { name: 'irm', type: 'irm', isSegmentationSource: true },
          ],
          width: 512,
          height: 512,
          frameCount: 5, // selection (2) < frameCount → partial coverage
        },
      ]);

    const result = await addChannelToFrames(baseParams);

    expect(result.addedChannels).toEqual(['GFP']);
    expect(result.affectedContainerIds).toEqual(['c1']);
    expect(result.framesWritten).toBe(2);
    // Channel appended with pngBacked + partial-coverage frameIds.
    const updateArg = (prisma.image.update as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    const added = updateArg.data.channels.at(-1);
    expect(added).toMatchObject({
      name: 'GFP',
      pngBacked: true,
      isSegmentationSource: false,
    });
    expect(added.frameIds).toEqual(['f1', 'f2']);
  });
});
