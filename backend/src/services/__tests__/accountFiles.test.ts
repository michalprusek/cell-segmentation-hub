import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

// The global test setup replaces `fs/promises` with a mock. This suite is
// about what really happens on disk, so it needs the real one.
vi.unmock('fs/promises');
vi.unmock('fs');

vi.mock('../../db', () => ({
  __esModule: true,
  prisma: {
    image: { findMany: vi.fn() },
    project: { findMany: vi.fn() },
    essayJob: { findMany: vi.fn() },
    apiJob: { findMany: vi.fn() },
  },
}));

vi.mock('../../utils/config', () => ({
  __esModule: true,
  config: { UPLOAD_DIR: '/nonexistent-default' },
}));

vi.mock('../../utils/logger', () => ({
  __esModule: true,
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { prisma } from '../../db';
import { collectUserFiles, deleteUserFiles } from '../accountFiles';

const OWNER = '11111111-1111-4111-8111-111111111111';
const SHAREE = '22222222-2222-4222-8222-222222222222';
const OWN_PROJECT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_PROJECT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('collectUserFiles', () => {
  beforeEach(() => {
    vi.mocked(prisma.image.findMany).mockResolvedValue([
      {
        id: 'img-own',
        projectId: OWN_PROJECT,
        originalPath: `${OWNER}/${OWN_PROJECT}/originals/a.png`,
        thumbnailPath: `${OWNER}/${OWN_PROJECT}/thumbnails/a.jpg`,
        segmentationThumbnailPath: null,
      },
      {
        // Uploaded INTO the owner's project by somebody it was shared with:
        // it sits under the sharee's folder and still goes with the account.
        id: 'img-by-sharee',
        projectId: OWN_PROJECT,
        originalPath: `${SHAREE}/${OWN_PROJECT}/originals/b.png`,
        thumbnailPath: null,
        segmentationThumbnailPath: `${SHAREE}/${OWN_PROJECT}/segmentation_thumbnails/b.jpg`,
      },
    ] as never);
    vi.mocked(prisma.project.findMany).mockResolvedValue([
      { id: OWN_PROJECT },
    ] as never);
    vi.mocked(prisma.essayJob.findMany).mockResolvedValue([
      { resultZipKey: 'essays-results/job-1.zip' },
      { resultZipKey: null },
    ] as never);
    vi.mocked(prisma.apiJob.findMany).mockResolvedValue([
      { id: 'job-xyz' },
    ] as never);
  });

  it('selects images by the PROJECT owner, not by who uploaded them', async () => {
    await collectUserFiles(OWNER);

    expect(prisma.image.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { project: { userId: OWNER } } })
    );
  });

  it('lists every recorded path of every image, including one under another user’s folder', async () => {
    const { fileKeys } = await collectUserFiles(OWNER);

    expect(fileKeys).toEqual(
      expect.arrayContaining([
        `${OWNER}/${OWN_PROJECT}/originals/a.png`,
        `${OWNER}/${OWN_PROJECT}/thumbnails/a.jpg`,
        `${SHAREE}/${OWN_PROJECT}/originals/b.png`,
        `${SHAREE}/${OWN_PROJECT}/segmentation_thumbnails/b.jpg`,
        'converted/img-own.png',
        'converted/img-by-sharee.png',
        'essays-results/job-1.zip',
      ])
    );
    expect(fileKeys).not.toContain(null);
  });

  it('never lists the user’s whole upload folder, which may hold uploads into other people’s projects', async () => {
    const { dirKeys } = await collectUserFiles(OWNER);

    expect(dirKeys).not.toContain(OWNER);
    expect(dirKeys).not.toContain(`${OWNER}/`);
    expect(dirKeys.some(d => d.includes(OTHER_PROJECT))).toBe(false);
    // Nor the sharee's folder for this project: only the two files above.
    expect(dirKeys).not.toContain(`${SHAREE}/${OWN_PROJECT}`);

    expect([...dirKeys].sort()).toEqual(
      [
        `projects/${OWN_PROJECT}`,
        `${OWNER}/${OWN_PROJECT}`,
        `avatars/${OWNER}`,
        `essays/${OWNER}`,
        'api-jobs/job-xyz',
      ].sort()
    );
  });

  it('refuses a user id that is not a single path component', async () => {
    await expect(collectUserFiles('../etc')).rejects.toThrow();
  });
});

describe('deleteUserFiles', () => {
  let root: string;
  let outside: string;

  const write = async (base: string, key: string): Promise<string> => {
    const target = path.join(base, key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, 'x');
    return target;
  };
  const exists = (p: string): Promise<boolean> =>
    fs.access(p).then(
      () => true,
      () => false
    );

  beforeEach(async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'account-files-'));
    root = path.join(base, 'uploads');
    outside = path.join(base, 'outside');
    await fs.mkdir(root, { recursive: true });
    await fs.mkdir(outside, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(path.dirname(root), { recursive: true, force: true });
  });

  it('removes the listed files and directories and nothing beside them', async () => {
    const mine = await write(root, `${OWNER}/${OWN_PROJECT}/originals/a.png`);
    const bySharee = await write(
      root,
      `${SHAREE}/${OWN_PROJECT}/originals/b.png`
    );
    const video = await write(
      root,
      `projects/${OWN_PROJECT}/images/v/frames/0000/irm.png`
    );
    // Must survive: this user's upload into somebody else's project, and the
    // sharee's own unrelated file.
    const intoOthers = await write(
      root,
      `${OWNER}/${OTHER_PROJECT}/originals/keep.png`
    );
    const shareesOwn = await write(
      root,
      `${SHAREE}/${OTHER_PROJECT}/originals/keep.png`
    );

    const result = await deleteUserFiles(
      {
        fileKeys: [`${SHAREE}/${OWN_PROJECT}/originals/b.png`],
        dirKeys: [`${OWNER}/${OWN_PROJECT}`, `projects/${OWN_PROJECT}`],
      },
      root
    );

    expect(result).toEqual({ removed: 3, failed: 0, refused: 0 });
    expect(await exists(mine)).toBe(false);
    expect(await exists(bySharee)).toBe(false);
    expect(await exists(video)).toBe(false);
    expect(await exists(intoOthers)).toBe(true);
    expect(await exists(shareesOwn)).toBe(true);
  });

  it.each([
    ['a parent traversal', '../outside/victim.txt'],
    ['a traversal hidden mid-path', 'avatars/../../outside/victim.txt'],
    ['the upload directory itself', '.'],
    ['an empty key', ''],
  ])('refuses %s', async (_name, key) => {
    const victim = await write(outside, 'victim.txt');
    const inside = await write(root, 'avatars/x/a.png');

    const result = await deleteUserFiles(
      { fileKeys: [key], dirKeys: [key] },
      root
    );

    expect(result).toEqual({ removed: 0, failed: 0, refused: 2 });
    expect(await exists(victim)).toBe(true);
    expect(await exists(inside)).toBe(true);
  });

  it('refuses an absolute path outside the upload directory', async () => {
    const victim = await write(outside, 'victim.txt');

    const result = await deleteUserFiles(
      { fileKeys: [victim], dirKeys: [outside] },
      root
    );

    expect(result.refused).toBe(2);
    expect(await exists(victim)).toBe(true);
  });

  it('does not treat a sibling directory with the same prefix as inside', async () => {
    // `<root>-evil` starts with `<root>` as a string; a bare startsWith
    // check lets it through.
    const sibling = `${root}-evil`;
    const victim = await write(sibling, 'victim.txt');

    const result = await deleteUserFiles(
      { fileKeys: [`../${path.basename(sibling)}/victim.txt`], dirKeys: [] },
      root
    );

    expect(result.refused).toBe(1);
    expect(await exists(victim)).toBe(true);
  });

  it('counts a file that is already gone as removed, not failed', async () => {
    const result = await deleteUserFiles(
      { fileKeys: ['converted/never-existed.png'], dirKeys: ['essays/nobody'] },
      root
    );

    expect(result).toEqual({ removed: 2, failed: 0, refused: 0 });
  });
});
