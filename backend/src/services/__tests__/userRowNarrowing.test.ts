/**
 * Source-scan guard: the request paths that look a user (or a project) up only
 * to read one field must narrow the row with `select`.
 *
 * A `prisma.user.findUnique({ where: { id } })` with no `select` returns the
 * WHOLE row — `password`, `resetToken`, `verificationToken` — and the call
 * sites below run on hot paths: three on every queue enqueue / stats poll /
 * queue-item listing, one on every dashboard load, one on every folder move.
 * All of them read exactly one field. The `project.findFirst` probes beside
 * the queue ones are used only as `if (!project)` and would otherwise pull
 * `description` and the `mtTypeLabels` Json column.
 *
 * `hasProjectAccess` already documents this rule in a comment beside its own
 * `select` and these call sites had missed it, which is why the guard is a
 * source scan rather than a per-call-site behaviour test: the defect mode is
 * "someone adds another one". `videoUploadService.test.ts` guards its
 * `reportProgress` keys the same way.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '../..');

const FILES = [
  'api/controllers/queueController.ts',
  'services/sharingService.ts',
  'services/projectFolderService.ts',
];

/**
 * Every `<needle>` call in `source`, returned as the full call text with its
 * balanced parentheses. Parsing rather than string-matching, so an indent
 * change cannot silently make the guard pass or fail.
 */
function callsTo(source: string, needle: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const at = source.indexOf(needle, from);
    if (at === -1) {
      break;
    }
    let i = at + needle.length - 1;
    let depth = 0;
    for (; i < source.length; i++) {
      if (source[i] === '(') {
        depth++;
      } else if (source[i] === ')') {
        depth--;
        if (depth === 0) {
          break;
        }
      }
    }
    out.push(source.slice(at, i + 1));
    from = i + 1;
  }
  return out;
}

/** Identity lookups only. The by-e-mail ones answer a different question
 *  (sharingService resolves an invitee and compares their `id`). */
const byId = (calls: string[]): string[] =>
  calls.filter(c => /where:\s*\{\s*id:/.test(c));

describe('user lookups on hot paths are column-narrowed', () => {
  it.each(FILES)('%s selects only what it reads', file => {
    const source = readFileSync(path.join(SRC, file), 'utf8');
    const calls = byId(callsTo(source, 'user.findUnique('));

    // Guard the guard: if the call sites move or are renamed, this test must
    // not quietly pass by finding nothing.
    expect(calls.length).toBeGreaterThan(0);

    for (const call of calls) {
      expect(call).toContain('select:');
      expect(call).toContain('email: true');
      // The whole row would carry these; assert we did not simply widen the
      // select instead of removing it.
      expect(call).not.toContain('password');
    }
  });

  it('queueController narrows its project existence probes too', () => {
    const source = readFileSync(
      path.join(SRC, 'api/controllers/queueController.ts'),
      'utf8'
    );
    // Three handlers verify "does this project exist and may I see it?".
    //
    // Two use the result only as a boolean and must ask for `id` alone. The
    // batch-enqueue one ALSO resolves the project's segmentation model, so it
    // additionally selects `type` and `segmentationModel` — deliberately, to
    // avoid a second round trip for two scalar columns on a path that can
    // carry 10 000 images.
    //
    // What this guard is actually for is unchanged and still asserted below:
    // no probe may drag the whole row, and in particular not `mtTypeLabels`,
    // a JSON column that can hold a full per-project label palette.
    const probes = callsTo(source, 'prisma.project.findFirst(');
    expect(probes).toHaveLength(3);

    const idOnly = probes.filter(p => p.includes('select: { id: true }'));
    const withModel = probes.filter(p =>
      p.includes('select: { id: true, type: true, segmentationModel: true }')
    );
    expect(idOnly).toHaveLength(2);
    expect(withModel).toHaveLength(1);

    for (const probe of probes) {
      expect(probe).toContain('select:');
      expect(probe).not.toContain('mtTypeLabels');
      expect(probe).not.toContain('description');
    }
  });
});
