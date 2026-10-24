import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

/**
 * The storage GC against a REAL directory tree. Every hazard the 2026-10-24
 * audit named is a case here, because each one is a way to delete live data:
 * the planner is only as safe as the shapes it was shown.
 */

// The global setup mocks the file system; this suite is about a real one.
vi.unmock('fs/promises');
vi.unmock('fs');

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  project: { findUnique: vi.fn() },
  image: { findUnique: vi.fn(), findFirst: vi.fn() },
  segmenterDataset: { findUnique: vi.fn() },
  segmenterImage: { findUnique: vi.fn() },
}));
vi.mock('../../../db', () => ({ prisma: prismaMock }));
vi.mock('../../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  planStorageGc,
  runStorageGc,
  emptySnapshot,
  normaliseKey,
  GRACE_MS,
  type LiveSnapshot,
  type GcCandidate,
} from '../storageGc';
import { previewVersion } from '../../previews/previewVersion';

const NOW = Date.parse('2026-10-24T12:00:00.000Z');
const DAY = 24 * 60 * 60_000;
const OLD = NOW - 30 * DAY;

const U = '11111111-1111-4111-8111-111111111111'; // a user
const P = '22222222-2222-4222-8222-222222222222'; // a live project
const DEAD_P = '33333333-3333-4333-8333-333333333333'; // a deleted project
const C = '44444444-4444-4444-8444-444444444444'; // a live container
const DEAD_C = '55555555-5555-4555-8555-555555555555'; // a deleted container
const STILL = '66666666-6666-4666-8666-666666666666';
const GONE_IMG = '77777777-7777-4777-8777-777777777777';
const DS = '88888888-8888-4888-8888-888888888888';
const DEAD_DS = '99999999-9999-4999-8999-999999999999';

let root: string;
let uploads: string;
let exportsDir: string;

async function put(rel: string, mtimeMs = OLD, base = uploads): Promise<void> {
  const abs = path.join(base, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, 'x'.repeat(10));
  await fs.utimes(abs, mtimeMs / 1000, mtimeMs / 1000);
}
async function dir(rel: string, mtimeMs = OLD): Promise<void> {
  const abs = path.join(uploads, rel);
  await fs.mkdir(abs, { recursive: true });
  await fs.utimes(abs, mtimeMs / 1000, mtimeMs / 1000);
}
const exists = (rel: string, base = uploads) =>
  fs.access(path.join(base, rel)).then(
    () => true,
    () => false
  );

function snapshot(): LiveSnapshot {
  const s = emptySnapshot();
  s.projectIds.add(P);
  for (const id of [C, STILL]) s.imageIds.add(id);
  s.containerIds.add(C);
  // frame rows of C: frame 0 only
  s.imageIds.add('frame-0');
  s.frameIndexes.set(C, new Set([0]));
  const refs = [
    `${U}/${P}/originals/a.jpg`,
    `${U}/${P}/thumbnails/a.jpg`,
    `${U}/${P}/segmentation_thumbnails/seg_2_a.jpg`,
    `projects/${P}/images/${C}/original.nd2`,
    `projects/${P}/images/${C}/frames/0000/IRM.png`,
    // An image whose file still sits in a deleted project's folder.
    `${U}/${DEAD_P}/originals/moved.jpg`,
  ];
  for (const r of refs) {
    s.referencedKeys.add(r);
    let d = path.posix.dirname(r);
    while (d !== '.') {
      s.referencedDirs.add(d);
      d = path.posix.dirname(d);
    }
  }
  s.previewVersions.set(STILL, 'aaaaaaaaaaaaaaaa');
  s.segmenterDatasetIds.add(DS);
  return s;
}

