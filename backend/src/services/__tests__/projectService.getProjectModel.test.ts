import { describe, it, expect, beforeEach, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { project: { findUnique: vi.fn() } },
}));

vi.mock('../../db', () => ({ prisma: prismaMock }));
vi.mock('../../utils/logger');
vi.mock('../sharingService', () => ({ hasProjectAccess: vi.fn() }));

import * as projectService from '../projectService';

/**
 * The server-side reader for `projects.segmentationModel` (and the type, which
 * decides whether the hole-detection flag is honoured).
 *
 * It exists because the queue endpoints used to default `model` to the literal
 * `'hrnet'`, which is compatible with exactly ONE of the seven project types.
 * A request that omitted the model therefore queued a job the worker rejected
 * on the other six, failing every image in the batch — and made the new column
 * authoritative only in the browser.
 */
describe('ProjectService.getProjectSegmentationContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const project = (type: string, segmentationModel: string | null) =>
    prismaMock.project.findUnique.mockResolvedValue({
      type,
      segmentationModel,
    });

  it.each([
    ['spheroid', 'segformer'],
    ['spheroid_invasive', 'spheroid_disintegration'],
    ['wound', 'wound'],
    ['sperm', 'sperm'],
    ['microtubules', 'microtubule'],
    ['microcapsule', 'microcapsule'],
    ['neurite', 'neurite_soma'],
  ])('resolves an unset %s project to %s', async (type, expected) => {
    project(type, null);
    await expect(projectService.getProjectSegmentationContext('p')).resolves.toMatchObject({ model: expected });
  });

  it('returns the stored model when it is valid for the type', async () => {
    project('spheroid', 'mamba_unet');
    await expect(projectService.getProjectSegmentationContext('p')).resolves.toMatchObject({
      model: 'mamba_unet',
    });
  });

  it('ignores a stored model stranded by a type change', async () => {
    project('wound', 'segformer');
    await expect(projectService.getProjectSegmentationContext('p')).resolves.toMatchObject({ model: 'wound' });
  });

  it('never returns hrnet for a project type that cannot run it', async () => {
    // The exact regression: `'hrnet'` was the hard-coded default, and it is
    // compatible with `spheroid` only.
    for (const type of [
      'wound',
      'sperm',
      'microtubules',
      'microcapsule',
      'neurite',
      'spheroid_invasive',
    ]) {
      project(type, null);
      await expect(projectService.getProjectSegmentationContext('p')).resolves.not.toMatchObject({
        model: 'hrnet',
      });
    }
  });

  it('survives a legacy row whose type is not a known project type', async () => {
    // `projects.type` is a plain String column; `coerceProjectType` exists
    // precisely because unrecognised values occur. This must yield a default,
    // not throw.
    project('some_retired_type', null);
    await expect(projectService.getProjectSegmentationContext('p')).resolves.toMatchObject({
      model: 'segformer',
    });
  });

  it('returns null for a project that does not exist', async () => {
    prismaMock.project.findUnique.mockResolvedValue(null);
    // Not a model: the caller keeps its own not-found handling rather than
    // queueing work for a project it could not read.
    await expect(
      projectService.getProjectSegmentationContext('ghost')
    ).resolves.toBeNull();
  });

  it('reads only the two columns it needs', async () => {
    project('spheroid', null);
    await projectService.getProjectSegmentationContext('p');
    expect(prismaMock.project.findUnique).toHaveBeenCalledWith({
      where: { id: 'p' },
      select: { type: true, segmentationModel: true },
    });
  });
});

describe('the context also carries the type', () => {
  it('returns the raw type, for the hole-detection decision', async () => {
    prismaMock.project.findUnique.mockResolvedValue({
      type: 'neurite',
      segmentationModel: null,
    });
    await expect(
      projectService.getProjectSegmentationContext('p')
    ).resolves.toMatchObject({ model: 'neurite_soma', type: 'neurite' });
  });

  it('does not coerce the type away', async () => {
    // `resolveDetectHoles` must see what the column actually holds; a legacy
    // value has to read as "not one of the two types that offer the toggle",
    // which coercing it to 'spheroid' would invert.
    prismaMock.project.findUnique.mockResolvedValue({
      type: 'some_retired_type',
      segmentationModel: null,
    });
    await expect(
      projectService.getProjectSegmentationContext('p')
    ).resolves.toMatchObject({ type: 'some_retired_type' });
  });
});
