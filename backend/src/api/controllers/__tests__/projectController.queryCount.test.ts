/**
 * Query-count regression tests for the microtubule type-label endpoints.
 *
 * These endpoints authorise through `ensureProjectAccess`, which used to call
 * `ProjectService.getProjectById`. That helper runs the access check AND then
 * re-fetches the project with `include: { images: { select: { … 8 columns } } }`
 * and no `take` — every image row of the project — purely so the controller can
 * null-test the result. On the 621-frame ND2 container this repo tests against,
 * reading a four-entry colour palette read 621 image rows.
 *
 * The assertions below are on the number, ORDER and SHAPE of the Prisma calls,
 * not on elapsed time: `performance.now()` resolves to a whole millisecond
 * under vitest, so a duration assertion here would be measuring the tick
 * boundary.
 *
 * Ordering is genuine, not an artefact of how the mock object is spelled:
 * every mocked method appends to one shared `callLog` as it is invoked, so the
 * sequence below is chronological. (Reading `Object.entries(prismaMock)`
 * instead would report declaration order and would still pass with the access
 * check moved after the palette read.)
 *
 * The router under test is the real `projectRoutes` chain (`validateParams`
 * included — it REPLACES `req.params` with the parsed object, which is exactly
 * the kind of middleware a hand-rolled mini-router would silently skip). Only
 * `authenticate`, the Prisma client and the mounted image sub-router are
 * stubbed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { Router } from 'express';

const { prismaMock, callLog } = vi.hoisted(() => {
  const log: Array<{ model: string; op: string; args: any }> = [];

  /** A Prisma model whose every method records `model.op` into `log`. */
  const model = (name: string, ops: string[]) =>
    Object.fromEntries(
      ops.map(op => [
        op,
        vi.fn((args?: unknown) => {
          log.push({ model: name, op, args });
          return undefined;
        }),
      ])
    );

  return {
    callLog: log,
    prismaMock: {
      project: model('project', [
        'findFirst',
        'findUnique',
        'findMany',
        'update',
        'count',
        'create',
        'delete',
      ]),
      user: model('user', ['findUnique']),
      image: model('image', [
        'findMany',
        'count',
        'groupBy',
        'aggregate',
        'update',
      ]),
      segmentation: model('segmentation', ['findMany', 'count']),
      projectShare: model('projectShare', ['findFirst', 'count']),
      $transaction: vi.fn(),
    },
  };
});

vi.mock('../../../db', () => ({ prisma: prismaMock }));

vi.mock('../../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../utils/config', () => ({
  config: { NODE_ENV: 'test', UPLOAD_DIR: '/tmp/test-uploads' },
}));

// The real chain runs `authenticate` first; every handler below only reads
// `req.user.id` from it.
vi.mock('../../../middleware/auth', () => ({
  authenticate: vi.fn(
    (
      req: express.Request & { user?: Record<string, unknown> },
      _res: express.Response,
      next: express.NextFunction
    ) => {
      req.user = { id: USER_ID, email: 'owner@example.com' };
      next();
    }
  ),
}));

// projectRoutes mounts the image sub-router at '/'; it is irrelevant here and
// drags in storage + sharp.
vi.mock('../../routes/imageRoutes', () => ({ default: Router() }));

// Only the TTL constants are read from this module by the router.
vi.mock('../../../services/cacheService', () => ({
  CacheService: {
    TTL_PRESETS: { SHORT: 60, DATABASE_QUERY: 600 },
  },
}));

const USER_ID = 'user-1';
const PROJECT_ID = '11111111-2222-3333-4444-555555555555';

import projectRoutes from '../../routes/projectRoutes';

function makeApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use('/api/projects', projectRoutes);
  return app;
}

/**
 * A mock that both records into `callLog` (for ordering) and resolves to
 * `value`. `mockResolvedValue` alone would replace the recording body.
 */
function respondWith(
  fn: ReturnType<typeof vi.fn>,
  model: string,
  op: string,
  value: unknown
): void {
  fn.mockImplementation((args?: unknown) => {
    callLog.push({ model, op, args });
    return Promise.resolve(value);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  callLog.length = 0;
  // Owner path: SharingService.hasProjectAccess resolves on the first query.
  respondWith(prismaMock.project.findFirst, 'project', 'findFirst', {
    id: PROJECT_ID,
  });
  // MtTypeLabelService.getLabels
  respondWith(prismaMock.project.findUnique, 'project', 'findUnique', {
    mtTypeLabels: [{ id: 'l1', name: 'Dynamic', color: '#ff0000' }],
    type: 'microtubule',
  });
});

describe('GET /api/projects/:id/mt-type-labels — authorisation cost', () => {
  it('returns the palette', async () => {
    const res = await request(makeApp()).get(
      `/api/projects/${PROJECT_ID}/mt-type-labels`
    );

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      labels: [{ id: 'l1', name: 'Dynamic', color: '#ff0000' }],
    });
  });

  it('never asks Prisma for the project’s images', async () => {
    await request(makeApp()).get(`/api/projects/${PROJECT_ID}/mt-type-labels`);

    const withImages = callLog.filter(
      c => c.args?.include?.images !== undefined
    );
    expect(withImages).toEqual([]);
  });

  it('costs exactly two queries, access check first', async () => {
    await request(makeApp()).get(`/api/projects/${PROJECT_ID}/mt-type-labels`);

    // 1. the ownership probe inside hasProjectAccess
    // 2. the palette read itself
    // The third query — getProjectById's full project + every image row — is
    // what this change removed. `callLog` is chronological, so this also
    // pins the access check ahead of the read it guards.
    expect(callLog.map(c => `${c.model}.${c.op}`)).toEqual([
      'project.findFirst',
      'project.findUnique',
    ]);
    expect(callLog[1].args.select).toEqual({
      mtTypeLabels: true,
      type: true,
    });
  });

  it('still 404s when the caller has no access, without reading the project', async () => {
    respondWith(prismaMock.project.findFirst, 'project', 'findFirst', null); // not the owner
    respondWith(prismaMock.user.findUnique, 'user', 'findUnique', {
      email: 'owner@example.com',
    });
    respondWith(prismaMock.projectShare.findFirst, 'projectShare', 'findFirst', null); // no share
    respondWith(prismaMock.projectShare.count, 'projectShare', 'count', 0);

    const res = await request(makeApp()).get(
      `/api/projects/${PROJECT_ID}/mt-type-labels`
    );

    expect(res.status).toBe(404);
    // The palette read must not have happened.
    expect(prismaMock.project.findUnique).not.toHaveBeenCalled();
  });
});
