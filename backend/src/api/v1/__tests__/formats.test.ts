import { describe, it, expect, vi } from 'vitest';

// Real zlib-backed zip and a real decoder for the label images.
vi.unmock('sharp');
vi.unmock('archiver');

import sharp from 'sharp';
import { inflateRawSync } from 'zlib';
import {
  categoriesFor,
  render,
  rleOf,
  toCoco,
  toJson,
  toYoloLabels,
  type SegmentationResult,
} from '../formats';
import { V1_MODELS } from '../models';
import type { V1Object } from '../objects';
import { rasterizeLabels } from '../raster';

const square = (
  label: number,
  a: number,
  b: number,
  extra: Partial<V1Object> = {}
): V1Object => ({
  label,
  geometry: 'polygon',
  class: 'spheroid',
  points: [
    [a, a],
    [b, a],
    [b, b],
    [a, b],
  ],
  ...extra,
});

const resultOf = (
  model: keyof typeof V1_MODELS,
  objects: V1Object[],
  size = { width: 40, height: 30 }
): SegmentationResult => ({
  model,
  modelInfo: V1_MODELS[model],
  image: { filename: 'frame 01.tif', ...size, page: 0, page_count: 1 },
  parameters: { threshold: 0.5 },
  objects,
  warnings: [],
  timing: { inference_ms: 12 },
});

/** Minimal reader for the stored/deflated zips `archiver` writes. */
const unzip = (zip: Buffer): Record<string, Buffer> => {
  const files: Record<string, Buffer> = {};
  let eocd = zip.length - 22;
  while (zip.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  let at = zip.readUInt32LE(eocd + 16);
  const count = zip.readUInt16LE(eocd + 10);
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(at)).toBe(0x02014b50);
    const method = zip.readUInt16LE(at + 10);
    const compressed = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength);
    const dataAt =
      local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(dataAt, dataAt + compressed);
    files[name] = method === 0 ? Buffer.from(data) : inflateRawSync(data);
    at += 46 + nameLength + extraLength + commentLength;
  }
  return files;
};

const holed = square(1, 2, 20, {
  holes: [
    [
      [6, 6],
      [12, 6],
      [12, 12],
      [6, 12],
    ],
  ],
});

describe('json', () => {
  it('is the result itself, without internal fields', () => {
    const result = resultOf('hrnet', [square(1, 2, 9)]);
    result.metrics = { DI: 0.5 };
    const json = toJson(result);
    expect(Object.keys(json)).toEqual([
      'model',
      'image',
      'parameters',
      'objects',
      'metrics',
      'warnings',
      'timing',
    ]);
    expect(json.image).toEqual({ width: 40, height: 30, page: 0, page_count: 1 });
    expect(JSON.stringify(json)).not.toContain('modelInfo');
    expect(JSON.stringify(json)).not.toContain('frame 01');
  });

  it('omits metrics when the model returns none', () => {
    expect('metrics' in toJson(resultOf('hrnet', []))).toBe(false);
  });
});

