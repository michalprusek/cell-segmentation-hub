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

  it('escapes XML metacharacters in a label name', () => {
    const { xml } = buildCvatXml(
      [frame({ segmentation: { polygons: polylineJson({ mtType: 'x' }) } })],
      'task-1',
      new Map([['x', { name: 'a<b>&"', color: '#00ff00' }]])
    );
    expect(xml).toContain('label="a&lt;b&gt;&amp;&quot;"');
    expect(xml).not.toContain('label="a<b>');
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
