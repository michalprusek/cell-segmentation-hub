import { describe, it, expect } from 'vitest';
import {
  buildCvatXml,
  DEFAULT_CVAT_LABEL,
  type CvatFrameInput,
  type CvatTypeLabel,
} from '../cvatExporter';

const frame = (over: Partial<CvatFrameInput>): CvatFrameInput => ({
  id: 'f0',
  name: 'v',
  width: 512,
  height: 384,
  parentVideoId: 'c1',
  frameIndex: 0,
  isVideoContainer: false,
  segmentation: null,
  ...over,
});

const polylineJson = (extra: Record<string, unknown>) =>
  JSON.stringify([
    {
      geometry: 'polyline',
      points: [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ],
      trackId: 't1',
      ...extra,
    },
  ]);

describe('buildCvatXml', () => {
  const palette = new Map<string, CvatTypeLabel>([
    ['mt_type_a', { name: 'alpha-tubulin', color: '#ff0000' }],
  ]);

  it('labels a typed polyline with its resolved class name', () => {
    const { xml, images, polylines } = buildCvatXml(
      [frame({ segmentation: { polygons: polylineJson({ mtType: 'mt_type_a' }) } })],
      'task-1',
      palette
    );
    expect(images).toBe(1);
    expect(polylines).toBe(1);
    expect(xml).toContain('<polyline label="alpha-tubulin"');
    expect(xml).toContain('points="1,2;3,4"');
    // The class is declared in <meta> with its colour.
    expect(xml).toContain('<name>alpha-tubulin</name>');
    expect(xml).toContain('<color>#ff0000</color>');
    // track_id carried as an attribute.
    expect(xml).toContain('<attribute name="track_id">t1</attribute>');
    // width/height on the image.
    expect(xml).toContain('width="512" height="384"');
  });

  it('falls back to the default label for an untyped polyline', () => {
    const { xml } = buildCvatXml(
      [frame({ segmentation: { polygons: polylineJson({}) } })],
      'task-1',
      palette
    );
    expect(xml).toContain(`<polyline label="${DEFAULT_CVAT_LABEL}"`);
  });

  it('escapes XML metacharacters (incl. apostrophe) in a label name', () => {
    const { xml } = buildCvatXml(
      [frame({ segmentation: { polygons: polylineJson({ mtType: 'x' }) } })],
      'task-1',
      new Map([['x', { name: `a<b>&"'`, color: '#00ff00' }]])
    );
    expect(xml).toContain('label="a&lt;b&gt;&amp;&quot;&apos;"');
    expect(xml).not.toContain('label="a<b>');
  });

  it('covers geometry/points/JSON edge branches without emitting bad rows', () => {
    // null polygons JSON, non-array JSON, container frame, non-array points,
    // default (missing) geometry treated as polyline, decimal coordinates.
    const withDecimals = JSON.stringify([
      {
        geometry: undefined, // missing geometry → defaults to polyline
        points: [
          { x: 1.5, y: 2.25 },
          { x: 3, y: 4 },
        ],
      },
      { geometry: 'polyline', points: 'not-an-array' }, // dropped
    ]);
    const { xml, images, polylines } = buildCvatXml(
      [
        frame({ id: 'ct', isVideoContainer: true }), // container → skipped
        frame({ id: 'n', segmentation: { polygons: null } }), // null json → []
        frame({
          id: 'o',
          frameIndex: 1,
          segmentation: { polygons: '{"not":"array"}' },
        }), // non-array → []
        frame({
          id: 'd',
          frameIndex: 2,
          segmentation: { polygons: withDecimals },
        }),
      ],
      'task-1',
      palette
    );
    expect(images).toBe(1); // only frame 'd' has a valid polyline
    expect(polylines).toBe(1);
    expect(xml).toContain('points="1.5,2.25;3,4"'); // decimal formatting
  });

  it('omits the track_id attribute for a polyline without a trackId', () => {
    const { xml, polylines } = buildCvatXml(
      [frame({ segmentation: { polygons: polylineJson({ trackId: null }) } })],
      'task-1',
      palette
    );
    expect(polylines).toBe(1);
    // The <meta> label schema always declares a track_id attribute; assert only
    // that the polyline element itself carries no track_id attribute.
    expect(xml).not.toContain('<attribute name="track_id">');
  });

  it('falls back to the image index + id when frameIndex is null', () => {
    const { xml } = buildCvatXml(
      [
        frame({
          id: 'imgABC',
          frameIndex: null,
          segmentation: { polygons: polylineJson({}) },
        }),
      ],
      'task-1',
      palette
    );
    expect(xml).toContain('<image id="0"');
    expect(xml).toContain('name="imgABC"');
  });

  it('emits width/height 0 when the frame has no dimensions', () => {
    const { xml } = buildCvatXml(
      [
        frame({
          width: null,
          height: null,
          segmentation: { polygons: polylineJson({}) },
        }),
      ],
      'task-1',
      palette
    );
    expect(xml).toContain('width="0" height="0"');
  });

  it('drops polylines with fewer than 2 finite points', () => {
    const json = JSON.stringify([
      { geometry: 'polyline', points: [{ x: 1, y: 1 }] }, // 1 point
      {
        geometry: 'polyline',
        points: [
          { x: Number.NaN, y: 0 },
          { x: 1, y: 1 },
        ],
      }, // 1 finite
    ]);
    const { images, polylines } = buildCvatXml(
      [frame({ segmentation: { polygons: json } })],
      'task-1',
      palette
    );
    expect(images).toBe(0);
    expect(polylines).toBe(0);
  });

  it('declares every distinct used label in <meta>', () => {
    const json = JSON.stringify([
      {
        geometry: 'polyline',
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        mtType: 'mt_type_a',
      },
      {
        geometry: 'polyline',
        points: [
          { x: 0, y: 0 },
          { x: 2, y: 2 },
        ],
      }, // untyped → default label
    ]);
    const { xml, polylines } = buildCvatXml(
      [frame({ segmentation: { polygons: json } })],
      'task-1',
      palette
    );
    expect(polylines).toBe(2);
    expect(xml).toContain('<name>alpha-tubulin</name>');
    expect(xml).toContain(`<name>${DEFAULT_CVAT_LABEL}</name>`);
  });

  it('skips corrupt frames and closed polygons without throwing', () => {
    const { images, polylines } = buildCvatXml(
      [
        frame({ id: 'c', segmentation: { polygons: 'not json' } }),
        frame({
          id: 'p',
          frameIndex: 1,
          segmentation: {
            polygons: JSON.stringify([
              {
                geometry: 'polygon',
                points: [
                  { x: 0, y: 0 },
                  { x: 1, y: 1 },
                  { x: 2, y: 0 },
                ],
              },
            ]),
          },
        }),
      ],
      'task-1',
      palette
    );
    expect(images).toBe(0);
    expect(polylines).toBe(0);
  });
});
