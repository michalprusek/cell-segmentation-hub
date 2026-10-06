/**
 * `POST /api/v1/segment` through the REAL router: real API-key auth, real
 * multipart parsing, real validation, real object building and real format
 * rendering. The only double besides the database is the call to the ML
 * service itself — everything that decides what the client gets is live.
 */
import request from 'supertest';
import express from 'express';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.unmock('sharp');
vi.unmock('archiver');
vi.unmock('multer');

vi.mock('../../../db', () => ({
  __esModule: true,
  prisma: { apiKey: { findUnique: vi.fn(), update: vi.fn(async () => ({})) } },
}));
vi.mock('../../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../../utils/config', () => ({
  config: { SEGMENTATION_SERVICE_URL: 'http://ml.test:8000' },
}));

const segmentWithMl = vi.fn();
vi.mock('../mlClient', async importOriginal => ({
  ...(await importOriginal<typeof import('../mlClient')>()),
  segmentWithMl: (...args: unknown[]) => segmentWithMl(...args),
}));

import v1Routes from '../index';
import { prisma } from '../../../db';
import { generateApiKey, hashApiKey } from '../../../services/apiKeyService';
import {
  MlBusyError,
  MlRejectedError,
  MlTimeoutError,
  MlUnavailableError,
} from '../mlClient';
import {
  MAX_CONCURRENT_PER_KEY,
  SYNC_MAX_PIXELS,
  contentDisposition,
  safeBasename,
  sniffImageExtension,
} from '../segment';

const PROBLEM = /^application\/problem\+json/;
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32, 7),
]);

const app = express();
app.use('/api/v1', v1Routes);

let auth: string;
const newKey = () => {
  const key = generateApiKey();
  const hash = hashApiKey(key);
  const id = `key-${Math.random().toString(36).slice(2)}`;
  const previous = vi.mocked(prisma.apiKey.findUnique).getMockImplementation();
  vi.mocked(prisma.apiKey.findUnique).mockImplementation((async (args: {
    where: { keyHash: string };
  }) =>
    args.where.keyHash === hash
      ? {
          id,
          name: 'k',
          prefix: key.slice(0, 9),
          expiresAt: null,
          lastUsedAt: new Date(),
          user: { id: 'u', email: 'u@example.com', emailVerified: true },
        }
      : ((await (previous as any)?.(args)) ?? null)) as never);
  return `Bearer ${key}`;
};

const ring = (a: number, b: number) => [
  { x: a, y: a },
  { x: b, y: a },
  { x: b, y: b },
  { x: a, y: b },
];

const mlResult = (overrides = {}) => ({
  polygons: [
    { id: 'polygon_0', type: 'external', class: 'spheroid', confidence: 0.9, points: ring(2, 20) },
    { id: 'polygon_1', type: 'internal', parent_id: 'polygon_0', class: 'spheroid', points: ring(6, 12) },
  ],
  image_size: { width: 40, height: 30 },
  inference_time: 0.25,
  page: 0,
  page_count: 1,
  ...overrides,
});

const post = (fields: Record<string, string> = { model: 'segformer' }, file: Buffer | null = PNG, name = 'frame.png') => {
  const req = request(app).post('/api/v1/segment').set('Authorization', auth);
  for (const [k, v] of Object.entries(fields)) req.field(k, v);
  if (file) req.attach('image', file, name);
  return req;
};

const fieldErrors = (res: request.Response) =>
  Object.fromEntries(
    (res.body.errors as Array<{ field: string; detail: string }>).map(e => [e.field, e.detail])
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.apiKey.findUnique).mockReset();
  segmentWithMl.mockReset();
  segmentWithMl.mockResolvedValue(mlResult());
  auth = newKey();
});

