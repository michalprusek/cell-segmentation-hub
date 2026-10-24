import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

vi.unmock('sharp');
vi.unmock('fs/promises');
vi.unmock('fs');

const h = vi.hoisted(() => ({
  uploadDir: '',
  prisma: { image: { findUnique: vi.fn(), findMany: vi.fn() } },
  emitToProject: vi.fn(),
}));
vi.mock('../../../db', () => ({ prisma: h.prisma }));
vi.mock('../../../utils/config', () => ({
  config: {
    get UPLOAD_DIR() {
      return h.uploadDir;
    },
  },
}));
vi.mock('../../websocketService', () => ({
  WebSocketService: { getInstance: () => ({ emitToProject: h.emitToProject }) },
}));
vi.mock('../../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// Spy on the real renderer: the suite counts renders, the pixels are real.
const renderSpy = vi.hoisted(() => ({ calls: 0, fail: false }));
vi.mock('../previewRenderer', async importOriginal => {
  const real = await importOriginal<typeof import('../previewRenderer')>();
  return {
    ...real,
    renderPreview: async (...args: Parameters<typeof real.renderPreview>) => {
      renderSpy.calls++;
      if (renderSpy.fail) throw new Error('corrupt source');
      return real.renderPreview(...args);
    },
  };
});

import sharp from 'sharp';
import { PreviewService, PreviewUnavailableError, RenderQueue } from '../previewService';
import { previewUrlFor, previewVersion } from '../previewVersion';

const PROJECT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const IMAGE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ORIGINAL = 'u/p/originals/a.png';

let root: string;
let row: {
  id: string;
  projectId: string;
  originalPath: string;
  thumbnailPath: string | null;
  mimeType: string;
  width: number;
  segmentation: { id: string; updatedAt: Date; polygons: string } | null;
};

const previewDir = () => path.join(root, 'projects', PROJECT, 'previews', IMAGE);

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'preview-svc-'));
  h.uploadDir = root;
  await fs.mkdir(path.join(root, 'u/p/originals'), { recursive: true });
  await sharp({
    create: { width: 64, height: 48, channels: 3, background: { r: 90, g: 90, b: 90 } },
  })
    .png()
    .toFile(path.join(root, ORIGINAL));
  row = {
    id: IMAGE,
    projectId: PROJECT,
    originalPath: ORIGINAL,
    thumbnailPath: null,
    mimeType: 'image/png',
    width: 64,
    segmentation: {
      id: 'seg-1',
      updatedAt: new Date('2026-10-24T10:00:00.000Z'),
      polygons: JSON.stringify([
        { id: 'p', type: 'external', points: [{ x: 5, y: 5 }, { x: 40, y: 5 }, { x: 40, y: 30 }] },
      ]),
    },
  };
  h.prisma.image.findUnique.mockImplementation(async () => row);
  renderSpy.calls = 0;
  renderSpy.fail = false;
  h.emitToProject.mockReset();
});
afterEach(async () => {
  vi.useRealTimers();
  await fs.rm(root, { recursive: true, force: true });
});

describe('PreviewService.ensurePreview', () => {
  it('renders once, then serves the stored file for the same version', async () => {
    const svc = new PreviewService();

    const first = await svc.ensurePreview(IMAGE);
    const second = await svc.ensurePreview(IMAGE);

    expect(renderSpy.calls).toBe(1);
    expect(first?.filePath).toBe(path.join(previewDir(), `${first?.version}.jpg`));
    expect(second).toEqual(first);
    expect((await sharp(first!.filePath).metadata()).format).toBe('jpeg');
  });

  it('renders ONE file however many requests arrive at once', async () => {
    const svc = new PreviewService();

    await Promise.all(Array.from({ length: 12 }, () => svc.ensurePreview(IMAGE)));

    expect(renderSpy.calls).toBe(1);
    expect(await fs.readdir(previewDir())).toHaveLength(1);
  });

  it('draws a new version after an edit and deletes the old one', async () => {
    const svc = new PreviewService();
    const before = await svc.ensurePreview(IMAGE);

    row.segmentation = { ...row.segmentation!, updatedAt: new Date('2026-10-24T10:05:00.000Z') };
    const after = await svc.ensurePreview(IMAGE);

    expect(after!.version).not.toBe(before!.version);
    expect(renderSpy.calls).toBe(2);
    expect(await fs.readdir(previewDir())).toEqual([`${after!.version}.jpg`]);
  });

  it('serves the version the listing advertises — the URLs are one and the same', async () => {
    const svc = new PreviewService();

    const served = await svc.ensurePreview(IMAGE);

    expect(previewUrlFor({ ...row, segmentation: row.segmentation })).toBe(
      `/api/images/${IMAGE}/preview?v=${served!.version}`
    );
  });

  it('a deleted segmentation is a version of its own: the bare image', async () => {
    const svc = new PreviewService();
    const withSeg = await svc.ensurePreview(IMAGE);

    row.segmentation = null;
    const bare = await svc.ensurePreview(IMAGE);

    expect(bare!.version).toBe(previewVersion({ originalPath: ORIGINAL, segmentation: null }));
    expect(bare!.version).not.toBe(withSeg!.version);
  });

  it('backs off after a failed render instead of retrying on every request', async () => {
    const svc = new PreviewService();
    renderSpy.fail = true;

    await expect(svc.ensurePreview(IMAGE)).rejects.toBeInstanceOf(PreviewUnavailableError);
    await expect(svc.ensurePreview(IMAGE)).rejects.toBeInstanceOf(PreviewUnavailableError);

    expect(renderSpy.calls).toBe(1);
  });

  it('returns null for an image that does not exist', async () => {
    h.prisma.image.findUnique.mockResolvedValueOnce(null);
    expect(await new PreviewService().ensurePreview('nope')).toBeNull();
  });
});

