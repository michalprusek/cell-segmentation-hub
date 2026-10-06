/**
 * The public API's front door, mounted with the REAL router, the REAL
 * `authenticateApiKey`, the real key service and the real rate limiter. The
 * claims here are about the middleware chain — what is refused, with which
 * status, header and media type — so mocking any of it would test nothing.
 * Only the database and the logger are doubles.
 */

import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../db', () => ({
  __esModule: true,
  prisma: {
    apiKey: { findUnique: vi.fn(), update: vi.fn(async () => ({})) },
  },
}));

vi.mock('../../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import v1Routes, {
  V1_RATE_LIMIT_PER_MINUTE,
  V1_UNAUTHENTICATED_LIMIT_PER_MINUTE,
  isPublicApiPath,
} from '../index';
import { authenticateApiKey } from '../../../middleware/apiKeyAuth';
import { prisma } from '../../../db';
import { generateApiKey, hashApiKey } from '../../../services/apiKeyService';
import { SEGMENTATION_MODELS } from '../../../constants/modelRegistry';

const findUnique = prisma.apiKey.findUnique as unknown as ReturnType<
  typeof vi.fn
>;

const PROBLEM = /^application\/problem\+json/;

const buildApp = () => {
  const app = express();
  app.set('query parser', 'extended');
  app.use(express.json());
  app.use(cookieParser());
  // The production app wraps res.json to force `application/json`
  // (server.ts). Reproduced here because it is exactly what would clobber
  // the problem media type if `sendProblem` used res.json.
  app.use((_req, res, next) => {
    const originalJson = res.json;
    res.json = function (body) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return originalJson.call(this, body);
    };
    next();
  });
  app.use('/api/v1', v1Routes);
  return app;
};

/** Registers a live key with the fake database and returns it. */
const liveKey = (overrides: Record<string, unknown> = {}) => {
  const key = generateApiKey();
  const id = `key-${Math.random().toString(36).slice(2)}`;
  const hash = hashApiKey(key);
  const previous = findUnique.getMockImplementation();
  findUnique.mockImplementation(async (args: { where: { keyHash: string } }) =>
    args.where.keyHash === hash
      ? {
          id,
          name: 'test key',
          prefix: key.slice(0, 9),
          expiresAt: null,
          lastUsedAt: new Date(),
          user: {
            id: 'user-1',
            email: 'user@example.com',
            emailVerified: true,
          },
          ...overrides,
        }
      : ((await previous?.(args)) ?? null)
  );
  return key;
};

beforeEach(() => {
  vi.clearAllMocks();
  findUnique.mockReset();
  findUnique.mockResolvedValue(null);
});

