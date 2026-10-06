/**
 * `/api/v1/jobs` through the REAL router and the REAL worker, against a real
 * directory on disk. Two things are doubles: the `api_jobs` table (an
 * in-memory stand-in with the handful of Prisma calls the code makes) and
 * the call to the ML service. Everything that decides what a client sees —
 * auth, upload handling, validation, idempotency, the worker's bookkeeping,
 * expiry, the result formats — is the production code.
 */
import request from 'supertest';
import express from 'express';
import { mkdtempSync, existsSync, readdirSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

vi.unmock('sharp');
vi.unmock('archiver');
vi.unmock('multer');
vi.unmock('uuid');

const UPLOADS = mkdtempSync(path.join(os.tmpdir(), 'v1-jobs-'));

vi.mock('../../../utils/config', () => ({
  // Getters: the factory runs while this file's imports are still being
  // resolved, before the constants below it exist.
  config: {
    SEGMENTATION_SERVICE_URL: 'http://ml.test:8000',
    get UPLOAD_DIR() {
      return UPLOADS;
    },
  },
}));
vi.mock('../../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

/** An in-memory `api_jobs`, with Prisma's semantics for the calls used. */
const rows = new Map<string, any>();
let clock = 1_000_000;
const matches = (row: any, where: any): boolean =>
  Object.entries(where ?? {}).every(([key, cond]: [string, any]) => {
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond) return cond.in.includes(row[key]);
      if ('not' in cond) return row[key] !== cond.not;
      if ('lte' in cond) return row[key] !== null && row[key] <= cond.lte;
    }
    return row[key] === cond;
  });
const notFound = () => Object.assign(new Error('not found'), { code: 'P2025' });
const apiJob = {
  create: vi.fn(async ({ data }: any) => {
    if (
      data.idempotencyKey &&
      [...rows.values()].some(
        r => r.userId === data.userId && r.idempotencyKey === data.idempotencyKey
      )
    ) {
      throw Object.assign(new Error('unique'), { code: 'P2002' });
    }
    const now = new Date(clock++);
    const row = {
      status: 'queued',
      cancelRequested: false,
      startedAt: null,
      completedAt: null,
      expiresAt: null,
      idempotencyKey: null,
      requestHash: null,
      apiKeyId: null,
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    rows.set(row.id, row);
    return { ...row };
  }),
  findUnique: vi.fn(async ({ where }: any) => {
    const row = where.id
      ? rows.get(where.id)
      : [...rows.values()].find(r => matches(r, where.userId_idempotencyKey));
    return row ? { ...row } : null;
  }),
  findFirst: vi.fn(async ({ where, orderBy }: any) => {
    let found = [...rows.values()].filter(r => matches(r, where));
    if (orderBy?.updatedAt === 'asc') {
      found = found.sort((a, b) => a.updatedAt - b.updatedAt);
    }
    return found[0] ? { ...found[0] } : null;
  }),
  findMany: vi.fn(async ({ where, orderBy, take }: any = {}) => {
    let found = [...rows.values()].filter(r => matches(r, where));
    if (orderBy?.createdAt === 'desc') {
      found = found.sort((a, b) => b.createdAt - a.createdAt);
    }
    return found.slice(0, take ?? found.length).map(r => ({ ...r }));
  }),
  count: vi.fn(async ({ where }: any) =>
    [...rows.values()].filter(r => matches(r, where)).length
  ),
  aggregate: vi.fn(async ({ where }: any) => ({
    _sum: {
      inputBytes: [...rows.values()]
        .filter(r => matches(r, where))
        .reduce((sum, r) => sum + BigInt(r.inputBytes), BigInt(0)),
    },
  })),
  update: vi.fn(async ({ where, data }: any) => {
    const row = rows.get(where.id);
    if (!row) throw notFound();
    Object.assign(row, data, { updatedAt: new Date(clock++) });
    return { ...row };
  }),
  deleteMany: vi.fn(async ({ where }: any) => {
    const doomed = [...rows.values()].filter(r => matches(r, where));
    doomed.forEach(r => rows.delete(r.id));
    return { count: doomed.length };
  }),
};
const keyLookup = vi.fn();
vi.mock('../../../db', () => ({
  __esModule: true,
  prisma: {
    apiKey: {
      findUnique: (a: any) => keyLookup(a),
      update: vi.fn(async () => ({})),
    },
    get apiJob() {
      return apiJob;
    },
  },
}));

const segmentWithMl = vi.fn();
vi.mock('../mlClient', async importOriginal => ({
  ...(await importOriginal<typeof import('../mlClient')>()),
  segmentWithMl: (...args: unknown[]) => segmentWithMl(...args),
}));

import v1Routes from '../index';
import { generateApiKey, hashApiKey } from '../../../services/apiKeyService';
import { MlBusyError, MlRejectedError, MlTimeoutError } from '../mlClient';
import {
  JOB_MAX_ITEMS,
  JOB_MAX_PIXELS,
  JOB_RESULT_TTL_MS,
  JOB_ROW_TTL_MS,
  MAX_ACTIVE_JOBS_PER_USER,
  inputPath,
  jobDir,
  jobMaxPixels,
  resultPath,
  incomingDir,
} from '../jobs/store';
import { recoverInterrupted, sweep, tick } from '../jobs/worker';
import { SYNC_MAX_PIXELS } from '../limits';

const PROBLEM = /^application\/problem\+json/;
const PNG = (fill: number) =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(40, fill),
  ]);