describe('PreviewService.notifyChanged', () => {
  it('coalesces a burst into one message per project carrying the listing URL', async () => {
    vi.useFakeTimers();
    h.prisma.image.findMany.mockResolvedValue([
      { id: IMAGE, projectId: PROJECT, originalPath: ORIGINAL, segmentation: row.segmentation },
    ]);
    const svc = new PreviewService();
    // Captured, not run: a background render racing afterEach's rm of the
    // temp tree is exactly the leaked-async-work shape that makes a suite
    // flaky only under load.
    const warm = vi.spyOn(svc, 'warm').mockImplementation(() => undefined);

    svc.notifyChanged([IMAGE]);
    svc.notifyChanged([IMAGE]);
    svc.notifyContainerChanged('container-1');
    await vi.advanceTimersByTimeAsync(300);

    expect(h.prisma.image.findMany).toHaveBeenCalledTimes(1);
    expect(h.prisma.image.findMany.mock.calls[0][0].where).toEqual({
      isVideoContainer: false,
      OR: [{ id: { in: [IMAGE] } }, { parentVideoId: { in: ['container-1'] } }],
    });
    expect(h.emitToProject).toHaveBeenCalledTimes(1);
    expect(h.emitToProject).toHaveBeenCalledWith(PROJECT, 'imagePreviewsUpdated', {
      projectId: PROJECT,
      previews: [{ imageId: IMAGE, previewUrl: previewUrlFor({ ...row }) }],
    });
    // ...and pre-renders what it announced.
    expect(warm).toHaveBeenCalledWith([IMAGE]);
  });
});

describe('RenderQueue', () => {
  function gate() {
    let open!: () => void;
    const p = new Promise<void>(r => (open = r));
    return { p, open };
  }

  it('runs a request someone waits for before the speculative backlog', async () => {
    const q = new RenderQueue(1);
    const order: string[] = [];
    const busy = gate();
    const first = q.run('busy', 'high', () => busy.p);
    const lows = ['l1', 'l2'].map(k => q.run(k, 'low', async () => void order.push(k)));
    const high = q.run('h', 'high', async () => void order.push('h'));

    busy.open();
    await Promise.all([first, ...lows, high]);

    expect(order).toEqual(['h', 'l1', 'l2']);
  });

  it('promotes a queued low-priority task that a visible card has joined', async () => {
    const q = new RenderQueue(1);
    const order: string[] = [];
    const busy = gate();
    const first = q.run('busy', 'high', () => busy.p);
    const lows = ['l1', 'l2', 'l3'].map(k =>
      q.run(k, 'low', async () => void order.push(k))
    );

    q.promote('l3');
    busy.open();
    await Promise.all([first, ...lows]);

    expect(order).toEqual(['l3', 'l1', 'l2']);
  });

  it('a high-priority ensurePreview that joins an in-flight warm promotes it', async () => {
    const svc = new PreviewService();
    const promote = vi.spyOn(
      (svc as unknown as { queue: RenderQueue }).queue,
      'promote'
    );

    const warm = svc.ensurePreview(IMAGE, 'low');
    const visible = svc.ensurePreview(IMAGE, 'high');
    await Promise.all([warm, visible]);

    expect(promote).toHaveBeenCalledTimes(1);
    expect(renderSpy.calls).toBe(1);
  });
});