describe('the happy path', () => {
  it('returns objects that own their holes, as [x, y] pairs', async () => {
    const res = await post();

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['spheroseg-object-count']).toBe('1');
    expect(res.headers['content-disposition']).toBeUndefined();
    expect(res.body).toEqual({
      model: 'segformer',
      image: { width: 40, height: 30, page: 0, page_count: 1 },
      parameters: { threshold: 0.5, detect_holes: true },
      objects: [
        {
          label: 1,
          geometry: 'polygon',
          class: 'spheroid',
          confidence: 0.9,
          points: [
            [2, 2],
            [20, 2],
            [20, 20],
            [2, 20],
          ],
          holes: [
            [
              [6, 6],
              [12, 6],
              [12, 12],
              [6, 12],
            ],
          ],
        },
      ],
      warnings: [],
      timing: { inference_ms: 250 },
    });
  });

  it('hands the ML service the bytes, a sniffed extension and the limits', async () => {
    await post({ model: 'hrnet', threshold: '0.7', detect_holes: 'false', page: '2' }, PNG, 'whatever.dat');
    const sent = segmentWithMl.mock.calls[0][0];
    expect(sent.image.equals(PNG)).toBe(true);
    expect(sent).toMatchObject({
      filename: 'upload.png',
      model: 'hrnet',
      threshold: 0.7,
      detectHoles: false,
      page: 2,
      maxPixels: SYNC_MAX_PIXELS,
    });
  });

  it('sends neither threshold nor detect_holes to a model that reads neither', async () => {
    segmentWithMl.mockResolvedValue(mlResult({ polygons: [], polylines: [] }));
    const res = await post({ model: 'microtubule' });
    expect(res.status).toBe(200);
    expect(res.body.parameters).toEqual({});
    const sent = segmentWithMl.mock.calls[0][0];
    expect(sent.threshold).toBeUndefined();
    expect(sent.detectHoles).toBeUndefined();
  });

  it('passes image metrics through', async () => {
    segmentWithMl.mockResolvedValue(mlResult({ image_metrics: { DI: 0.41 } }));
    const res = await post({ model: 'spheroid_disintegration' });
    expect(res.body.metrics).toEqual({ DI: 0.41 });
  });
});

describe('warnings', () => {
  it('says which page of a stack was segmented, an input conversion, model warnings and an empty result', async () => {
    segmentWithMl.mockResolvedValue(
      mlResult({
        polygons: [],
        page_count: 5,
        input_conversion: {
          from_mode: 'I;16',
          method: 'percentile_stretch',
          low_percentile: 0.1,
          high_percentile: 99.9,
          low: 300,
          high: 4000,
        },
        warnings: ['frame is not 2048 x 2048'],
      })
    );
    const res = await post({ model: 'spheroid_disintegration', page: '3' });

    expect(res.body.warnings.map((w: { code: string }) => w.code)).toEqual([
      'multipage_image',
      'input_depth_converted',
      'model_warning',
      'no_objects',
    ]);
    expect(res.body.warnings[0].detail).toContain('5 pages; only page 3');
    expect(res.body.warnings[1].detail).toContain('[300, 4000]');
    expect(res.headers['spheroseg-warnings']).toBe(
      'multipage_image, input_depth_converted, model_warning, no_objects'
    );
  });
});