describe('coco', () => {
  it('writes a hole-free polygon as a standard polygon annotation', () => {
    const coco = toCoco(resultOf('hrnet', [square(1, 2, 9)])) as any;
    expect(coco.images).toEqual([
      { id: 1, file_name: 'frame 01.tif', width: 40, height: 30 },
    ]);
    expect(coco.categories).toEqual([
      { id: 1, name: 'spheroid', supercategory: 'spheroid' },
    ]);
    expect(coco.annotations[0]).toMatchObject({
      id: 1,
      image_id: 1,
      category_id: 1,
      segmentation: [[2, 2, 9, 2, 9, 9, 2, 9]],
      bbox: [2, 2, 7, 7],
      area: 49,
      iscrowd: 0,
    });
  });

  it('writes a polygon WITH holes as RLE that decodes to exactly its mask', () => {
    const result = resultOf('hrnet', [holed]);
    const annotation = (toCoco(result) as any).annotations[0];

    expect(annotation.iscrowd).toBe(1);
    expect(annotation.segmentation.size).toEqual([30, 40]);
    const { counts } = annotation.segmentation;
    expect(counts.reduce((a: number, b: number) => a + b, 0)).toBe(40 * 30);

    // Decode the RLE the way pycocotools does: column-major, zeros first.
    const decoded = new Uint8Array(40 * 30);
    let index = 0;
    let bit = 0;
    for (const run of counts) {
      for (let k = 0; k < run; k++, index++) {
        const x = Math.floor(index / 30);
        const y = index % 30;
        decoded[y * 40 + x] = bit;
      }
      bit ^= 1;
    }
    const expected = rasterizeLabels([holed], 40, 30);
    expect(Array.from(decoded)).toEqual(Array.from(expected, v => (v ? 1 : 0)));
    expect(annotation.area).toBe(decoded.reduce((a, b) => a + b, 0));
    // 19 x 19 square minus the hole's 5 x 5 strict interior.
    expect(annotation.area).toBe(19 * 19 - 25);
  });

  it('rasterises a holed object alone, so an overlapping neighbour cannot eat it', () => {
    const neighbour = square(2, 4, 8);
    const alone = (toCoco(resultOf('hrnet', [holed])) as any).annotations[0];
    const together = (toCoco(resultOf('hrnet', [holed, neighbour])) as any)
      .annotations[0];
    expect(together.segmentation).toEqual(alone.segmentation);
  });

  it('files sperm polylines under their part, as an explicit extension', () => {
    const coco = toCoco(
      resultOf('sperm', [
        {
          label: 1,
          geometry: 'polyline',
          class: 'sperm',
          part: 'tail',
          instance: 'sperm_0',
          points: [
            [1, 1],
            [5.5, 7.25],
          ],
        },
      ])
    ) as any;
    expect(coco.categories.map((c: any) => c.name)).toEqual([
      'head',
      'midpiece',
      'tail',
    ]);
    expect(coco.annotations[0]).toMatchObject({
      category_id: 3,
      segmentation: [[1, 1, 5.5, 7.25]],
      area: 0,
      iscrowd: 0,
      attributes: { geometry: 'polyline', part: 'tail', instance: 'sperm_0' },
    });
  });

  it('numbers categories from the model class list', () => {
    const coco = toCoco(
      resultOf('microcapsule', [
        square(1, 2, 9, { class: 'membrane' }),
        square(2, 3, 8, { class: 'microcapsule' }),
      ])
    ) as any;
    expect(coco.annotations.map((a: any) => a.category_id)).toEqual([2, 1]);
  });
});

describe('rleOf', () => {
  it('starts with a zero-length run when the first pixel is set', () => {
    const mask = Uint16Array.from([1, 0, 0, 1]); // 2 x 2, row-major
    // column-major order: (0,0)=1 (0,1)=0 (1,0)=0 (1,1)=1
    expect(rleOf(mask, 1, 2, 2)).toEqual({
      size: [2, 2],
      counts: [0, 1, 2, 1],
      area: 2,
    });
  });
});

describe('yolo', () => {
  it('writes one normalised line per polygon, class index first', () => {
    const text = toYoloLabels(
      resultOf('microcapsule', [
        square(1, 10, 20, { class: 'membrane' }),
        square(2, 0, 40, { class: 'microcapsule' }),
      ])
    );
    expect(text).toBe(
      '1 0.250000 0.333333 0.500000 0.333333 0.500000 0.666667 0.250000 0.666667\n' +
        '0 0.000000 0.000000 1.000000 0.000000 1.000000 1.000000 0.000000 1.000000\n'
    );
  });

  it('is empty, not a blank line, when there is nothing', () => {
    expect(toYoloLabels(resultOf('hrnet', []))).toBe('');
  });

  it('ships labels and the class list in a zip', async () => {
    const out = await render(
      resultOf('microcapsule', [square(1, 10, 20, { class: 'membrane' })]),
      'yolo'
    );
    expect(out.contentType).toBe('application/zip');
    expect(out.filename).toBe('frame 01.yolo.zip');
    const files = unzip(out.body);
    expect(Object.keys(files).sort()).toEqual(['classes.txt', 'labels/frame 01.txt']);
    expect(files['classes.txt'].toString()).toBe('microcapsule\nmembrane\n');
    expect(files['labels/frame 01.txt'].toString().startsWith('1 0.25')).toBe(true);
  });
});

describe('names inside a zip', () => {
  it('are ASCII, because the archive carries no UTF-8 flag', async () => {
    const result = resultOf('hrnet', [square(1, 2, 9)]);
    result.image.filename = 'демо snímek.tif';
    const out = await render(result, 'yolo');
    // The download keeps its real name; the entry inside does not.
    expect(out.filename).toBe('демо snímek.yolo.zip');
    const names = Object.keys(unzip(out.body)).sort();
    expect(names).toEqual(['classes.txt', 'labels/____ sn_mek.txt']);
    for (const name of names) {
      expect(name).toMatch(/^[\x20-\x7e]+$/);
    }
  });
});

