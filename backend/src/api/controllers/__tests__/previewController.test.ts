import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import path from 'path';
import os from 'os';
import fsSync from 'fs';

vi.unmock('fs');
vi.unmock('fs/promises');

const h = vi.hoisted(() => ({
  prisma: { image: { findUnique: vi.fn() } },
  hasProjectAccess: vi.fn(),
  ensurePreview: vi.fn(),
}));
vi.mock('../../../db', () => ({ prisma: h.prisma }));
vi.mock('../../../services/sharingService', () => ({
  hasProjectAccess: h.hasProjectAccess,
}));
vi.mock('../../../services/previews/previewService', async () => {
  class PreviewUnavailableError extends Error {}
  return {
    previewService: { ensurePreview: h.ensurePreview },
    PreviewUnavailableError,
  };
});
vi.mock('../../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { getImagePreview } from '../previewController';
import { PreviewUnavailableError } from '../../../services/previews/previewService';

const VERSION = '0123456789abcdef';
const file = path.join(os.tmpdir(), `preview-ctrl-${process.pid}.jpg`);
fsSync.writeFileSync(file, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

function app(userId: string | null = 'user-1') {
  const a = express();
  a.use((req, _res, next) => {
    if (userId) (req as unknown as { user: { id: string } }).user = { id: userId };
    next();
  });
  a.get('/api/images/:imageId/preview', getImagePreview);
  return a;
}

beforeEach(() => {
  h.prisma.image.findUnique.mockResolvedValue({ projectId: 'proj-1' });
  h.hasProjectAccess.mockResolvedValue({ hasAccess: true, isOwner: true });
  h.ensurePreview.mockResolvedValue({ version: VERSION, filePath: file });
});

describe('GET /api/images/:imageId/preview', () => {
  it('caches the CURRENT version forever', async () => {
    const res = await request(app()).get(`/api/images/img-1/preview?v=${VERSION}`).expect(200);

    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect(res.headers.etag).toBe(`"${VERSION}"`);
  });

  it('serves the current picture uncacheable for a stale or missing version', async () => {
    for (const q of ['?v=ffffffffffffffff', '', '?v=../../etc']) {
      const res = await request(app()).get(`/api/images/img-1/preview${q}`).expect(200);
      expect(res.headers['cache-control']).toBe('private, no-cache');
    }
  });

  it('answers 404, not 403, to someone without access to the project', async () => {
    h.hasProjectAccess.mockResolvedValue({ hasAccess: false, isOwner: false });

    await request(app()).get(`/api/images/img-1/preview?v=${VERSION}`).expect(404);
    expect(h.ensurePreview).not.toHaveBeenCalled();
  });

  it('checks access against the IMAGE’s project', async () => {
    h.prisma.image.findUnique.mockResolvedValue({ projectId: 'proj-of-image' });

    await request(app()).get(`/api/images/img-1/preview`).expect(200);

    expect(h.hasProjectAccess).toHaveBeenCalledWith('proj-of-image', 'user-1');
  });

  it('answers 404 for an unknown image and for one that cannot be drawn', async () => {
    h.prisma.image.findUnique.mockResolvedValueOnce(null);
    await request(app()).get('/api/images/nope/preview').expect(404);

    h.ensurePreview.mockRejectedValueOnce(new PreviewUnavailableError('bad'));
    const res = await request(app()).get('/api/images/img-1/preview').expect(404);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('refuses an unauthenticated request', async () => {
    await request(app(null)).get('/api/images/img-1/preview').expect(400);
    expect(h.prisma.image.findUnique).not.toHaveBeenCalled();
  });
});
