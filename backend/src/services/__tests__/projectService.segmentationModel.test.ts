import { describe, it, expect, beforeEach, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    project: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../../db', () => ({ prisma: prismaMock }));
vi.mock('../../utils/logger');
vi.mock('../sharingService', () => ({ hasProjectAccess: vi.fn() }));

import * as projectService from '../projectService';
import { ApiError } from '../../middleware/error';

const PROJECT_ID = 'project-id';
const USER_ID = 'user-id';

/** The data object the service handed to prisma.project.update. */
const updatePayload = () => prismaMock.project.update.mock.calls[0][0].data;

describe('ProjectService.updateProject — segmentationModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.project.findFirst.mockResolvedValue({
      id: PROJECT_ID,
      userId: USER_ID,
      type: 'spheroid',
      segmentationModel: 'cbam_resunet',
    });
    prismaMock.project.update.mockResolvedValue({ id: PROJECT_ID });
  });

  describe('compatibility', () => {
    it('stores a model compatible with the project type', async () => {
      await projectService.updateProject(PROJECT_ID, USER_ID, {
        segmentationModel: 'mamba_unet',
      });

      expect(updatePayload()).toMatchObject({
        segmentationModel: 'mamba_unet',
      });
    });

    it('rejects a model the project type cannot run', async () => {
      await expect(
        projectService.updateProject(PROJECT_ID, USER_ID, {
          segmentationModel: 'wound',
        })
      ).rejects.toMatchObject({ statusCode: 400 });

      expect(prismaMock.project.update).not.toHaveBeenCalled();
    });

    it('names the allowed models in the rejection', async () => {
      // The message is surfaced verbatim by the picker's error toast, so it
      // has to tell the user what they COULD have picked.
      const err = await projectService
        .updateProject(PROJECT_ID, USER_ID, { segmentationModel: 'wound' })
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).message).toContain('segformer');
      expect((err as ApiError).message).toContain('mamba_unet');
    });

    it('validates against the type ARRIVING in the same request', async () => {
      // The trap: checking against the STORED type would accept a spheroid
      // model on a request that also turns the project into a wound project.
      await expect(
        projectService.updateProject(PROJECT_ID, USER_ID, {
          type: 'wound',
          segmentationModel: 'segformer',
        })
      ).rejects.toMatchObject({ statusCode: 400 });

      expect(prismaMock.project.update).not.toHaveBeenCalled();
    });

    it('accepts a model valid for the type arriving in the same request', async () => {
      await projectService.updateProject(PROJECT_ID, USER_ID, {
        type: 'wound',
        segmentationModel: 'wound',
      });

      expect(updatePayload()).toMatchObject({
        type: 'wound',
        segmentationModel: 'wound',
      });
    });
  });

  describe('type change clears a stranded model', () => {
    it('clears the stored model to NULL when the type changes', async () => {
      await projectService.updateProject(PROJECT_ID, USER_ID, {
        type: 'wound',
      });

      // NULL, not the new type's default literal: NULL means "follow the
      // default", so the row keeps tracking the registry instead of freezing
      // today's answer into it.
      expect(updatePayload().segmentationModel).toBeNull();
    });

    it('does not clear it when the type is unchanged', async () => {
      await projectService.updateProject(PROJECT_ID, USER_ID, {
        type: 'spheroid',
        title: 'Renamed',
      });

      expect(updatePayload()).not.toHaveProperty('segmentationModel');
    });

    it('leaves the model alone on an unrelated edit', async () => {
      // The `pixelSizeUm` spread bug shape: a plain assignment here would wipe
      // the model on every rename.
      await projectService.updateProject(PROJECT_ID, USER_ID, {
        title: 'Renamed',
      });

      expect(updatePayload()).not.toHaveProperty('segmentationModel');
    });

    it('keeps an explicit model over the type-change clear', async () => {
      await projectService.updateProject(PROJECT_ID, USER_ID, {
        type: 'wound',
        segmentationModel: 'wound',
      });

      expect(updatePayload().segmentationModel).toBe('wound');
    });
  });

  describe('explicit clear', () => {
    it('accepts null as "follow the type default"', async () => {
      await projectService.updateProject(PROJECT_ID, USER_ID, {
        segmentationModel: null,
      });

      expect(updatePayload().segmentationModel).toBeNull();
    });
  });
});