const app = express();
app.use('/api/v1', v1Routes);

const keys = new Map<string, string>();
const keyFor = (user: string): string => {
  const key = generateApiKey();
  keys.set(hashApiKey(key), user);
  return `Bearer ${key}`;
};
keyLookup.mockImplementation(async ({ where }: any) => {
  const user = keys.get(where.keyHash);
  return user
    ? {
        id: `key-of-${user}`,
        name: 'k',
        prefix: 'sseg_test',
        expiresAt: null,
        lastUsedAt: new Date(),
        user: { id: user, email: `${user}@example.com`, emailVerified: true },
      }
    : null;
});

const ring = (a: number, b: number) => [
  { x: a, y: a },
  { x: b, y: a },
  { x: b, y: b },
  { x: a, y: b },
];
const mlResult = (overrides = {}) => ({
  polygons: [{ id: 'p0', type: 'external', class: 'spheroid', points: ring(2, 20) }],
  image_size: { width: 40, height: 30 },
  inference_time: 0.2,
  page: 0,
  page_count: 1,
  ...overrides,
});

let alice: string;
const createJob = (
  auth: string,
  files: Buffer[] = [PNG(1)],
  fields: Record<string, string> = { model: 'segformer' },
  headers: Record<string, string> = {}
) => {
  const req = request(app).post('/api/v1/jobs').set('Authorization', auth);
  for (const [k, v] of Object.entries(headers)) req.set(k, v);
  for (const [k, v] of Object.entries(fields)) req.field(k, v);
  files.forEach((file, i) => req.attach('images', file, `img ${i}.png`));
  return req;
};
const get = (auth: string, url: string) =>
  request(app).get(url).set('Authorization', auth);
const drain = async (limit = 60) => {
  for (let i = 0; i < limit; i++) {
    if (![...rows.values()].some(r => ['queued', 'processing'].includes(r.status))) return;
    await tick();
  }
};
const fieldErrors = (res: request.Response) =>
  Object.fromEntries(res.body.errors.map((e: any) => [e.field, e.detail]));

beforeEach(async () => {
  rows.clear();
  segmentWithMl.mockReset();
  segmentWithMl.mockResolvedValue(mlResult());
  alice = keyFor(`alice-${Math.random().toString(36).slice(2)}`);
  rmSync(path.join(UPLOADS, 'api-jobs'), { recursive: true, force: true });
  const { promises: fs } = await import('fs');
  await fs.mkdir(incomingDir(), { recursive: true });
});
afterAll(() => rmSync(UPLOADS, { recursive: true, force: true }));