describe('output formats', () => {
  it.each([
    ['coco', /^application\/json/, 'frame.coco.json'],
    ['mask_png', /^image\/png/, 'frame.labels.png'],
    ['mask_tiff', /^image\/tiff/, 'frame.labels.tif'],
    ['imagej_roi', /^application\/zip/, 'frame.RoiSet.zip'],
    ['yolo', /^application\/zip/, 'frame.yolo.zip'],
  ])('%s is served as a download of the right type', async (format, type, filename) => {
    const res = await post({ model: 'segformer', output_format: format })
      .buffer(true)
      .parse((r, done) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => done(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(type);
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="${filename}"; filename*=UTF-8''${filename}`
    );
    expect(res.headers['spheroseg-object-count']).toBe('1');
    expect((res.body as Buffer).length).toBeGreaterThan(50);
  });

  it('keeps a non-ASCII upload name intact in the download name', async () => {
    const res = await post(
      { model: 'segformer', output_format: 'mask_png' },
      PNG,
      'snímek ž.tif'
    );
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="sn_mek _.labels.png"; filename*=UTF-8\'\'sn%C3%ADmek%20%C5%BE.labels.png'
    );
  });

  it('refuses yolo for a polyline model before running anything', async () => {
    const res = await post({ model: 'sperm', output_format: 'yolo' });
    expect(res.status).toBe(422);
    expect(fieldErrors(res).output_format).toContain('polylines');
    expect(segmentWithMl).not.toHaveBeenCalled();
  });

  it('answers 406 when Accept excludes the chosen format, listing its type', async () => {
    const res = await post({ model: 'segformer', output_format: 'mask_png' }).set(
      'Accept',
      'application/json'
    );
    expect(res.status).toBe(406);
    expect(res.headers['content-type']).toMatch(PROBLEM);
    expect(res.body).toMatchObject({ code: 'not-acceptable', content_type: 'image/png' });
  });

  it.each(['image/png', 'image/*', '*/*'])('accepts Accept: %s for mask_png', async accept => {
    const res = await post({ model: 'segformer', output_format: 'mask_png' }).set('Accept', accept);
    expect(res.status).toBe(200);
  });
});

describe('validation: everything wrong is reported at once, and nothing runs', () => {
  it('lists every bad field', async () => {
    const res = await post({
      model: 'nope',
      threshold: '5',
      detect_holes: 'yes',
      page: '-1',
      output_format: 'gif',
      treshold: '0.4',
    });
    expect(res.status).toBe(422);
    expect(res.headers['content-type']).toMatch(PROBLEM);
    expect(res.body.code).toBe('validation-failed');
    expect(Object.keys(fieldErrors(res)).sort()).toEqual([
      'detect_holes',
      'model',
      'output_format',
      'page',
      'threshold',
      'treshold',
    ]);
    expect(fieldErrors(res).treshold).toBe('Unknown field.');
    expect(fieldErrors(res).model).toContain('segformer');
    expect(segmentWithMl).not.toHaveBeenCalled();
  });

  it('requires a model and an image', async () => {
    // A multipart body with neither: `page` only keeps it multipart.
    const res = await post({ page: '0' }, null);
    expect(res.status).toBe(422);
    expect(Object.keys(fieldErrors(res)).sort()).toEqual(['image', 'model']);
  });

  it.each([
    ['threshold', '0.5', 'microtubule'],
    ['threshold', '0.5', 'sperm'],
    ['threshold', '0.5', 'neurite_soma'],
    ['threshold', '0.5', 'spheroid_disintegration'],
    ['detect_holes', 'true', 'microcapsule'],
    ['detect_holes', 'false', 'sperm_2part'],
  ])('refuses %s=%s for %s rather than dropping it', async (field, value, model) => {
    const res = await post({ model, [field]: value });
    expect(res.status).toBe(422);
    expect(fieldErrors(res)[field]).toContain(`${model} model does not use`);
    expect(segmentWithMl).not.toHaveBeenCalled();
  });

  it.each(['1.5', 'abc', '0.5.5'])('rejects page=%s', async page => {
    const res = await post({ model: 'segformer', page });
    expect(res.status).toBe(422);
    expect(Object.keys(fieldErrors(res))).toEqual(['page']);
  });

  it('refuses a second file part', async () => {
    const res = await request(app)
      .post('/api/v1/segment')
      .set('Authorization', auth)
      .field('model', 'segformer')
      .attach('image', PNG, 'a.png')
      .attach('image', PNG, 'b.png');
    expect(res.status).toBe(422);
    expect(segmentWithMl).not.toHaveBeenCalled();
  });

  it('refuses a file under another field name', async () => {
    const res = await request(app)
      .post('/api/v1/segment')
      .set('Authorization', auth)
      .field('model', 'segformer')
      .attach('file', PNG, 'a.png');
    expect(res.status).toBe(422);
    expect(fieldErrors(res).file).toContain('named "image"');
  });

  it('answers 415 to a JSON body', async () => {
    const res = await request(app)
      .post('/api/v1/segment')
      .set('Authorization', auth)
      .send({ model: 'segformer' });
    expect(res.status).toBe(415);
    expect(res.body.code).toBe('unsupported-media-type');
  });

  it('judges the file by its bytes, not its name', async () => {
    const res = await post({ model: 'segformer' }, Buffer.from('not an image at all'), 'photo.png');
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('unsupported-image');
    expect(segmentWithMl).not.toHaveBeenCalled();
  });

  it('requires an API key', async () => {
    const res = await request(app).post('/api/v1/segment').field('model', 'segformer').attach('image', PNG, 'a.png');
    expect(res.status).toBe(401);
    expect(segmentWithMl).not.toHaveBeenCalled();
  });
});

describe('failures of the ML service become problems, never a leak', () => {
  it('maps a pixel-ceiling refusal to 413 with the size', async () => {
    segmentWithMl.mockRejectedValue(
      new MlRejectedError(413, { width: 9000, height: 9000, pixels: 81_000_000 })
    );
    const res = await post();
    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({
      code: 'image-too-large',
      width: 9000,
      height: 9000,
      max_pixels: SYNC_MAX_PIXELS,
    });
  });

  it('maps an out-of-range page to a field error', async () => {
    segmentWithMl.mockRejectedValue(
      new MlRejectedError(400, 'page 7 is out of range: the image has 3 page(s)')
    );
    const res = await post({ model: 'segformer', page: '7' });
    expect(res.status).toBe(422);
    expect(fieldErrors(res).page).toContain('3 page(s)');
  });

  it('maps an undecodable image to 422 unsupported-image', async () => {
    segmentWithMl.mockRejectedValue(
      new MlRejectedError(400, 'The file could not be decoded as an image: UnidentifiedImageError')
    );
    const res = await post();
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('unsupported-image');
  });

  it.each([
    [new MlBusyError('x'), 503, 'server-busy', '10'],
    [new MlTimeoutError('x'), 504, 'segmentation-timeout', undefined],
    [new MlUnavailableError('ML service answered 500'), 502, 'segmentation-failed', undefined],
  ])('maps %o', async (error, status, code, retryAfter) => {
    segmentWithMl.mockRejectedValue(error);
    const res = await post();
    expect(res.status).toBe(status);
    expect(res.headers['content-type']).toMatch(PROBLEM);
    expect(res.body.code).toBe(code);
    expect(res.headers['retry-after']).toBe(retryAfter);
    expect(JSON.stringify(res.body)).not.toContain('answered 500');
  });

  it('answers 500 without detail for anything unexpected', async () => {
    segmentWithMl.mockResolvedValue({ polygons: [] }); // no image_size
    const res = await post();
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('internal-error');
    expect(res.body.detail).toBeUndefined();
  });
});

describe('concurrency per key', () => {
  it('lets a key hold only so many segmentations, and frees the slot afterwards', async () => {
    const release: Array<() => void> = [];
    segmentWithMl.mockImplementation(
      () => new Promise(resolve => release.push(() => resolve(mlResult())))
    );

    const running = Array.from({ length: MAX_CONCURRENT_PER_KEY }, () => post().then(r => r));
    await vi.waitFor(() => expect(segmentWithMl).toHaveBeenCalledTimes(MAX_CONCURRENT_PER_KEY));

    const refused = await post();
    expect(refused.status).toBe(429);
    expect(refused.body.code).toBe('too-many-concurrent-requests');
    expect(refused.headers['retry-after']).toBe('5');

    // Another key is unaffected.
    const otherAuth = newKey();
    const other = request(app)
      .post('/api/v1/segment')
      .set('Authorization', otherAuth)
      .field('model', 'segformer')
      .attach('image', PNG, 'a.png')
      .then(r => r);
    await vi.waitFor(() => expect(segmentWithMl).toHaveBeenCalledTimes(MAX_CONCURRENT_PER_KEY + 1));

    release.forEach(r => r());
    expect((await Promise.all([...running, other])).map(r => r.status)).toEqual(
      Array(MAX_CONCURRENT_PER_KEY + 1).fill(200)
    );

    segmentWithMl.mockResolvedValue(mlResult());
    expect((await post()).status).toBe(200);
  });

  it('frees the slot when the segmentation fails', async () => {
    segmentWithMl.mockRejectedValue(new MlTimeoutError('x'));
    for (let i = 0; i < MAX_CONCURRENT_PER_KEY + 1; i++) {
      expect((await post()).status).toBe(504);
    }
  });
});

describe('helpers', () => {
  it.each([
    [[0x89, 0x50, 0x4e, 0x47], 'png'],
    [[0xff, 0xd8, 0xff, 0xe0], 'jpg'],
    [[0x49, 0x49, 0x2a, 0x00], 'tif'],
    [[0x4d, 0x4d, 0x00, 0x2a], 'tif'],
    [[0x49, 0x49, 0x2b, 0x00], 'tif'],
    [[0x4d, 0x4d, 0x00, 0x2b], 'tif'],
    [[0x42, 0x4d, 0x00, 0x00], 'bmp'],
    [[0x47, 0x49, 0x46, 0x38], null],
    [[0x25, 0x50, 0x44, 0x46], null],
    [[0x89, 0x50], null],
  ])('sniffs %j as %s', (bytes, expected) => {
    expect(sniffImageExtension(Buffer.from(bytes))).toBe(expected);
  });

  it('reduces an uploaded name to a safe basename', () => {
    expect(safeBasename('../../etc/passwd')).toBe('passwd');
    expect(safeBasename('C:\\Users\\me\\frame.tif')).toBe('frame.tif');
    expect(safeBasename('a"b\r\nSet-Cookie: x.png')).toBe('abSet-Cookie: x.png');
    expect(safeBasename(undefined)).toBe('image');
    expect(safeBasename('')).toBe('image');
  });

  it('writes Content-Disposition with an ASCII fallback and a UTF-8 form', () => {
    expect(contentDisposition('snímek (1).labels.png')).toBe(
      'attachment; filename="sn_mek (1).labels.png"; filename*=UTF-8\'\'sn%C3%ADmek%20%281%29.labels.png'
    );
  });
});
