/**
 * `POST /api/projects` must refuse a request that names no project type.
 *
 * Mounted on the REAL `projectRoutes` router with the REAL `validateBody`
 * and `ResponseHelper`, because the claim is about the WIRING: the schema
 * being strict proves nothing if the route validated against something else,
 * and `projectRoutes.test.ts` registers the controller directly, bypassing
 * validation entirely — the same request it sends here would pass there.
 *
 * Until 2026-11-12 `type` was optional and the column's `@default("spheroid")`
 * filled it in, so a client that omitted it silently got a spheroid project.
 */

import request from 'supertest';
import express from 'express';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../middleware/auth', () => ({
  authenticate: vi.fn((req, _res, next) => {
    req.user = { id: 'user-1', email: 'u@example.com', emailVerified: true };
    next();
  }),
}));

vi.mock('../../../services/projectService', () => ({
  createProject: vi.fn(async (_userId: string, data: { type: string }) => ({
    id: 'proj-1',
    title: 'P',
    type: data.type,
  })),
}));

// Everything below is unrelated to POST / and only has to import cleanly.
vi.mock('../imageRoutes', async () => {
  const { Router } = await import('express');
  return { default: Router() };
});
vi.mock('../../../middleware/cache', () => {
  const pass = () => (_req: unknown, _res: unknown, next: () => void) => next();
  return {
    cacheMiddleware: pass,
    cacheInvalidationMiddleware: pass,
    conditionalCache: { userSpecific: pass },
  };
});
vi.mock('../../../services/cacheService', () => ({
  CacheService: { TTL_PRESETS: { SHORT: 60 } },
}));
vi.mock('../../../services/mtTypeLabelService', () => ({}));
vi.mock('../../../services/sharingService', () => ({}));
vi.mock('../../../db', () => ({ prisma: {} }));
vi.mock('../../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import projectRoutes from '../projectRoutes';
import * as ProjectService from '../../../services/projectService';

const makeApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/projects', projectRoutes);
  return app;
};

const INVALID_TYPE =
  'Neplatný typ projektu. Povolené hodnoty: spheroid, spheroid_invasive, wound, sperm, microtubules, microcapsule, neurite';

describe('POST /api/projects — project type is required', () => {
  beforeEach(() => {
    vi.mocked(ProjectService.createProject).mockClear();
  });

  it('refuses a request with no type, and creates nothing', async () => {
    const res = await request(makeApp())
      .post('/api/projects')
      .send({ title: 'No type given' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    // The error names the field, so a script author can see what is missing.
    expect(res.body.details).toHaveProperty('type');
    expect(res.body.details.type).toEqual(['Typ projektu je povinný']);
    expect(ProjectService.createProject).not.toHaveBeenCalled();
  });

  it('refuses an explicit null type', async () => {
    const res = await request(makeApp())
      .post('/api/projects')
      .send({ title: 'Null type', type: null });

    expect(res.status).toBe(400);
    // In Czech like every other message of this schema, and naming the
    // accepted values — zod's own text here is English.
    expect(res.body.details.type).toEqual([INVALID_TYPE]);
    expect(ProjectService.createProject).not.toHaveBeenCalled();
  });

  it('refuses a type that is not a project type', async () => {
    const res = await request(makeApp())
      .post('/api/projects')
      .send({ title: 'Bad type', type: 'spheroids' });

    expect(res.status).toBe(400);
    expect(res.body.details.type).toEqual([INVALID_TYPE]);
    expect(ProjectService.createProject).not.toHaveBeenCalled();
  });

  // zod runs string checks in order; with `.min(1)` before `.trim()` a title
  // of spaces passed the length check and was stored as ''.
  it('refuses a title of only spaces', async () => {
    const res = await request(makeApp())
      .post('/api/projects')
      .send({ title: '   ', type: 'spheroid' });

    expect(res.status).toBe(400);
    expect(res.body.details.title).toEqual(['Název projektu je povinný']);
    expect(ProjectService.createProject).not.toHaveBeenCalled();
  });

  it('stores the title trimmed', async () => {
    await request(makeApp())
      .post('/api/projects')
      .send({ title: '  Padded  ', type: 'wound' });

    expect(ProjectService.createProject).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ title: 'Padded' })
    );
  });

  // The type that would have been the silent default must still be choosable,
  // and a non-default one must reach the service unchanged.
  it.each(['spheroid', 'neurite'])(
    'creates the project with the chosen type %s',
    async type => {
      const res = await request(makeApp())
        .post('/api/projects')
        .send({ title: 'Typed', type });

      expect(res.status).toBe(201);
      expect(ProjectService.createProject).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ title: 'Typed', type })
      );
    }
  );
});
