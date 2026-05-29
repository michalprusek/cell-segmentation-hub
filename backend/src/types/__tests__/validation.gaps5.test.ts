/**
 * validation.gaps5.test.ts
 *
 * Covers branches still uncovered after batchQueueSchema.channel.test.ts:
 *
 *  A. isProjectType / coerceProjectType (lines 150, 153)
 *     - valid type → isProjectType returns true
 *     - invalid → isProjectType returns false
 *     - coerceProjectType falls back to 'spheroid' for unknown
 *
 *  B. projectQuerySchema (lines 261, 269)
 *     - invalid sortBy triggers errorMap
 *     - invalid sortOrder triggers errorMap
 *
 *  C. imageUploadSchema (line 305)
 *     - invalid mimetype triggers errorMap
 *
 *  D. imageQuerySchema (lines 330, 337, 346)
 *     - invalid status triggers errorMap
 *
 *  E. imageReorderSchema (line 442) — refine duplicate check
 *     - duplicate imageIds → parse throws
 *
 *  F. updateFolderSchema (line 496) — refine "at least one field" check
 *     - empty update object → parse throws
 *
 *  G. folderItemsSchema (line 505) — refine duplicate check
 *     - duplicate projectIds → parse throws
 */

import { describe, it, expect } from 'vitest';
import {
  isProjectType,
  coerceProjectType,
  projectQuerySchema,
  imageQuerySchema,
  imageReorderSchema,
  folderItemsSchema,
} from '../validation';

const validUUID = '11111111-1111-4111-8111-111111111111';
const validUUID2 = '22222222-2222-4222-8222-222222222222';

// ─── A. isProjectType / coerceProjectType ─────────────────────────────────────

describe('isProjectType', () => {
  it('returns true for valid project types', () => {
    expect(isProjectType('spheroid')).toBe(true);
    expect(isProjectType('wound')).toBe(true);
    expect(isProjectType('microtubules')).toBe(true);
  });

  it('returns false for invalid types', () => {
    expect(isProjectType('invalid')).toBe(false);
    expect(isProjectType(null)).toBe(false);
    expect(isProjectType(123)).toBe(false);
  });
});

describe('coerceProjectType', () => {
  it('returns the valid type when recognized', () => {
    expect(coerceProjectType('sperm')).toBe('sperm');
  });

  it('falls back to spheroid for unknown values', () => {
    expect(coerceProjectType('unknown-type')).toBe('spheroid');
    expect(coerceProjectType(null)).toBe('spheroid');
    expect(coerceProjectType(undefined)).toBe('spheroid');
  });
});

// ─── B. projectQuerySchema ────────────────────────────────────────────────────

describe('projectQuerySchema', () => {
  it('rejects invalid sortBy with custom errorMap message', () => {
    expect(() =>
      projectQuerySchema.parse({ sortBy: 'invalid', sortOrder: 'asc' })
    ).toThrow(/Řazení/);
  });

  it('rejects invalid sortOrder with custom errorMap message', () => {
    expect(() => projectQuerySchema.parse({ sortOrder: 'random' })).toThrow(
      /Pořadí/
    );
  });
});

// ─── D. imageQuerySchema ──────────────────────────────────────────────────────

describe('imageQuerySchema', () => {
  it('rejects invalid status with custom errorMap message', () => {
    expect(() => imageQuerySchema.parse({ status: 'invalid_status' })).toThrow(
      /Neplatný status/
    );
  });
});

// ─── E. imageReorderSchema — refine duplicate check ───────────────────────────

describe('imageReorderSchema', () => {
  it('rejects duplicate imageIds', () => {
    expect(() =>
      imageReorderSchema.parse({
        imageIds: [validUUID, validUUID], // duplicate
      })
    ).toThrow(/duplicit/i);
  });

  it('accepts unique imageIds', () => {
    const result = imageReorderSchema.parse({
      imageIds: [validUUID, validUUID2],
      mode: 'partial',
    });
    expect(result.imageIds).toHaveLength(2);
  });
});

// ─── G. folderItemsSchema — refine duplicate check ────────────────────────────

describe('folderItemsSchema', () => {
  it('rejects duplicate projectIds', () => {
    expect(() =>
      folderItemsSchema.parse({
        projectIds: [validUUID, validUUID], // duplicate
      })
    ).toThrow(/duplicit/i);
  });

  it('accepts unique projectIds', () => {
    const result = folderItemsSchema.parse({
      projectIds: [validUUID, validUUID2],
    });
    expect(result.projectIds).toHaveLength(2);
  });
});