describe('creating a job', () => {
  it('answers 202 with Location and Retry-After, and stores the uploads', async () => {
    const res = await createJob(alice, [PNG(1), PNG(2)], { model: 'hrnet', threshold: '0.7' });

    expect(res.status).toBe(202);
    expect(res.headers.location).toBe(`/api/v1/jobs/${res.body.id}`);
    expect(res.headers['retry-after']).toBe('5');
    expect(res.body).toMatchObject({
      status: 'queued',
      model: 'hrnet',
      parameters: { threshold: 0.7, detect_holes: true },
      counts: { total: 2, queued: 2, succeeded: 0 },
      started_at: null,
      expires_at: null,
      urls: {
        self: `/api/v1/jobs/${res.body.id}`,
        cancel: `/api/v1/jobs/${res.body.id}/cancel`,
      },
    });
    expect(res.body.items.map((i: any) => [i.index, i.filename, i.status])).toEqual([
      [0, 'img 0.png', 'queued'],
      [1, 'img 1.png', 'queued'],
    ]);
    expect(readdirSync(path.join(jobDir(res.body.id), 'input')).sort()).toEqual(['0.png', '1.png']);
    // Nothing is left behind in the upload staging directory.
    expect(readdirSync(incomingDir())).toEqual([]);
    expect(segmentWithMl).not.toHaveBeenCalled();
  });

  it('rejects everything wrong at once and keeps no files', async () => {
    const res = await createJob(alice, [PNG(1), Buffer.from('not an image')], {
      model: 'microtubule',
      threshold: '0.5',
      output_format: 'coco',
    });
    expect(res.status).toBe(422);
    expect(Object.keys(fieldErrors(res)).sort()).toEqual([
      'images[1]',
      'output_format',
      'threshold',
    ]);
    expect(fieldErrors(res).output_format).toBe('Unknown field.');
    expect(rows.size).toBe(0);
    await vi.waitFor(() => expect(readdirSync(incomingDir())).toEqual([]));
  });

  it('needs at least one image, and no more than the maximum', async () => {
    const none = await createJob(alice, []).field('page', '0');
    expect(none.status).toBe(422);
    expect(fieldErrors(none).images).toContain(`1 and ${JOB_MAX_ITEMS}`);

    const many = await createJob(
      alice,
      Array.from({ length: JOB_MAX_ITEMS + 1 }, (_, i) => PNG(i))
    );
    expect(many.status).toBe(422);
    expect(rows.size).toBe(0);
  });

  it('refuses a new job BEFORE reading the upload once the account is at its limit', async () => {
    for (let i = 0; i < MAX_ACTIVE_JOBS_PER_USER; i++) {
      expect((await createJob(alice)).status).toBe(202);
    }
    // A body the parser would answer 415 to: if admission ran after parsing,
    // that is what would come back.
    const refused = await request(app)
      .post('/api/v1/jobs')
      .set('Authorization', alice)
      .send({ model: 'segformer' });
    expect(refused.status).toBe(429);
    expect(refused.body.code).toBe('too-many-jobs');

    // Another account is unaffected, and finishing a job frees a place.
    expect((await createJob(keyFor('bob'))).status).toBe(202);
    await drain();
    expect((await createJob(alice)).status).toBe(202);
  });

  it('needs an API key', async () => {
    const res = await request(app).post('/api/v1/jobs').field('model', 'segformer');
    expect(res.status).toBe(401);
  });
});