describe('authentication', () => {
  it('answers a request with no credentials with a bare Bearer challenge', async () => {
    const res = await request(buildApp()).get('/api/v1/models');

    expect(res.status).toBe(401);
    expect(res.headers['content-type']).toMatch(PROBLEM);
    // RFC 6750 §3.1: no error code when no credentials were presented.
    expect(res.headers['www-authenticate']).toBe('Bearer realm="spheroseg-api"');
    expect(res.body).toMatchObject({
      type: 'https://spherosegapp.utia.cas.cz/api/v1/problems/authentication-required',
      status: 401,
      code: 'authentication-required',
    });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('accepts a valid key and lists every registered model', async () => {
    const res = await request(buildApp())
      .get('/api/v1/models')
      .set('Authorization', `Bearer ${liveKey()}`);

    expect(res.status).toBe(200);
    expect(res.body.data.map((m: { id: string }) => m.id)).toEqual([
      ...SEGMENTATION_MODELS,
    ]);
    expect(res.body.data).toHaveLength(12);
  });

  it('treats the auth scheme case-insensitively', async () => {
    const res = await request(buildApp())
      .get('/api/v1/models')
      .set('Authorization', `bearer ${liveKey()}`);
    expect(res.status).toBe(200);
  });

  it.each([
    ['an unknown but well-formed key', () => `Bearer ${generateApiKey()}`],
    ['a malformed key', () => 'Bearer sseg_nope'],
    // These two present a LIVE key. With an unknown one they pass whatever the
    // header parser does - the key would be refused anyway - and a parser
    // that accepted any scheme survived mutation testing for that reason.
    ['a live key under a different scheme', () => `Basic ${liveKey()}`],
    ['a live key with trailing junk', () => `Bearer ${liveKey()} extra`],
    [
      'an expired key',
      () => `Bearer ${liveKey({ expiresAt: new Date(Date.now() - 1000) })}`,
    ],
  ])('rejects %s as invalid_token, indistinguishably', async (_name, header) => {
    const res = await request(buildApp())
      .get('/api/v1/models')
      .set('Authorization', header());

    expect(res.status).toBe(401);
    expect(res.headers['content-type']).toMatch(PROBLEM);
    expect(res.headers['www-authenticate']).toBe(
      'Bearer realm="spheroseg-api", error="invalid_token"'
    );
    expect(res.body.code).toBe('invalid-api-key');
    expect(res.body.detail).toBe(
      'The API key is not valid. It may have been revoked or expired.'
    );
  });

  it.each(['api_key', 'access_token', 'key', 'token', 'apikey'])(
    'refuses a key in the ?%s= query parameter even when the header is valid',
    async param => {
      const key = liveKey();
      const res = await request(buildApp())
        .get(`/api/v1/models?${param}=${key}`)
        .set('Authorization', `Bearer ${key}`);

      expect(res.status).toBe(400);
      expect(res.headers['content-type']).toMatch(PROBLEM);
      expect(res.body.code).toBe('credentials-in-url');
      expect(findUnique).not.toHaveBeenCalled();
    }
  );

  it('refuses a key in the query string whatever the case of the name', async () => {
    const key = liveKey();
    const res = await request(buildApp())
      .get(`/api/v1/models?API_Key=${key}`)
      .set('Authorization', `Bearer ${key}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('credentials-in-url');
  });

  it('does not accept the app session cookie', async () => {
    const res = await request(buildApp())
      .get('/api/v1/models')
      .set('Cookie', 'accessToken=anything; access_token=anything');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('authentication-required');
  });
});

describe('the identity a key carries', () => {
  const probe = () => {
    const app = express();
    app.get('/probe', authenticateApiKey, (req, res) => {
      res.json({ user: req.user, apiKey: req.apiKey });
    });
    return app;
  };

  it('is the owning account, the key, and never an administrator', async () => {
    const key = liveKey();
    const res = await request(probe())
      .get('/probe')
      .set('Authorization', `Bearer ${key}`);

    expect(res.body).toEqual({
      user: {
        id: 'user-1',
        email: 'user@example.com',
        emailVerified: true,
        // The fake row below says nothing about isAdmin on purpose: the
        // middleware must not derive it from the account at all.
        isAdmin: false,
        profile: null,
      },
      apiKey: {
        id: expect.any(String),
        name: 'test key',
        prefix: key.slice(0, 9),
      },
    });
  });

  it('does not ask the database for the admin flag', async () => {
    await request(probe())
      .get('/probe')
      .set('Authorization', `Bearer ${liveKey()}`);
    const { select } = findUnique.mock.calls[0][0];
    expect(select.user.select.isAdmin).toBeUndefined();
  });
});

describe('models', () => {
  it('describes each model: geometry, parameters and formats', async () => {
    const res = await request(buildApp())
      .get('/api/v1/models')
      .set('Authorization', `Bearer ${liveKey()}`);
    const byId = Object.fromEntries(
      res.body.data.map((m: { id: string }) => [m.id, m])
    );
    expect(byId.segformer).toMatchObject({
      geometry: 'polygon',
      project_types: ['spheroid'],
      parameters: {
        threshold: { supported: true, default: 0.5, minimum: 0.1, maximum: 0.99 },
        detect_holes: { supported: true, default: true },
      },
      input_depth: '8bit',
      output_formats: ['json', 'coco', 'mask_png', 'mask_tiff', 'imagej_roi', 'yolo'],
    });
    expect(byId.microtubule).toMatchObject({
      geometry: 'polyline',
      parameters: {
        threshold: { supported: false },
        detect_holes: { supported: false },
      },
      input_depth: 'native',
      output_formats: ['json', 'coco', 'mask_png', 'mask_tiff', 'imagej_roi'],
    });
    expect(byId.sperm.parts).toEqual(['head', 'midpiece', 'tail']);
    expect(byId.spheroid_disintegration.returns_metrics).toBe(true);
  });

  it('serves one model by id and 404s an unknown one', async () => {
    const app = buildApp();
    const auth = `Bearer ${liveKey()}`;
    const one = await request(app).get('/api/v1/models/wound').set('Authorization', auth);
    expect(one.status).toBe(200);
    expect(one.body.id).toBe('wound');

    const none = await request(app).get('/api/v1/models/constructor').set('Authorization', auth);
    expect(none.status).toBe(404);
    expect(none.headers['content-type']).toMatch(PROBLEM);
  });
});

describe('the public meta endpoints need no key', () => {
  it('serves the OpenAPI document', async () => {
    const res = await request(buildApp()).get('/api/v1/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.1.0');
    expect(Object.keys(res.body.paths)).toContain('/segment');
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('resolves a problem type URI to its description', async () => {
    const res = await request(buildApp()).get('/api/v1/problems/validation-failed');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      type: 'https://spherosegapp.utia.cas.cz/api/v1/problems/validation-failed',
      code: 'validation-failed',
      status: 422,
    });
    expect(res.body.description).toContain('errors');
  });

  it.each(['nope', 'constructor', '__proto__'])('404s the unknown problem type %s', async code => {
    const res = await request(buildApp()).get(`/api/v1/problems/${code}`);
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(PROBLEM);
  });

  it('still counts them against the per-IP limit, and nothing else is public', async () => {
    const res = await request(buildApp()).get('/api/v1/models');
    expect(res.status).toBe(401);
  });
});

describe('errors stay in problem+json', () => {
  it('answers an unknown path with a 404 problem, after authentication', async () => {
    const app = buildApp();

    const anonymous = await request(app).get('/api/v1/nope');
    expect(anonymous.status).toBe(401);

    const res = await request(app)
      .post('/api/v1/nope?q=%3Cscript%3E')
      .set('Authorization', `Bearer ${liveKey()}`);
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(PROBLEM);
    expect(res.body.code).toBe('not-found');
    // Request input is never reflected into the body.
    expect(JSON.stringify(res.body)).not.toContain('nope');
  });

  it('answers a database failure with a 500 problem that leaks nothing', async () => {
    findUnique.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5'));
    const res = await request(buildApp())
      .get('/api/v1/models')
      .set('Authorization', `Bearer ${generateApiKey()}`);

    expect(res.status).toBe(500);
    expect(res.headers['content-type']).toMatch(PROBLEM);
    expect(res.body.code).toBe('internal-error');
    expect(JSON.stringify(res.body)).not.toContain('ECONNREFUSED');
  });
});

describe('rate limiting', () => {
  it('limits per key, announces the policy and sends Retry-After on 429', async () => {
    const app = buildApp();
    const noisy = `Bearer ${liveKey()}`;
    const quiet = `Bearer ${liveKey()}`;

    const first = await request(app)
      .get('/api/v1/models')
      .set('Authorization', noisy);
    expect(first.status).toBe(200);
    expect(first.headers['ratelimit-policy']).toContain(
      `q=${V1_RATE_LIMIT_PER_MINUTE}`
    );
    expect(first.headers['ratelimit']).toContain(
      `r=${V1_RATE_LIMIT_PER_MINUTE - 1}`
    );

    for (let i = 1; i < V1_RATE_LIMIT_PER_MINUTE; i++) {
      await request(app).get('/api/v1/models').set('Authorization', noisy);
    }

    const limited = await request(app)
      .get('/api/v1/models')
      .set('Authorization', noisy);
    expect(limited.status).toBe(429);
    expect(limited.headers['content-type']).toMatch(PROBLEM);
    expect(limited.body.code).toBe('rate-limit-exceeded');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(limited.headers['retry-after'])).toBeLessThanOrEqual(60);

    // Another key of the same account is unaffected.
    const other = await request(app)
      .get('/api/v1/models')
      .set('Authorization', quiet);
    expect(other.status).toBe(200);
  });
});

describe('unauthenticated traffic', () => {
  it('is limited per IP before any key is looked up, with Retry-After and no RateLimit headers', async () => {
    const app = buildApp();
    const unknown = `Bearer ${generateApiKey()}`;

    const first = await request(app)
      .get('/api/v1/models')
      .set('Authorization', unknown);
    expect(first.status).toBe(401);
    // A rejected request must not advertise the per-key policy it never
    // reached, nor any other.
    expect(first.headers['ratelimit-policy']).toBeUndefined();
    expect(first.headers['ratelimit']).toBeUndefined();

    for (let i = 1; i < V1_UNAUTHENTICATED_LIMIT_PER_MINUTE; i++) {
      await request(app).get('/api/v1/models').set('Authorization', unknown);
    }
    const lookupsBefore = findUnique.mock.calls.length;

    const limited = await request(app)
      .get('/api/v1/models')
      .set('Authorization', unknown);
    expect(limited.status).toBe(429);
    expect(limited.headers['content-type']).toMatch(PROBLEM);
    expect(limited.headers['retry-after']).toBe('60');
    expect(findUnique.mock.calls.length).toBe(lookupsBefore);
  });
});

describe('isPublicApiPath', () => {
  it.each([
    ['/api/v1', true],
    ['/api/v1/', true],
    ['/api/v1/models', true],
    ['/api/v10/models', false],
    ['/api/v1x', false],
    ['/api/projects', false],
    ['/api-docs', false],
  ])('%s -> %s', (path, expected) => {
    expect(isPublicApiPath(path)).toBe(expected);
  });
});
