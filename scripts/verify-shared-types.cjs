#!/usr/bin/env node
/**
 * Verify that frontend and backend `MODEL_TYPE_COMPATIBILITY` constants
 * stay in sync. This is the cheaper alternative to setting up a
 * monorepo / shared package — we leave the two declarations where they
 * are (separate build trees, no shared import path needed) and just
 * verify they match.
 *
 * Runs in pre-commit (via lint-staged) and in CI. Fails with a clear
 * diff if the two declarations drift.
 *
 * Why we don't do a "real" shared package:
 * - Drift frequency is essentially zero (the two declarations have
 *   never diverged since they were authored together).
 * - Adding workspaces / path aliases to both Vite + ts-jest + Vitest
 *   build trees costs more than this script.
 * - If drift becomes routine (>1×/quarter), revisit and migrate to a
 *   real shared package; until then, verify-and-warn is enough.
 */

const fs = require('fs');
const path = require('path');

const FRONTEND_FILE = path.resolve(__dirname, '..', 'src', 'types', 'index.ts');
const BACKEND_FILE = path.resolve(
  __dirname,
  '..',
  'backend',
  'src',
  'types',
  'validation.ts'
);

/**
 * Extract the source range of a `const NAME = ...` block. Returns the
 * full text from `export const NAME` through the line containing the
 * matching closing `} as const;` (or `};` if no `as const`).
 */
function extractConstBlock(filePath, name) {
  const src = fs.readFileSync(filePath, 'utf8');
  const startRe = new RegExp(`export\\s+const\\s+${name}\\s*[:=]`, 'm');
  const startMatch = src.match(startRe);
  if (!startMatch) {
    return null;
  }

  const startIdx = startMatch.index;
  // Walk forward, tracking brace depth
  let depth = 0;
  let i = startIdx;
  let inString = false;
  let stringQuote = '';
  let started = false;

  for (; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      if (ch === stringQuote && src[i - 1] !== '\\') {
        inString = false;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = true;
      stringQuote = ch;
      continue;
    }
    if (ch === '{') {
      depth++;
      started = true;
    } else if (ch === '}') {
      depth--;
      if (started && depth === 0) {
        // Find the end of this statement (next semicolon)
        const semi = src.indexOf(';', i);
        return src.slice(startIdx, semi + 1);
      }
    }
  }
  return null;
}

const compatFront = extractConstBlock(
  FRONTEND_FILE,
  'MODEL_TYPE_COMPATIBILITY'
);
const compatBack = extractConstBlock(BACKEND_FILE, 'MODEL_TYPE_COMPATIBILITY');

if (!compatFront) {
  console.error(
    `FAIL: could not locate MODEL_TYPE_COMPATIBILITY in ${FRONTEND_FILE}`
  );
  process.exit(1);
}
if (!compatBack) {
  console.error(
    `FAIL: could not locate MODEL_TYPE_COMPATIBILITY in ${BACKEND_FILE}`
  );
  process.exit(1);
}

// Normalize whitespace for comparison — declaration order, types, and
// values must match; whitespace differences are noise.
const normalize = s => s.replace(/\s+/g, ' ').trim();
const a = normalize(compatFront);
const b = normalize(compatBack);

if (a !== b) {
  console.error(
    'FAIL: MODEL_TYPE_COMPATIBILITY has drifted between frontend and backend.'
  );
  console.error('');
  console.error(`Frontend (${path.relative(process.cwd(), FRONTEND_FILE)}):`);
  console.error('  ' + compatFront.split('\n').join('\n  '));
  console.error('');
  console.error(`Backend  (${path.relative(process.cwd(), BACKEND_FILE)}):`);
  console.error('  ' + compatBack.split('\n').join('\n  '));
  console.error('');
  console.error(
    'Update both files so the const declarations are byte-identical, then re-run.'
  );
  process.exit(1);
}

console.log('OK: MODEL_TYPE_COMPATIBILITY frontend ↔ backend in sync.');