async function plan(s = snapshot()): Promise<Map<string, GcCandidate>> {
  const result = await planStorageGc({
    uploadDir: uploads,
    exportDir: exportsDir,
    snapshot: s,
    now: NOW,
  });
  return new Map(result.candidates.map(c => [c.key, c]));
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'storage-gc-'));
  uploads = path.join(root, 'uploads');
  exportsDir = path.join(root, 'exports');
  await fs.mkdir(uploads, { recursive: true });
  await fs.mkdir(exportsDir, { recursive: true });
  vi.clearAllMocks();
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('planStorageGc — user folders', () => {
  it('keeps referenced uploads and collects a deleted project and unreferenced files', async () => {
    await put(`${U}/${P}/originals/a.jpg`);
    await put(`${U}/${P}/thumbnails/a.jpg`);
    await put(`${U}/${P}/originals/lost.jpg`);
    await put(`${U}/${P}/segmentation_thumbnails/seg_1_a.jpg`);
    await put(`${U}/${P}/segmentation_thumbnails/seg_2_a.jpg`);
    const OTHER_DEAD = 'abababab-abab-4bab-8bab-abababababab';
    await put(`${U}/${OTHER_DEAD}/originals/b.jpg`);

    const c = await plan();

    expect(c.has(`${U}/${P}/originals/a.jpg`)).toBe(false);
    expect(c.has(`${U}/${P}/thumbnails/a.jpg`)).toBe(false);
    expect(c.get(`${U}/${P}/originals/lost.jpg`)?.reason).toBe(
      'unreferenced-upload'
    );
    expect(c.get(`${U}/${P}/segmentation_thumbnails/seg_1_a.jpg`)?.reason).toBe(
      'superseded-seg-thumbnail'
    );
    // still the rollback target of `segmentationThumbnailPath`
    expect(c.has(`${U}/${P}/segmentation_thumbnails/seg_2_a.jpg`)).toBe(false);
    expect(c.get(`${U}/${OTHER_DEAD}`)?.reason).toBe('project-gone');
  });

  it('never collects a folder that holds a file some row still points at', async () => {
    await put(`${U}/${DEAD_P}/originals/moved.jpg`);
    await put(`${U}/${DEAD_P}/originals/really-orphaned.jpg`);

    const c = await plan();

    expect(c.has(`${U}/${DEAD_P}`)).toBe(false);
    expect(c.has(`${U}/${DEAD_P}/originals/moved.jpg`)).toBe(false);
  });

  it('measures the grace period on the NEWEST file in the subtree', async () => {
    const DEAD2 = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
    await put(`${U}/${DEAD2}/originals/old.jpg`);
    // One file written an hour ago — an upload whose row is not there yet.
    await put(`${U}/${DEAD2}/originals/new.jpg`, NOW - 60 * 60_000);

    expect((await plan()).has(`${U}/${DEAD2}`)).toBe(false);
  });

  it('respects the 7-day user-data grace exactly', async () => {
    const DEAD2 = 'efefefef-efef-4fef-8fef-efefefefefef';
    await put(`${U}/${DEAD2}/originals/x.jpg`, NOW - GRACE_MS['project-gone'] + 1000);
    expect((await plan()).has(`${U}/${DEAD2}`)).toBe(false);

    await put(`${U}/${DEAD2}/originals/x.jpg`, NOW - GRACE_MS['project-gone'] - 1000);
    expect((await plan()).has(`${U}/${DEAD2}`)).toBe(true);
  });
});

describe('planStorageGc — video containers', () => {
  it('keeps every channel of a live frame, unreferenced or not', async () => {
    const f = `projects/${P}/images/${C}/frames/0000`;
    await put(`projects/${P}/images/${C}/original.nd2`);
    await put(`${f}/IRM.png`);
    // Referenced by NO row: only the source channel is a frame's originalPath.
    await put(`${f}/488_nm.png`);
    await put(`${f}/488_nm.p2047.v2.webp`);
    await put(`${f}/488_nm.p2047.webp`); // v1
    await put(`${f}/488_nm.p2047.v2.webp.partial`);

    const c = await plan();

    expect(c.has(`${f}/488_nm.png`)).toBe(false);
    expect(c.has(`${f}/488_nm.p2047.v2.webp`)).toBe(false);
    expect(c.has(`${f}/IRM.png`)).toBe(false);
    expect(c.get(`${f}/488_nm.p2047.webp`)?.reason).toBe('v1-proxy');
    expect(c.get(`${f}/488_nm.p2047.v2.webp.partial`)?.reason).toBe(
      'stale-partial'
    );
  });

  it('collects a frame directory whose index has no row, and a container whose row is gone', async () => {
    await put(`projects/${P}/images/${C}/frames/0000/IRM.png`);
    await put(`projects/${P}/images/${C}/frames/0007/IRM.png`);
    await put(`projects/${P}/images/${DEAD_C}/frames/0000/IRM.png`);
    await put(`projects/${DEAD_P}/images/${DEAD_C}/original.nd2`);

    const c = await plan();

    expect(c.get(`projects/${P}/images/${C}/frames/0007`)?.reason).toBe('frame-gone');
    expect(c.has(`projects/${P}/images/${C}/frames/0000`)).toBe(false);
    expect(c.get(`projects/${P}/images/${DEAD_C}`)?.reason).toBe('container-gone');
    expect(c.get(`projects/${DEAD_P}`)?.reason).toBe('project-gone');
  });

  it('leaves a frame directory alone while extraction is still writing it', async () => {
    await put(`projects/${P}/images/${C}/frames/0003/IRM.png`, NOW - 5 * 60_000);
    expect((await plan()).has(`projects/${P}/images/${C}/frames/0003`)).toBe(false);
  });
});

