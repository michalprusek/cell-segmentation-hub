import { describe, it, expect } from 'vitest';
import {
  projectLabelParamsSchema,
  projectIdSchema,
} from '../validation';

/**
 * Regression: the DELETE …/mt-type-labels/:labelId route validates params with
 * this schema. `validateParams` REPLACES req.params with the Zod-parsed object,
 * so the schema MUST retain `labelId` — using `projectIdSchema` (id-only) stripped
 * it, and the handler received `labelId === undefined` (deleted nothing, and
 * spuriously "cleaned" untyped frames).
 */
describe('projectLabelParamsSchema', () => {
  const id = '11111111-1111-1111-1111-111111111111';

  it('retains both id and labelId after parsing', () => {
    const parsed = projectLabelParamsSchema.parse({
      id,
      labelId: 'mt_type_abc123',
    });
    expect(parsed).toEqual({ id, labelId: 'mt_type_abc123' });
  });

  it('projectIdSchema would strip labelId (documents the original bug)', () => {
    const parsed = projectIdSchema.parse({ id, labelId: 'mt_type_abc123' }) as {
      labelId?: string;
    };
    expect(parsed.labelId).toBeUndefined();
  });

  it('rejects an empty labelId', () => {
    expect(() =>
      projectLabelParamsSchema.parse({ id, labelId: '' })
    ).toThrow();
  });

  it('rejects a non-uuid project id', () => {
    expect(() =>
      projectLabelParamsSchema.parse({ id: 'nope', labelId: 'x' })
    ).toThrow();
  });
});
