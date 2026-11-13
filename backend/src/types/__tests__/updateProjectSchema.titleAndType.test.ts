import { describe, it, expect } from 'vitest';
import { updateProjectSchema } from '../validation';

/**
 * The rename path shares the create path's two rules: a title is measured
 * AFTER trimming, and a bad type is reported in Czech. Both were wrong here
 * too — zod runs string checks in order, so `.min(1).trim()` let '   ' through
 * as '' — and `createProjectSchema` is covered by the route test.
 */
describe('updateProjectSchema — title and type', () => {
  it('refuses a rename to only spaces', () => {
    const parsed = updateProjectSchema.safeParse({ title: '   ' });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.flatten().fieldErrors.title).toEqual([
      'Název projektu je povinný',
    ]);
  });

  it('stores a rename trimmed', () => {
    const parsed = updateProjectSchema.safeParse({ title: '  Renamed  ' });

    expect(parsed.success && parsed.data.title).toBe('Renamed');
  });

  it('leaves the type alone when it is omitted', () => {
    const parsed = updateProjectSchema.safeParse({ title: 'x' });

    expect(parsed.success).toBe(true);
    expect(parsed.success && 'type' in parsed.data).toBe(false);
  });

  it('refuses an unknown type with the Czech message that lists the values', () => {
    const parsed = updateProjectSchema.safeParse({ type: 'spheroids' });

    expect(parsed.error?.flatten().fieldErrors.type).toEqual([
      'Neplatný typ projektu. Povolené hodnoty: spheroid, spheroid_invasive, wound, sperm, microtubules, microcapsule, neurite',
    ]);
  });
});