describe('planStorageGc — derived data', () => {
  it('keeps the current preview and collects superseded and orphaned ones', async () => {
    const d = `projects/${P}/previews/${STILL}`;
    await put(`${d}/aaaaaaaaaaaaaaaa.jpg`);
    await put(`${d}/bbbbbbbbbbbbbbbb.jpg`);
    await put(`${d}/cccccccccccccccc.jpg`, NOW - 5 * 60_000); // just superseded
    await put(`projects/${P}/previews/${GONE_IMG}/dddddddddddddddd.jpg`);

    const c = await plan();

    expect(c.has(`${d}/aaaaaaaaaaaaaaaa.jpg`)).toBe(false);
    expect(c.get(`${d}/bbbbbbbbbbbbbbbb.jpg`)?.reason).toBe('preview-superseded');
    expect(c.has(`${d}/cccccccccccccccc.jpg`)).toBe(false);
    expect(c.get(`projects/${P}/previews/${GONE_IMG}`)?.reason).toBe(
      'preview-image-gone'
    );
  });

  it('expires the display cache and drops entries of deleted images', async () => {
    await put(`converted/${STILL}.png`, NOW - DAY);
    await put(`converted/${C}.png`, NOW - 8 * DAY);
    await put(`converted/${GONE_IMG}.png`, NOW - 2 * DAY);

    const c = await plan();

    expect(c.has(`converted/${STILL}.png`)).toBe(false);
    expect(c.get(`converted/${C}.png`)?.reason).toBe('converted-expired');
    expect(c.get(`converted/${GONE_IMG}.png`)?.reason).toBe('converted-image-gone');
  });

  it('sweeps old temp and staging files and expired exports', async () => {
    await put('temp/temp_viz_1.png');
    await put('temp/fresh.png', NOW - 60_000);
    await put('feedback/_staging/upload.bin');
    await put('COS26-1.zip', NOW - 3 * DAY, exportsDir);
    await put('COS26-2.zip', NOW - 60_000, exportsDir);

    const c = await plan();

    expect(c.get('temp/temp_viz_1.png')?.reason).toBe('temp');
    expect(c.has('temp/fresh.png')).toBe(false);
    expect(c.get('feedback/_staging/upload.bin')?.reason).toBe('staging');
    expect(c.get('COS26-1.zip')).toMatchObject({ reason: 'export-expired', root: 'exports' });
    expect(c.has('COS26-2.zip')).toBe(false);
  });
});