describe('Idempotency-Key', () => {
  it('returns the job already created for the same key and request', async () => {
    const first = await createJob(alice, [PNG(1)], { model: 'segformer' }, { 'Idempotency-Key': 'abc-123' });
    expect(first.status).toBe(202);

    for (const header of ['abc-123', '"abc-123"']) {
      const again = await createJob(alice, [PNG(1)], { model: 'segformer' }, { 'Idempotency-Key': header });
      expect(again.status).toBe(200);
      expect(again.headers['idempotent-replayed']).toBe('true');
      expect(again.body.id).toBe(first.body.id);
    }
    expect(rows.size).toBe(1);
    await vi.waitFor(() => expect(readdirSync(incomingDir())).toEqual([]));
  });

  it.each([
    ['a different file', [PNG(9)], { model: 'segformer' }],
    ['a different model', [PNG(1)], { model: 'hrnet' }],
    ['a different parameter', [PNG(1)], { model: 'segformer', threshold: '0.3' }],
    ['a different page', [PNG(1)], { model: 'segformer', page: '1' }],
    ['an extra file', [PNG(1), PNG(1)], { model: 'segformer' }],
  ])('refuses the same key with %s', async (_name, files, fields) => {
    await createJob(alice, [PNG(1)], { model: 'segformer' }, { 'Idempotency-Key': 'k' });
    const res = await createJob(alice, files as Buffer[], fields as any, { 'Idempotency-Key': 'k' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('idempotency-key-reused');
    expect(rows.size).toBe(1);
  });

  it('scopes the key to the account', async () => {
    const a = await createJob(alice, [PNG(1)], { model: 'segformer' }, { 'Idempotency-Key': 'shared' });
    const b = await createJob(keyFor('bob'), [PNG(1)], { model: 'segformer' }, { 'Idempotency-Key': 'shared' });
    expect([a.status, b.status]).toEqual([202, 202]);
    expect(a.body.id).not.toBe(b.body.id);
  });

  it('rejects an empty or oversized key', async () => {
    const res = await createJob(alice, [PNG(1)], { model: 'segformer' }, { 'Idempotency-Key': 'x'.repeat(256) });
    expect(res.status).toBe(422);
    expect(fieldErrors(res)['Idempotency-Key']).toContain('255');
  });
});

describe('the worker', () => {
  it('runs each image as the synchronous endpoint would, then finishes the job', async () => {
    const created = await createJob(alice, [PNG(1), PNG(2)], { model: 'hrnet', threshold: '0.7', page: '0' });
    const id = created.body.id;

    await tick();
    const mid = await get(alice, `/api/v1/jobs/${id}`);
    expect(mid.body.status).toBe('processing');
    expect(mid.headers['retry-after']).toBe('5');
    expect(mid.body.counts).toMatchObject({ succeeded: 1, queued: 1 });
    expect(mid.body.started_at).not.toBeNull();

    await tick();
    const done = await get(alice, `/api/v1/jobs/${id}`);
    expect(done.body.status).toBe('succeeded');
    expect(done.headers['retry-after']).toBeUndefined();
    expect(done.body.completed_at).not.toBeNull();
    expect(
      new Date(done.body.expires_at).getTime() - new Date(done.body.completed_at).getTime()
    ).toBe(JOB_RESULT_TTL_MS);
    expect(done.body.items[0]).toEqual({
      index: 0,
      filename: 'img 0.png',
      status: 'succeeded',
      object_count: 1,
      width: 40,
      height: 30,
      warnings: [],
      inference_ms: 200,
      result_url: `/api/v1/jobs/${id}/results/0`,
    });

    // What the model was asked, per image.
    expect(segmentWithMl).toHaveBeenCalledTimes(2);
    expect(segmentWithMl.mock.calls[0][0]).toMatchObject({
      filename: 'upload.png',
      model: 'hrnet',
      threshold: 0.7,
      detectHoles: true,
      page: 0,
      maxPixels: JOB_MAX_PIXELS,
    });
    expect(segmentWithMl.mock.calls[0][0].image.equals(PNG(1))).toBe(true);
    expect(segmentWithMl.mock.calls[1][0].image.equals(PNG(2))).toBe(true);

    // Inputs are gone; results are there.
    expect(existsSync(path.join(jobDir(id), 'input'))).toBe(false);
    expect(existsSync(resultPath(id, 1))).toBe(true);
    expect(Number(rows.get(id).inputBytes)).toBe(0);
  });

  it('keeps the tighter pixel ceiling for the model that runs at native resolution', async () => {
    expect(jobMaxPixels('spheroid_disintegration')).toBe(SYNC_MAX_PIXELS);
    expect(jobMaxPixels('segformer')).toBe(JOB_MAX_PIXELS);
    await createJob(alice, [PNG(1)], { model: 'spheroid_disintegration' });
    await drain();
    expect(segmentWithMl.mock.calls[0][0].maxPixels).toBe(SYNC_MAX_PIXELS);
  });

  it('records a failed image with its problem code and carries on', async () => {
    segmentWithMl
      .mockRejectedValueOnce(new MlRejectedError(413, { width: 9000, height: 9000, pixels: 81_000_000 }))
      .mockRejectedValueOnce(new MlTimeoutError('x'))
      .mockRejectedValueOnce(new Error('boom: /secret/path'))
      .mockResolvedValueOnce(mlResult());
    const created = await createJob(alice, [PNG(1), PNG(2), PNG(3), PNG(4)]);
    await drain();

    const job = (await get(alice, `/api/v1/jobs/${created.body.id}`)).body;
    expect(job.status).toBe('partially_succeeded');
    expect(job.counts).toMatchObject({ succeeded: 1, failed: 3 });
    expect(job.items.map((i: any) => i.error?.code)).toEqual([
      'image-too-large',
      'segmentation-timeout',
      'internal-error',
      undefined,
    ]);
    expect(job.items[0].error.detail).toContain('9000 x 9000');
    expect(JSON.stringify(job)).not.toContain('secret');
    expect(job.items[0].result_url).toBeUndefined();

    const failed = await get(alice, `/api/v1/jobs/${created.body.id}/results/0`);
    expect(failed.status).toBe(409);
    expect(failed.body).toMatchObject({
      code: 'result-unavailable',
      item_error: { code: 'image-too-large' },
    });
  });

  it('calls a job with no usable image failed', async () => {
    segmentWithMl.mockRejectedValue(new MlTimeoutError('x'));
    const created = await createJob(alice, [PNG(1), PNG(2)]);
    await drain();
    expect((await get(alice, `/api/v1/jobs/${created.body.id}`)).body.status).toBe('failed');
  });

  it('puts an image back when the ML queue is full, instead of failing it', async () => {
    segmentWithMl.mockRejectedValueOnce(new MlBusyError('full'));
    const created = await createJob(alice, [PNG(1)]);
    await tick();
    const job = (await get(alice, `/api/v1/jobs/${created.body.id}`)).body;
    expect(job.items[0].status).toBe('queued');
    expect(existsSync(inputPath(created.body.id, { index: 0, ext: 'png' } as any))).toBe(true);
    await tick();
    expect((await get(alice, `/api/v1/jobs/${created.body.id}`)).body.status).toBe('succeeded');
  });

  it('takes turns between jobs rather than finishing one first', async () => {
    const big = await createJob(alice, [PNG(1), PNG(2), PNG(3)]);
    const small = await createJob(keyFor('bob'), [PNG(9)]);
    const order: number[] = [];
    segmentWithMl.mockImplementation(async ({ image }: any) => {
      order.push(image[8]);
      return mlResult();
    });
    await drain();
    // bob's single image is second, not fourth.
    expect(order).toEqual([1, 9, 2, 3]);
    expect(rows.get(big.body.id).status).toBe('succeeded');
    expect(rows.get(small.body.id).status).toBe('succeeded');
  });

  it('re-queues an image that was mid-flight when the process died', async () => {
    const created = await createJob(alice, [PNG(1), PNG(2)]);
    const row = rows.get(created.body.id);
    const items = JSON.parse(row.items);
    items[0].status = 'processing';
    Object.assign(row, { items: JSON.stringify(items), status: 'processing' });

    expect(await recoverInterrupted()).toBe(1);
    await drain();
    expect(rows.get(created.body.id).status).toBe('succeeded');
    expect(segmentWithMl).toHaveBeenCalledTimes(2);
  });
});

describe('results', () => {
  let id: string;
  beforeEach(async () => {
    segmentWithMl.mockResolvedValue(
      mlResult({
        polygons: [
          { id: 'p0', type: 'external', class: 'spheroid', points: ring(2, 20) },
          { id: 'p1', type: 'internal', parent_id: 'p0', class: 'spheroid', points: ring(6, 12) },
        ],
      })
    );
    id = (await createJob(alice, [PNG(1)])).body.id;
  });

  it('are not there until the image has run', async () => {
    const res = await get(alice, `/api/v1/jobs/${id}/results/0`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('result-not-ready');
    expect(res.headers['retry-after']).toBe('5');
  });

  it('can be read in every format from ONE inference', async () => {
    await drain();
    const json = await get(alice, `/api/v1/jobs/${id}/results/0`);
    expect(json.status).toBe(200);
    expect(json.body).toMatchObject({
      model: 'segformer',
      image: { width: 40, height: 30 },
      parameters: { threshold: 0.5, detect_holes: true },
    });
    expect(json.body.objects[0].holes).toHaveLength(1);
    expect(json.body.modelInfo).toBeUndefined();

    for (const [format, type, filename] of [
      ['coco', /^application\/json/, 'img 0.coco.json'],
      ['mask_png', /^image\/png/, 'img 0.labels.png'],
      ['mask_tiff', /^image\/tiff/, 'img 0.labels.tif'],
      ['imagej_roi', /^application\/zip/, 'img 0.RoiSet.zip'],
      ['yolo', /^application\/zip/, 'img 0.yolo.zip'],
    ] as const) {
      const res = await get(alice, `/api/v1/jobs/${id}/results/0?output_format=${format}`);
      expect(res.status, format).toBe(200);
      expect(res.headers['content-type']).toMatch(type);
      expect(res.headers['content-disposition']).toContain(`filename="${filename}"`);
      expect(res.headers['spheroseg-object-count']).toBe('1');
    }
    expect(segmentWithMl).toHaveBeenCalledTimes(1);
  });

  it('validate the format against the model, and Accept against the format', async () => {
    await drain();
    const bad = await get(alice, `/api/v1/jobs/${id}/results/0?output_format=gif&x=1`);
    expect(bad.status).toBe(422);
    expect(Object.keys(fieldErrors(bad)).sort()).toEqual(['output_format', 'x']);

    const refused = await get(alice, `/api/v1/jobs/${id}/results/0?output_format=mask_png`).set(
      'Accept',
      'application/json'
    );
    expect(refused.status).toBe(406);
  });

  it('refuses yolo for a polyline model', async () => {
    segmentWithMl.mockResolvedValue(mlResult({ polygons: [], polylines: [] }));
    const job = (await createJob(alice, [PNG(1)], { model: 'sperm' })).body.id;
    await drain();
    const res = await get(alice, `/api/v1/jobs/${job}/results/0?output_format=yolo`);
    expect(res.status).toBe(422);
    expect(fieldErrors(res).output_format).toContain('polylines');
  });

  it.each(['1', '99', '-1', 'abc', '0x0'])('404 for image index %s', async index => {
    await drain();
    const res = await get(alice, `/api/v1/jobs/${id}/results/${index}`);
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(PROBLEM);
  });
});

describe('ownership', () => {
  it('hides a job from every other account, on every route', async () => {
    const id = (await createJob(alice, [PNG(1)])).body.id;
    await drain();
    const mallory = keyFor('mallory');

    for (const [method, url] of [
      ['get', `/api/v1/jobs/${id}`],
      ['get', `/api/v1/jobs/${id}/results/0`],
      ['post', `/api/v1/jobs/${id}/cancel`],
      ['delete', `/api/v1/jobs/${id}`],
    ] as const) {
      const res = await request(app)[method](url).set('Authorization', mallory);
      expect(res.status, `${method} ${url}`).toBe(404);
    }
    expect((await get(mallory, '/api/v1/jobs')).body.data).toEqual([]);
    expect(rows.has(id)).toBe(true);
    expect(existsSync(resultPath(id, 0))).toBe(true);

    // Another key of the SAME account does see it.
    const owner = rows.get(id).userId;
    expect((await get(keyFor(owner), `/api/v1/jobs/${id}`)).status).toBe(200);
  });

  it.each(['nope', '../../etc', '%2e%2e'])('404 for the malformed id %s', async id => {
    expect((await get(alice, `/api/v1/jobs/${id}`)).status).toBe(404);
  });

  it('lists the caller own jobs, newest first, without items', async () => {
    const first = (await createJob(alice)).body.id;
    const second = (await createJob(alice)).body.id;
    const res = await get(alice, '/api/v1/jobs');
    expect(res.body.data.map((j: any) => j.id)).toEqual([second, first]);
    expect(res.body.data[0].items).toBeUndefined();
    expect(res.body.data[0].counts.total).toBe(1);
  });
});

describe('cancel and delete', () => {
  it('cancels images not yet started and keeps the results already made', async () => {
    const id = (await createJob(alice, [PNG(1), PNG(2), PNG(3)])).body.id;
    await tick();
    const res = await request(app).post(`/api/v1/jobs/${id}/cancel`).set('Authorization', alice);
    expect(res.status).toBe(200);
    await drain();

    const job = (await get(alice, `/api/v1/jobs/${id}`)).body;
    expect(job.status).toBe('canceled');
    expect(job.items.map((i: any) => i.status)).toEqual(['succeeded', 'canceled', 'canceled']);
    expect(segmentWithMl).toHaveBeenCalledTimes(1);
    expect((await get(alice, `/api/v1/jobs/${id}/results/0`)).status).toBe(200);
    const skipped = await get(alice, `/api/v1/jobs/${id}/results/1`);
    expect(skipped.status).toBe(409);
    expect(skipped.body.code).toBe('result-unavailable');
    expect(existsSync(path.join(jobDir(id), 'input'))).toBe(false);
  });

  it('honours a cancel that arrives while an image is running', async () => {
    const id = (await createJob(alice, [PNG(1), PNG(2)])).body.id;
    segmentWithMl.mockImplementationOnce(async () => {
      await request(app).post(`/api/v1/jobs/${id}/cancel`).set('Authorization', alice);
      return mlResult();
    });
    await drain();
    const job = (await get(alice, `/api/v1/jobs/${id}`)).body;
    expect(job.items.map((i: any) => i.status)).toEqual(['succeeded', 'canceled']);
    expect(job.status).toBe('canceled');
  });

  it('is a no-op on a finished job: it stays what it was', async () => {
    const id = (await createJob(alice, [PNG(1)])).body.id;
    await drain();
    for (let i = 0; i < 2; i++) {
      const res = await request(app).post(`/api/v1/jobs/${id}/cancel`).set('Authorization', alice);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('succeeded');
    }
    expect(rows.get(id).cancelRequested).toBe(false);
  });

  it('deletes the job and its files, even while it is running', async () => {
    const id = (await createJob(alice, [PNG(1), PNG(2)])).body.id;
    segmentWithMl.mockImplementationOnce(async () => {
      const res = await request(app).delete(`/api/v1/jobs/${id}`).set('Authorization', alice);
      expect(res.status).toBe(204);
      return mlResult();
    });
    await drain();
    expect(rows.has(id)).toBe(false);
    expect(existsSync(jobDir(id))).toBe(false);
    expect((await get(alice, `/api/v1/jobs/${id}`)).status).toBe(404);
  });
});

describe('expiry', () => {
  it('deletes results when they expire, then the row a week later', async () => {
    const id = (await createJob(alice, [PNG(1)])).body.id;
    await drain();
    const expiresAt = rows.get(id).expiresAt as Date;

    await sweep(new Date(expiresAt.getTime() - 1));
    expect(rows.get(id).status).toBe('succeeded');
    expect(existsSync(resultPath(id, 0))).toBe(true);

    await sweep(new Date(expiresAt.getTime()));
    expect(rows.get(id).status).toBe('expired');
    expect(existsSync(jobDir(id))).toBe(false);
    const job = (await get(alice, `/api/v1/jobs/${id}`)).body;
    expect(job.status).toBe('expired');
    expect(job.items[0].result_url).toBeUndefined();
    const gone = await get(alice, `/api/v1/jobs/${id}/results/0`);
    expect(gone.status).toBe(410);
    expect(gone.body.code).toBe('result-expired');

    await sweep(new Date(expiresAt.getTime() + JOB_ROW_TTL_MS - 1));
    expect(rows.has(id)).toBe(true);
    await sweep(new Date(expiresAt.getTime() + JOB_ROW_TTL_MS));
    expect(rows.has(id)).toBe(false);
  });

  it('never expires a job that is still running', async () => {
    const id = (await createJob(alice, [PNG(1)])).body.id;
    await sweep(new Date(Date.now() + 10 * JOB_ROW_TTL_MS));
    expect(rows.get(id).status).toBe('queued');
    expect(existsSync(inputPath(id, { index: 0, ext: 'png' } as any))).toBe(true);
  });

  it('removes uploads abandoned in the staging directory, but not fresh ones', async () => {
    const { promises: fs } = await import('fs');
    const stale = path.join(incomingDir(), 'stale');
    const fresh = path.join(incomingDir(), 'fresh');
    await fs.writeFile(stale, 'x');
    await fs.writeFile(fresh, 'x');
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await fs.utimes(stale, old, old);
    await sweep();
    expect(readdirSync(incomingDir())).toEqual(['fresh']);
  });
});
