import {
  PolygonValidator,
  isValidSpermPartClass,
  isValidNeuronPartClass,
  SPERM_PART_CLASSES,
  NEURON_PART_CLASSES,
  POLYGON_PART_CLASSES,
} from '../polygonValidation';

/**
 * `partClass` is the carrier for the neurite/soma model's two classes, and
 * `PolygonValidator` is the FIRST of the stages that can silently drop an
 * unrecognised value on the way from the ML response into the database. If it
 * strips them, the two classes become indistinguishable downstream and the
 * whole model reads as one undifferentiated blob.
 */
describe('neuron partClass (neurite / soma)', () => {
  const closedPolygon = (extra: Record<string, unknown>) =>
    JSON.stringify([
      {
        id: 'p1',
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 5, y: 10 },
        ],
        ...extra,
      },
    ]);

  const parsed = (extra: Record<string, unknown>) => {
    const { polygons, isValid } = PolygonValidator.parsePolygonData(
      closedPolygon(extra),
      'test'
    );
    expect(isValid).toBe(true);
    return polygons[0] as { partClass?: string };
  };

  it.each([...NEURON_PART_CLASSES])(
    'preserves partClass=%s on a closed polygon',
    cls => {
      expect(parsed({ partClass: cls }).partClass).toBe(cls);
    }
  );

  it('still preserves the pre-existing sperm and core values', () => {
    for (const cls of [...SPERM_PART_CLASSES, 'core']) {
      expect(parsed({ partClass: cls }).partClass).toBe(cls);
    }
  });

  it('still drops an unknown partClass', () => {
    expect(parsed({ partClass: 'dendrite' }).partClass).toBeUndefined();
    expect(parsed({ partClass: 42 }).partClass).toBeUndefined();
  });

  // The point of keeping NEURON_PART_CLASSES a separate group: sperm-only
  // code paths (COCO polyline export, instance grouping, the head/midpiece/
  // tail context menu) must not start accepting a neuron class.
  it('does NOT widen the sperm guard', () => {
    for (const cls of NEURON_PART_CLASSES) {
      expect(isValidSpermPartClass(cls)).toBe(false);
    }
    expect([...SPERM_PART_CLASSES]).toEqual(['head', 'midpiece', 'tail']);
  });

  it('does NOT widen the neuron guard to sperm parts or core', () => {
    for (const cls of [...SPERM_PART_CLASSES, 'core']) {
      expect(isValidNeuronPartClass(cls)).toBe(false);
    }
  });

  it('composes the wide union from the three groups, in order', () => {
    expect([...POLYGON_PART_CLASSES]).toEqual([
      'head',
      'midpiece',
      'tail',
      'core',
      'neurite',
      'soma',
    ]);
  });
});