describe('planStorageGc — what it must never enter', () => {
  it('ignores kinds with their own lifecycle and anything it does not know', async () => {
    await put(`avatars/${U}/avatar-1.jpg`);
    await put(`essays/${U}/job/output/results.csv`);
    await put('essays-results/job.zip');
    await put('api-jobs/job/result.json');
    await put('feedback/abc/screenshot.png');
    await put('.pending-cleanup/project-x.json');
    await put('converted.pre16bit/x.png'); // an operator's backup
    await put('blue/whatever.bin');
    await put(`${U}/${P}/unknown-kind/file.bin`);

    const keys = [...(await plan()).keys()];

    expect(keys).toEqual([]);
  });

  it('handles segmenter datasets by their own table, not as projects', async () => {
    await put(`projects/segmenter/${DS}/images/${STILL}/original.png`);
    await put(`projects/segmenter/${DEAD_DS}/images/${STILL}/original.png`);

    const s = snapshot();
    s.segmenterImageIds.add(STILL);
    const c = await plan(s);

    expect(c.has(`projects/segmenter/${DS}`)).toBe(false);
    expect(c.has(`projects/segmenter/${DS}/images/${STILL}`)).toBe(false);
    expect(c.has('projects/segmenter')).toBe(false);
    expect(c.get(`projects/segmenter/${DEAD_DS}`)?.reason).toBe(
      'segmenter-dataset-gone'
    );
  });

  it('refuses to plan from an empty snapshot', async () => {
    await put(`${U}/${P}/originals/a.jpg`);
    await expect(
      planStorageGc({ uploadDir: uploads, snapshot: emptySnapshot(), now: NOW })
    ).rejects.toThrow(/empty snapshot/);
  });

  it('collects empty directories only below the top level', async () => {
    await dir(`projects/${P}/images/${C}/frames/0001`);
    // An empty directory above a referenced (but missing) file is protected.
    await dir(`projects/${P}/images/${C}/frames/0000`);
    await dir('images');

    const s = snapshot();
    s.frameIndexes.get(C)!.add(1);
    const c = await plan(s);

    expect(c.get(`projects/${P}/images/${C}/frames/0001`)?.reason).toBe('empty-dir');
    expect(c.has(`projects/${P}/images/${C}/frames/0000`)).toBe(false);
    expect(c.has('images')).toBe(false);
  });
});

describe('normaliseKey', () => {
  it.each([
    ['a/b.jpg', 'a/b.jpg'],
    ['/a/b.jpg', 'a/b.jpg'],
    ['uploads/a/b.jpg', 'a/b.jpg'],
    ['/uploads/a/b.jpg', 'a/b.jpg'],
    ['/app/uploads/a/b.jpg', 'a/b.jpg'],
  ])('%s -> %s', (raw, key) => {
    expect(normaliseKey(raw)).toBe(key);
  });
});

