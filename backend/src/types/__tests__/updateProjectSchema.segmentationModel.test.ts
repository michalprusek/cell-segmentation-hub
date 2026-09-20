import { describe, it, expect } from 'vitest';
import { updateProjectSchema } from '../validation';
import { SEGMENTATION_MODELS } from '../../constants/modelRegistry';

/**
 * The request-shape half of the model gate.
 *
 * `ProjectService.updateProject` separately checks the model against the
 * project's TYPE, which it must, because only it knows the type. That check
 * happens to reject an unknown id too (an id in no type's list is in no list
 * at all), so it is worth being explicit about what this layer adds: it
 * rejects a value that is not a model AT ALL before any database read, and it
 * is the layer that produces the "must be one of the supported models"
 * message. Both layers are load-bearing; neither makes the other redundant.
 */
describe('updateProjectSchema.segmentationModel', () => {
  it.each(SEGMENTATION_MODELS)('accepts the registry model %s', id => {
    const parsed = updateProjectSchema.safeParse({ segmentationModel: id });
    expect(parsed.success).toBe(true);
  });

  it('rejects a string that is not a model id', () => {
    const parsed = updateProjectSchema.safeParse({
      segmentationModel: 'not_a_model',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a model that was removed from the registry', () => {
    // These two were in the hand-maintained whitelist long after deletion,
    // which is why the registry became the SSOT.
    for (const stale of ['resunet_advanced', 'resunet_small']) {
      expect(
        updateProjectSchema.safeParse({ segmentationModel: stale }).success
      ).toBe(false);
    }
  });

  it('names the supported models in the error', () => {
    const parsed = updateProjectSchema.safeParse({
      segmentationModel: 'not_a_model',
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toContain('segformer');
    }
  });

  it('accepts null as "follow the type default"', () => {
    const parsed = updateProjectSchema.safeParse({ segmentationModel: null });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.segmentationModel).toBeNull();
    }
  });

  it('treats an omitted field as "leave the stored value alone"', () => {
    // Distinct from null: the service spreads on `!== undefined`, so an
    // omitted field must not reach the update payload at all.
    const parsed = updateProjectSchema.safeParse({ title: 'Renamed' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.segmentationModel).toBeUndefined();
    }
  });

  it('rejects a non-string', () => {
    for (const bad of [42, true, {}, []]) {
      expect(
        updateProjectSchema.safeParse({ segmentationModel: bad }).success
      ).toBe(false);
    }
  });
});
