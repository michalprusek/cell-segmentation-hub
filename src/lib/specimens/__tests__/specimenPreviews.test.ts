/**
 * The preview dataset is generated from production data by a script that is
 * NOT run in CI, so these tests guard the two things that rot between runs:
 * the index quoting ids the registry no longer has, and an entry pointing at an
 * asset nobody generated.
 *
 * The stroke rules are pinned against the editor's palette for the same reason
 * `landing/__tests__/specimens.test.ts` pins the landing tiles: the tiles claim
 * to show what the canvas shows, and nothing else checks that claim.
 */
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import { MODEL_REGISTRY, ALL_MODEL_IDS } from '@/lib/models/modelRegistry';
import { SPECIMEN_PREVIEWS } from '@/lib/specimens/previewIndex';
import {
  loadSpecimenGeometry,
  peekSpecimenGeometry,
  resetSpecimenGeometryCache,
} from '@/lib/specimens/previewGeometry';
import {
  PREVIEWS_PER_CARD,
  previewsForModel,
  previewsForProjectType,
} from '@/lib/specimens/selectPreviews';
import { specimenStroke } from '@/lib/specimens/specimenStroke';
import { PROJECT_TYPES } from '@/types';

const PUBLIC_DIR = join(process.cwd(), 'public');

describe('specimen preview index', () => {
  it('gives every model in the registry a set of tiles', () => {
    for (const model of ALL_MODEL_IDS) {
      expect(
        previewsForModel(model).length,
        `${model} has no preview tiles`
      ).toBe(PREVIEWS_PER_CARD);
    }
  });

  it('gives every project type a set of tiles', () => {
    for (const projectType of PROJECT_TYPES) {
      expect(
        previewsForProjectType(projectType).length,
        `${projectType} has no preview tiles`
      ).toBe(PREVIEWS_PER_CARD);
    }
  });

  it('files each tile under a project type its model can actually run on', () => {
    for (const preview of SPECIMEN_PREVIEWS) {
      expect(PROJECT_TYPES).toContain(preview.projectType);
      expect(
        MODEL_REGISTRY[preview.model]
          .compatibleProjectTypes as readonly string[]
      ).toContain(preview.projectType);
    }
  });

  it('has unique ids', () => {
    const ids = SPECIMEN_PREVIEWS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('points at assets that exist and are not empty', () => {
    for (const preview of SPECIMEN_PREVIEWS) {
      for (const asset of [preview.image, preview.geometry]) {
        const path = join(PUBLIC_DIR, asset);
        expect(existsSync(path), `${asset} is missing from public/`).toBe(true);
        expect(statSync(path).size).toBeGreaterThan(0);
      }
      expect(preview.objects).toBeGreaterThan(0);
    }
  });
});

describe('previewsForProjectType', () => {
  it('spreads a multi-model type across models before repeating one', () => {
    // `spheroid` is the only type with more than one model; three tiles from
    // one lab's HRNet run would show the reader far less than three models'.
    const picked = previewsForProjectType('spheroid');
    expect(new Set(picked.map(p => p.model)).size).toBe(picked.length);
  });

  it('falls back to one model when the type only has one', () => {
    const picked = previewsForProjectType('microtubules');
    expect(picked).toHaveLength(PREVIEWS_PER_CARD);
    expect(new Set(picked.map(p => p.model))).toEqual(new Set(['microtubule']));
  });

  it('honours a smaller limit', () => {
    expect(previewsForProjectType('spheroid', 2)).toHaveLength(2);
  });
});

describe('specimenStroke', () => {
  it('greys an object cut off by the image border', () => {
    // Border-cut microcapsules are excluded from metrics; the canvas greys
    // them, so a tile that drew them red would advertise measurements that
    // are not taken.
    expect(specimenStroke({ d: 'M0 0', x: 1 })).toBe('#969696');
    expect(specimenStroke({ d: 'M0 0', x: 1, c: 'core' })).toBe('#969696');
  });

  it('draws contours the way the canvas does', () => {
    expect(specimenStroke({ d: 'M0 0' })).toBe('#ef4444');
    expect(specimenStroke({ d: 'M0 0', t: 'i' })).toBe('#0ea5e9');
    expect(specimenStroke({ d: 'M0 0', c: 'core' })).toBe('#22c55e');
  });

  it('draws the neuron classes in the model overlay colours', () => {
    expect(specimenStroke({ d: 'M0 0', c: 'neurite' })).toBe('#06b6d4');
    expect(specimenStroke({ d: 'M0 0', c: 'soma' })).toBe('#d946ef');
  });

  it('draws sperm parts by part class, only on polylines', () => {
    expect(specimenStroke({ d: 'M0 0', g: 'l', c: 'head' })).toBe('#22c55e');
    expect(specimenStroke({ d: 'M0 0', g: 'l', c: 'midpiece' })).toBe(
      '#f59e0b'
    );
    expect(specimenStroke({ d: 'M0 0', g: 'l', c: 'tail' })).toBe('#06b6d4');
  });

  it('gives a tracked polyline a stable per-track hue', () => {
    const first = specimenStroke({ d: 'M0 0', g: 'l', s: 'track_1a902cc93d' });
    expect(first).toMatch(/^hsl\(\d{1,3}, 70%, 55%\)$/);
    expect(specimenStroke({ d: 'M0 0', g: 'l', s: 'track_1a902cc93d' })).toBe(
      first
    );
    expect(specimenStroke({ d: 'M0 0', g: 'l', s: 'track_other' })).not.toBe(
      first
    );
  });

  it('only ever produces colours the editor draws', () => {
    const EDITOR_COLOURS = new Set([
      '#ef4444',
      '#0ea5e9',
      '#22c55e',
      '#f59e0b',
      '#06b6d4',
      '#d946ef',
      '#969696',
      'hsl(0, 0%, 60%)',
    ]);
    const outlines = [
      { d: 'M0 0' },
      { d: 'M0 0', t: 'i' as const },
      { d: 'M0 0', c: 'core' },
      { d: 'M0 0', c: 'neurite' },
      { d: 'M0 0', c: 'soma' },
      { d: 'M0 0', g: 'l' as const, c: 'head' },
      { d: 'M0 0', g: 'l' as const, c: 'midpiece' },
      { d: 'M0 0', g: 'l' as const, c: 'tail' },
      { d: 'M0 0', g: 'l' as const, s: 'mt_dcbb54ef' },
      { d: 'M0 0', g: 'l' as const },
      { d: 'M0 0', x: 1 as const },
    ];
    for (const outline of outlines) {
      const stroke = specimenStroke(outline);
      const isTrackHue = /^hsl\(\d{1,3}, 70%, 55%\)$/.test(stroke);
      expect(
        isTrackHue || EDITOR_COLOURS.has(stroke),
        `${JSON.stringify(outline)} produced ${stroke}`
      ).toBe(true);
    }
  });
});

describe('loadSpecimenGeometry', () => {
  const url = '/specimens/previews/hrnet-1.geom.json';

  beforeEach(() => {
    resetSpecimenGeometryCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches once and serves the rest from memory', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ outlines: [{ d: 'M0 0L1 1' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    expect(peekSpecimenGeometry(url)).toBeUndefined();
    await loadSpecimenGeometry(url);
    await loadSpecimenGeometry(url);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(peekSpecimenGeometry(url)).toEqual([{ d: 'M0 0L1 1' }]);
  });

  it('collapses concurrent requests for the same tile into one', async () => {
    // Three tiles open together and a pointer that leaves and returns inside
    // the open delay would otherwise fire a burst of identical requests.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ outlines: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await Promise.all([
      loadSpecimenGeometry(url),
      loadSpecimenGeometry(url),
      loadSpecimenGeometry(url),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('degrades to no outlines, and retries next time, when the asset fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ outlines: [{ d: 'M2 2' }] }),
      });
    vi.stubGlobal('fetch', fetchMock);

    await expect(loadSpecimenGeometry(url)).resolves.toEqual([]);
    expect(peekSpecimenGeometry(url)).toBeUndefined();

    await expect(loadSpecimenGeometry(url)).resolves.toEqual([{ d: 'M2 2' }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