describe('runStorageGc', () => {
  /** What `loadLiveSnapshot` reads, as rows. */
  function rows() {
    return [
      [{ id: P }],
      [
        {
          id: STILL,
          originalPath: `${U}/${P}/originals/a.jpg`,
          thumbnailPath: null,
          segmentationThumbnailPath: null,
          isVideoContainer: false,
          parentVideoId: null,
          frameIndex: null,
          segmentation: null,
        },
      ],
      [],
      [],
    ];
  }
  beforeEach(() => {
    prismaMock.$transaction.mockImplementation(async () => rows());
    prismaMock.project.findUnique.mockResolvedValue(null);
    process.env.LOG_DIR = path.join(root, 'logs');
  });

  it('dry-run deletes nothing and reports the plan', async () => {
    await put(`${U}/${P}/originals/a.jpg`);
    await put(`projects/${DEAD_P}/images/${DEAD_C}/original.nd2`);

    const summary = await runStorageGc('dry-run', {
      uploadDir: uploads,
      exportDir: exportsDir,
      now: () => NOW,
    });

    expect(summary.planned['project-gone']).toMatchObject({ count: 1, files: 1 });
    expect(await exists(`projects/${DEAD_P}`)).toBe(true);
    const report = await fs.readFile(summary.reportPath!, 'utf8');
    expect(report).toContain(`projects/${DEAD_P}`);
  });

  it('deletes what it planned, and keeps the referenced file', async () => {
    await put(`${U}/${P}/originals/a.jpg`);
    await put(`${U}/${P}/originals/a-big-original-that-keeps-the-breaker-quiet.jpg`);
    await fs.writeFile(path.join(uploads, `${U}/${P}/originals/a.jpg`), 'x'.repeat(10_000));
    await fs.utimes(path.join(uploads, `${U}/${P}/originals/a.jpg`), OLD / 1000, OLD / 1000);
    await put(`projects/${DEAD_P}/images/${DEAD_C}/original.nd2`);

    const summary = await runStorageGc('delete', {
      uploadDir: uploads,
      exportDir: exportsDir,
      now: () => NOW,
    });

    expect(summary.aborted).toBeUndefined();
    expect(await exists(`projects/${DEAD_P}`)).toBe(false);
    expect(await exists(`${U}/${P}/originals/a.jpg`)).toBe(true);
    expect(summary.deletedFiles).toBeGreaterThanOrEqual(2);
  });

  it('skips a candidate whose owner row has come back', async () => {
    await fs.writeFile(path.join(uploads, 'pad'), 'x'); // not a managed kind
    await put(`${U}/${P}/originals/a.jpg`);
    await fs.writeFile(path.join(uploads, `${U}/${P}/originals/a.jpg`), 'x'.repeat(10_000));
    await fs.utimes(path.join(uploads, `${U}/${P}/originals/a.jpg`), OLD / 1000, OLD / 1000);
    await put(`projects/${DEAD_P}/images/${DEAD_C}/original.nd2`);
    prismaMock.project.findUnique.mockResolvedValue({ id: DEAD_P });

    const summary = await runStorageGc('delete', {
      uploadDir: uploads,
      exportDir: exportsDir,
      now: () => NOW,
    });

    expect(summary.skipped).toBe(1);
    expect(await exists(`projects/${DEAD_P}`)).toBe(true);
  });

  it('re-checks the grace period at deletion time, not only when planning', async () => {
    await put(`${U}/${P}/originals/a.jpg`);
    await fs.writeFile(path.join(uploads, `${U}/${P}/originals/a.jpg`), 'x'.repeat(10_000));
    // 7.5 days old when planned...
    await put(`projects/${DEAD_P}/images/${DEAD_C}/original.nd2`, NOW - 7.5 * DAY);
    // ...but by the time the sweep gets there, the clock says 1 day: the
    // stand-in for a file touched between the snapshot and the delete.
    let calls = 0;
    const clock = () => (calls++ === 0 ? NOW : NOW - 6.5 * DAY);

    const summary = await runStorageGc('delete', {
      uploadDir: uploads,
      exportDir: exportsDir,
      now: clock,
    });

    expect(summary.planned['project-gone']?.count).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(await exists(`projects/${DEAD_P}`)).toBe(true);
  });

  it('aborts, deleting nothing, when the plan would remove most of the tree', async () => {
    await put(`${U}/${P}/originals/a.jpg`); // 10 bytes kept
    await put(`projects/${DEAD_P}/images/${DEAD_C}/original.nd2`);
    await fs.writeFile(
      path.join(uploads, `projects/${DEAD_P}/images/${DEAD_C}/original.nd2`),
      'x'.repeat(10_000)
    );
    await fs.utimes(
      path.join(uploads, `projects/${DEAD_P}/images/${DEAD_C}/original.nd2`),
      OLD / 1000,
      OLD / 1000
    );

    const summary = await runStorageGc('delete', {
      uploadDir: uploads,
      exportDir: exportsDir,
      now: () => NOW,
    });

    expect(summary.aborted).toMatch(/scanned bytes/);
    expect(summary.deletedFiles).toBe(0);
    expect(await exists(`projects/${DEAD_P}`)).toBe(true);
  });

  it('computes the preview version the listing hands out', async () => {
    const at = new Date('2026-10-24T10:00:00.000Z');
    prismaMock.$transaction.mockImplementation(async () => {
      const r = rows();
      (r[1][0] as Record<string, unknown>).segmentation = { id: 'seg-1', updatedAt: at };
      return r;
    });
    const current = previewVersion({
      originalPath: `${U}/${P}/originals/a.jpg`,
      segmentation: { id: 'seg-1', updatedAt: at },
    });
    await put(`${U}/${P}/originals/a.jpg`);
    await fs.writeFile(path.join(uploads, `${U}/${P}/originals/a.jpg`), 'x'.repeat(10_000));
    await put(`projects/${P}/previews/${STILL}/${current}.jpg`);
    await put(`projects/${P}/previews/${STILL}/0000000000000000.jpg`);

    await runStorageGc('delete', { uploadDir: uploads, exportDir: exportsDir, now: () => NOW });

    expect(await exists(`projects/${P}/previews/${STILL}/${current}.jpg`)).toBe(true);
    expect(await exists(`projects/${P}/previews/${STILL}/0000000000000000.jpg`)).toBe(false);
  });
});