describe('imagej_roi', () => {
  it('zips one .roi per object plus one per hole, with ImageJ headers', async () => {
    const out = await render(
      resultOf('hrnet', [holed, square(2, 25, 28)]),
      'imagej_roi'
    );
    expect(out.filename).toBe('frame 01.RoiSet.zip');
    const files = unzip(out.body);
    expect(Object.keys(files).sort()).toEqual([
      '0001-spheroid-hole1.roi',
      '0001-spheroid.roi',
      '0002-spheroid.roi',
    ]);
    for (const data of Object.values(files)) {
      expect(data.toString('latin1', 0, 4)).toBe('Iout');
    }
    // ImageJ ROI header: type at byte 6 (0 = polygon), n coordinates at 16.
    const roi = files['0002-spheroid.roi'];
    expect(roi[6]).toBe(0);
    expect(roi.readUInt16BE(16)).toBe(4);
  });

  it('writes an open centerline as a polyline ROI', async () => {
    const out = await render(
      resultOf('microtubule', [
        {
          label: 1,
          geometry: 'polyline',
          class: 'microtubule',
          points: [
            [1, 1],
            [5, 9],
            [9, 9],
          ],
        },
      ]),
      'imagej_roi'
    );
    const roi = unzip(out.body)['0001-microtubule.roi'];
    expect(roi[6]).toBe(5); // polyline
    expect(roi.readUInt16BE(16)).toBe(3);
  });

  it('zips identically twice: no timestamps leak in', async () => {
    const result = resultOf('hrnet', [holed]);
    const a = await render(result, 'imagej_roi');
    const b = await render(result, 'imagej_roi');
    expect(a.body.equals(b.body)).toBe(true);
  });
});

describe('label masks', () => {
  it('renders a 16-bit PNG whose pixels are the object labels', async () => {
    const objects = [holed, square(2, 25, 28)];
    const out = await render(resultOf('hrnet', objects), 'mask_png');
    expect(out.contentType).toBe('image/png');
    expect(out.filename).toBe('frame 01.labels.png');

    const { data, info } = await sharp(out.body)
      .toColourspace('grey16')
      .raw({ depth: 'ushort' })
      .toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([40, 30]);
    const pixels = new Uint16Array(data.buffer, data.byteOffset, 40 * 30);
    expect(Array.from(pixels)).toEqual(
      Array.from(rasterizeLabels(objects, 40, 30))
    );
    expect(new Set(pixels)).toEqual(new Set([0, 1, 2]));
  });

  it('renders the same labels as a 16-bit TIFF', async () => {
    const objects = [holed];
    const out = await render(resultOf('hrnet', objects), 'mask_tiff');
    expect(out.contentType).toBe('image/tiff');
    expect(out.filename).toBe('frame 01.labels.tif');
    const expected = rasterizeLabels(objects, 40, 30);
    const offset = out.body.length - 40 * 30 * 2;
    for (let i = 0; i < expected.length; i++) {
      expect(out.body.readUInt16LE(offset + i * 2)).toBe(expected[i]);
    }
  });

  it('refuses more objects than a 16-bit label can number', async () => {
    const many = Array.from({ length: 65536 }, (_, i) => square(i + 1, 1, 3));
    await expect(render(resultOf('hrnet', many), 'mask_png')).rejects.toThrow(
      /at most 65535 objects/
    );
  });
});

describe('json and coco through render', () => {
  it('serves json inline and coco as a download', async () => {
    const result = resultOf('hrnet', [square(1, 2, 9)]);
    const json = await render(result, 'json');
    expect([json.contentType, json.filename]).toEqual(['application/json', null]);
    expect(JSON.parse(json.body.toString())).toEqual(toJson(result));
    const coco = await render(result, 'coco');
    expect(coco.filename).toBe('frame 01.coco.json');
    expect(JSON.parse(coco.body.toString())).toEqual(toCoco(result));
  });
});

describe('categoriesFor', () => {
  it('uses parts where a model has them, classes otherwise', () => {
    expect(categoriesFor(V1_MODELS.sperm_2part)).toEqual(['head', 'tail']);
    expect(categoriesFor(V1_MODELS.neurite_soma)).toEqual(['neurite', 'soma']);
  });
});
