/**
 * `docs/api/public-v1.md` against the code.
 *
 * The page's tables were generated from these same constants, and prose
 * drifts the moment a constant moves. This fails when a model, format,
 * problem code, warning code or limit exists in the code and not on the page.
 *
 * The page lives outside `backend/`, so this is skipped where only that
 * directory is mounted (the container recipe in CLAUDE.md) and runs wherever
 * the whole checkout is present — CI, and locally with the repo root mounted:
 *
 *   docker run --rm --user root --entrypoint /bin/sh \
 *     -v $PWD:/repo -v /repo/backend/node_modules -w /repo/backend \
 *     cell-segmentation-hub-backend \
 *     -c "cp -r /app/node_modules/. node_modules/ 2>/dev/null; npx vitest run src/api/v1/__tests__/docs.test.ts"
 */
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { SEGMENTATION_MODELS } from '../../../constants/modelRegistry';
import {
  V1_RATE_LIMIT_PER_MINUTE,
  V1_UNAUTHENTICATED_LIMIT_PER_MINUTE,
} from '../limits';
import { OUTPUT_FORMATS, V1_MODELS } from '../models';
import { PROBLEM_TYPES } from '../problem';
import {
  MAX_CONCURRENT_PER_KEY,
  SYNC_MAX_BYTES,
  SYNC_MAX_PIXELS,
} from '../segment';

const PAGE = path.resolve(__dirname, '../../../../../docs/api/public-v1.md');
const present = existsSync(PAGE);
const page = present ? readFileSync(PAGE, 'utf8') : '';

/** The table row for a model id: `| \`id\` | ... |`. */
const rowOf = (id: string): string[] =>
  (page.split('\n').find(line => line.startsWith(`| \`${id}\``)) ?? '')
    .split('|')
    .map(cell => cell.trim());

describe.skipIf(!present)('docs/api/public-v1.md', () => {
  it('has a row for every model that states what the code states', () => {
    for (const id of SEGMENTATION_MODELS) {
      const model = V1_MODELS[id];
      const row = rowOf(id);
      expect(row.length, id).toBeGreaterThan(7);
      expect(row[2], id).toBe(model.name);
      expect(row[3], id).toBe(model.geometry);
      for (const name of [...model.classes, ...(model.parts ?? [])]) {
        expect(row[4], `${id} classes`).toContain(`\`${name}\``);
      }
      expect(row[5].startsWith('yes'), `${id} threshold`).toBe(Boolean(model.threshold));
      expect(row[6].startsWith('yes'), `${id} detect_holes`).toBe(model.detectHoles);
      expect(row[7], `${id} depth`).toBe(model.inputDepth);
    }
  });

  it('documents every output format', () => {
    for (const format of OUTPUT_FORMATS) {
      expect(page).toContain(`| \`${format}\``);
    }
  });

  it('lists every problem type with its status', () => {
    for (const [code, type] of Object.entries(PROBLEM_TYPES)) {
      // Prettier pads table cells, so match the row by its cells.
      expect(page).toMatch(
        new RegExp(`\\|\\s*${type.status}\\s*\\|\\s*\`${code}\`\\s*\\|`)
      );
    }
  });

  it('lists every warning code the endpoint can emit', () => {
    for (const code of [
      'multipage_image',
      'input_depth_converted',
      'model_warning',
      'no_objects',
      'invalid_geometry_dropped',
      'orphan_holes_dropped',
    ]) {
      expect(page).toContain(`| \`${code}\``);
    }
  });

  it('quotes the limits the code enforces', () => {
    expect(SYNC_MAX_PIXELS).toBe(4096 * 4096);
    expect(page).toContain('4096 × 4096 pixels');
    expect(page).toContain(`**${SYNC_MAX_BYTES / 1024 / 1024} MiB**`);
    expect(page).toContain(`**${MAX_CONCURRENT_PER_KEY} segmentations in flight**`);
    expect(page).toContain(`${V1_RATE_LIMIT_PER_MINUTE} requests per minute per key`);
    expect(page).toContain(`${V1_UNAUTHENTICATED_LIMIT_PER_MINUTE} requests per minute per IP`);
  });
});
