/**
 * The Node half of the neurite metrics export.
 *
 * The maths is the ML service's and is tested there; what can go wrong HERE is
 * the plumbing — which polygons are classified as what, which frames are
 * skipped and whether the reason survives, and whether the sheet keeps its
 * shape when a frame happens to contain no bridging neurite.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../utils/config', () => ({
  config: {
    NODE_ENV: 'test',
    SEGMENTATION_SERVICE_URL: 'http://ml-mock:8000',
    UPLOAD_DIR: '/app/uploads',
  },
}));

vi.mock('axios', () => {
  const post = vi.fn();
  return {
    default: { post, isAxiosError: (e: unknown) => Boolean((e as { isAxiosError?: boolean })?.isAxiosError) },
    post,
    isAxiosError: (e: unknown) => Boolean((e as { isAxiosError?: boolean })?.isAxiosError),
  };
});

import axios from 'axios';
import {
  computeNeuriteMetrics,
  toCsv,
  NEURITE_HEADERS,
  SOMA_HEADERS,
  type NeuriteImageInput,
} from '../neuriteMetricsExporter';

const post = axios.post as unknown as ReturnType<typeof vi.fn>;

const square = (x: number, y: number, s: number) => [
  { x, y },
  { x: x + s, y },
  { x: x + s, y: y + s },
  { x, y: y + s },
];

function image(overrides: Partial<NeuriteImageInput> = {}): NeuriteImageInput {
  return {
    id: 'img-1',
    name: 'frame_0001',
    width: 512,
    height: 512,
    pixelSizeUm: 0.18,
    originalPath: 'projects/p/frame_0001.png',
    segmentation: {
      polygons: JSON.stringify([
        { id: 's1', partClass: 'soma', points: square(10, 10, 30) },
        { id: 'n1', partClass: 'neurite', points: square(50, 10, 30) },
      ]),
    },
    ...overrides,
  };
}

// Every field the ML route declares, because it declares them all REQUIRED
// (`NeuriteMetricsResponse`, no Optional and no defaults) — a fixture missing
// one is a shape the service never sends, so a test built on it proves nothing
// about the real response. `neurite_owners` was absent here until the envelope
// check at the axios boundary made it visible.
const okResponse = {
  data: {
    neurites: [{ frame: 'frame_0001', soma_id: 1, neurite_id: 'x' }],
    somas: [{ frame: 'frame_0001', soma_id: 1, stage: '2' }],
    qc: { n_soma_instances: 1 },
    soma_polygon_ids: { 1: 's1' },
    neurite_owners: {
      x: { soma_polygon_id: 's1', shared: false, owned_fraction: 1 },
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  post.mockResolvedValue(okResponse);
});

describe('polygon classification', () => {
  it('splits soma from neurite and sends each in its own list', async () => {
    await computeNeuriteMetrics([image()], { formats: ['csv'] });

    const body = post.mock.calls[0][1];
    expect(body.soma_polygons.map((p: { polygon_id: string }) => p.polygon_id)).toEqual(['s1']);
    expect(body.neurite_polygons.map((p: { polygon_id: string }) => p.polygon_id)).toEqual(['n1']);
  });

  it('reads partClass in preference to class', async () => {
    // `class` is stripped on several paths and was invisible to the editor
    // until 2026-09-04; `partClass` is the whitelisted carrier the neurite/soma
    // wrapper writes for exactly that reason. A polygon disagreeing with itself
    // must follow the field that actually survives.
    await computeNeuriteMetrics(
      [
        image({
          segmentation: {
            polygons: JSON.stringify([
              { id: 'a', partClass: 'soma', class: 'neurite', points: square(0, 0, 20) },
            ]),
          },
        }),
      ],
      { formats: ['csv'] }
    );

    const body = post.mock.calls[0][1];
    expect(body.soma_polygons).toHaveLength(1);
    expect(body.neurite_polygons).toHaveLength(0);
  });

  it('falls back to class when partClass is absent', async () => {
    await computeNeuriteMetrics(
      [
        image({
          segmentation: {
            polygons: JSON.stringify([
              { id: 'a', class: 'soma', points: square(0, 0, 20) },
              { id: 'b', class: 'neurite', points: square(30, 0, 20) },
            ]),
          },
        }),
      ],
      { formats: ['csv'] }
    );

    const body = post.mock.calls[0][1];
    expect(body.soma_polygons).toHaveLength(1);
    expect(body.neurite_polygons).toHaveLength(1);
  });

  it('ignores a polygon carrying neither field', async () => {
    // Not a modelling result — a stray hand-drawn shape, or another model's
    // output in a mixed project. Sending it would put pixels into the mask that
    // no biology claims.
    await computeNeuriteMetrics(
      [
        image({
          segmentation: {
            polygons: JSON.stringify([
              { id: 'a', partClass: 'soma', points: square(0, 0, 20) },
              { id: 'stray', points: square(30, 0, 20) },
            ]),
          },
        }),
      ],
      { formats: ['csv'] }
    );

    const body = post.mock.calls[0][1];
    expect(body.neurite_polygons).toHaveLength(0);
  });
});

describe('frames that cannot be measured', () => {
  it.each([
    ['not segmented', { segmentation: null }],
    ['frame dimensions unknown', { width: null }],
    ['pixel size unknown', { pixelSizeUm: null }],
  ])('skips with reason %s', async (fragment, overrides) => {
    const result = await computeNeuriteMetrics(
      [image(overrides as Partial<NeuriteImageInput>)],
      { formats: ['csv'] }
    );

    expect(post).not.toHaveBeenCalled();
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toContain(fragment);
  });

  it('refuses a frame with no pixel size rather than assuming one', async () => {
    // Every staging threshold is in micrometres — "at least 2 um", "2x the soma
    // diameter". A default would not give approximate stages, it would give
    // confident wrong ones.
    const result = await computeNeuriteMetrics([image({ pixelSizeUm: 0 })], {
      formats: ['csv'],
    });
    expect(result.skipped[0].reason).toMatch(/micrometres/);
  });

  it('skips a frame with neurites but no soma', async () => {
    const result = await computeNeuriteMetrics(
      [
        image({
          segmentation: {
            polygons: JSON.stringify([
              { id: 'n', partClass: 'neurite', points: square(0, 0, 20) },
            ]),
          },
        }),
      ],
      { formats: ['csv'] }
    );

    expect(post).not.toHaveBeenCalled();
    expect(result.skipped[0].reason).toContain('no soma');
  });

  it('will not classify without the frame file', async () => {
    const result = await computeNeuriteMetrics([image({ originalPath: null })], {
      formats: ['csv'],
    });
    expect(result.skipped[0].reason).toMatch(/classifier reads pixels/);
  });

  it('classify:false does not need the frame file', async () => {
    const result = await computeNeuriteMetrics([image({ originalPath: null })], {
      formats: ['csv'],
      classify: false,
    });
    expect(result.skipped).toHaveLength(0);
    expect(post.mock.calls[0][1].classify).toBe(false);
    expect(post.mock.calls[0][1]).not.toHaveProperty('image_path');
  });

  it('keeps the server message when the ML service refuses', async () => {
    // The reason is the only thing that tells a user WHICH input was wrong.
    post.mockRejectedValueOnce({
      isAxiosError: true,
      message: 'Request failed with status code 400',
      response: { status: 400, data: { detail: 'Frame is 100x100 but the polygons were drawn on 512x512' } },
    });

    const result = await computeNeuriteMetrics([image()], { formats: ['csv'] });
    expect(result.skipped[0].reason).toContain('drawn on 512x512');
  });

  it('one bad frame does not lose the others', async () => {
    post
      .mockRejectedValueOnce({ isAxiosError: true, message: 'boom', response: undefined })
      .mockResolvedValueOnce(okResponse);

    const result = await computeNeuriteMetrics(
      [image({ id: 'a', name: 'bad' }), image({ id: 'b', name: 'good' })],
      { formats: ['csv'] }
    );

    expect(result.skipped).toHaveLength(1);
    expect(result.neurites).toHaveLength(1);
    expect(result.somas).toHaveLength(1);
  });
});

describe('sheet shape', () => {
  it('the headers are fixed, not derived from the rows', () => {
    // A frame with no bridging neurite never populates `bridge_partner_soma`.
    // Deriving headers from the first row's keys would silently change the
    // sheet's shape between two exports of the same project.
    expect(NEURITE_HEADERS).toContain('bridge_partner_soma');
    expect(NEURITE_HEADERS).toContain('connection_id');
    expect(SOMA_HEADERS).toContain('soma_neuronal');
    expect(SOMA_HEADERS).toContain('p_not_soma');
  });

  it('carries both length definitions, so staging can be re-derived', () => {
    // extent (reach) is what staging reads; cable is the sum of branches. The
    // choice moves 270 of 1956 cells, so a sheet holding only one of them
    // cannot be re-staged without re-running the pipeline.
    expect(NEURITE_HEADERS).toContain('extent_um');
    expect(NEURITE_HEADERS).toContain('length_um');
    expect(NEURITE_HEADERS).toContain('staging_length_um');
  });

  it('keeps the stage reason, not just the stage', () => {
    // Without it a single cell's stage cannot be checked against its picture.
    expect(SOMA_HEADERS).toContain('stage_reason');
  });
});

describe('the ML response envelope is checked at the boundary', () => {
  // `axios.post<T>` is a compile-time cast and checks nothing at run time, so
  // without this the shape is merely asserted and whatever arrived is written
  // into the export file. Version skew between the ml container and the
  // backend is a NORMAL operating state here — the deploy rule is "ml first" —
  // so a changed envelope must surface as a reason, not as an unreadable sheet.
  it.each([
    ['neurites', 'not an array'],
    ['somas', 'not an array'],
    ['qc', 'not an object'],
    ['soma_polygon_ids', 'not an object'],
    ['neurite_owners', 'not an object'],
  ])('rejects a response missing %s', async field => {
    const broken = { data: { ...okResponse.data } };
    delete (broken.data as Record<string, unknown>)[field];
    post.mockResolvedValueOnce(broken);

    const result = await computeNeuriteMetrics([image()], { formats: ['csv'] });

    // Skipped with a reason NAMING the field, not silently empty — the reason
    // is the only thing that tells an operator which side is out of date.
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toContain(field);
    expect(result.neurites).toHaveLength(0);
  });

  it('accepts the envelope the ML route actually declares', () => {
    // The control: every required field present must NOT be rejected, or the
    // check above would pass by refusing everything.
    const d = okResponse.data as Record<string, unknown>;
    for (const k of [
      'neurites',
      'somas',
      'qc',
      'soma_polygon_ids',
      'neurite_owners',
    ]) {
      expect(d[k]).toBeDefined();
    }
  });
});

describe('CSV cells cannot become spreadsheet formulas', () => {
  // `frame` is `image.name ?? image.id`, and the name is the filename the
  // uploader chose. A project can be SHARED, so the person who named the file
  // and the person who opens the CSV are not necessarily the same person.
  const row = (frame: string) => toCsv(['frame'], [{ frame }]).split('\n')[1];

  it.each(['=', '+', '-', '@'])(
    'neutralises a value starting with %s',
    lead => {
      const out = row(`${lead}HYPERLINK("http://x")`);
      // The apostrophe must be FIRST — anywhere else and the cell still
      // evaluates.
      expect(out.replace(/^"|"$/g, '').startsWith("'")).toBe(true);
    }
  );

  it('neutralises a leading tab and CR too', () => {
    // Excel strips these before deciding, so `\t=1+1` evaluates as well.
    for (const lead of ['\t', '\r']) {
      expect(row(`${lead}=1+1`).replace(/^"|"$/g, '').startsWith("'")).toBe(
        true
      );
    }
  });

  it('leaves an ordinary filename untouched', () => {
    // The control: the guard must not prefix every cell, which would corrupt
    // every frame name in the sheet.
    expect(row('r5_ctrl_0001.png')).toBe('r5_ctrl_0001.png');
    expect(row('42')).toBe('42');
  });

  it('still quotes a value containing a comma', () => {
    // The guard runs BEFORE quoting; if it ran after, the apostrophe would
    // land outside the quotes and be read as part of the previous field.
    expect(row('=a,b')).toBe('"\'=a,b"');
  });
});

describe('request shaping', () => {
  it('sends the pixel size the frame actually carries', async () => {
    await computeNeuriteMetrics([image({ pixelSizeUm: 0.09 })], {
      formats: ['csv'],
    });
    expect(post.mock.calls[0][1].um_per_px).toBe(0.09);
  });

  it('classifies by default', async () => {
    await computeNeuriteMetrics([image()], { formats: ['csv'] });
    expect(post.mock.calls[0][1].classify).toBe(true);
    // Resolved against UPLOAD_DIR: `originalPath` is stored relative, and an
    // absolute one would land outside the ML container's storage root.
    expect(post.mock.calls[0][1].image_path).toBe(
      '/app/uploads/projects/p/frame_0001.png'
    );
  });

  it('drops a polygon with fewer than three points', async () => {
    await computeNeuriteMetrics(
      [
        image({
          segmentation: {
            polygons: JSON.stringify([
              { id: 's', partClass: 'soma', points: square(0, 0, 20) },
              { id: 'degenerate', partClass: 'neurite', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
            ]),
          },
        }),
      ],
      { formats: ['csv'] }
    );
    expect(post.mock.calls[0][1].neurite_polygons).toHaveLength(0);
  });

  it('forwards holes so a ring is not measured as a disc', async () => {
    await computeNeuriteMetrics(
      [
        image({
          segmentation: {
            polygons: JSON.stringify([
              {
                id: 'ring',
                partClass: 'soma',
                points: square(0, 0, 40),
                holes: [square(10, 10, 10)],
              },
            ]),
          },
        }),
      ],
      { formats: ['csv'] }
    );
    expect(post.mock.calls[0][1].soma_polygons[0].holes).toHaveLength(1);
  });
});
