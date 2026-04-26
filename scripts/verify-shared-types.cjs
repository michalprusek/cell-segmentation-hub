#!/usr/bin/env node
/**
 * Verify that frontend and backend cross-stack constants stay in sync.
 *
 * The frontend (Vite/Vitest) and backend (Node/Vitest) build trees do
 * not share an import path, so we keep the canonical declarations in
 * separate files and just verify they match. Cheaper than wiring a
 * monorepo / shared package, sufficient because drift is rare.
 *
 * Runs in pre-commit (via lint-staged) and in CI. Fails with a clear
 * diff if any pair drifts.
 *
 * To register a new shared constant, append an entry to `SHARED_CONSTS`
 * below — the rest is generic.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/** @type {Array<{name: string, frontend: string, backend: string}>} */
const SHARED_CONSTS = [
  {
    name: 'MODEL_TYPE_COMPATIBILITY',
    frontend: path.join(ROOT, 'src', 'types', 'index.ts'),
    backend: path.join(ROOT, 'backend', 'src', 'types', 'validation.ts'),
  },
  {
    name: 'PROJECT_TYPES',
    frontend: path.join(ROOT, 'src', 'types', 'index.ts'),
    backend: path.join(ROOT, 'backend', 'src', 'types', 'validation.ts'),
  },
];

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
    if (ch === '{' || ch === '[') {
      depth++;
      started = true;
    } else if (ch === '}' || ch === ']') {
      depth--;
      if (started && depth === 0) {
        const semi = src.indexOf(';', i);
        return src.slice(startIdx, semi + 1);
      }
    }
  }
  return null;
}

/** Whitespace-insensitive equality — declaration order, types, and
 * values must match; whitespace differences are noise. */
const normalize = s => s.replace(/\s+/g, ' ').trim();

let failed = 0;

for (const entry of SHARED_CONSTS) {
  const front = extractConstBlock(entry.frontend, entry.name);
  const back = extractConstBlock(entry.backend, entry.name);

  if (!front) {
    console.error(
      `FAIL: could not locate ${entry.name} in ${path.relative(ROOT, entry.frontend)}`
    );
    failed++;
    continue;
  }
  if (!back) {
    console.error(
      `FAIL: could not locate ${entry.name} in ${path.relative(ROOT, entry.backend)}`
    );
    failed++;
    continue;
  }

  if (normalize(front) !== normalize(back)) {
    console.error(
      `FAIL: ${entry.name} has drifted between frontend and backend.`
    );
    console.error('');
    console.error(`Frontend (${path.relative(ROOT, entry.frontend)}):`);
    console.error('  ' + front.split('\n').join('\n  '));
    console.error('');
    console.error(`Backend  (${path.relative(ROOT, entry.backend)}):`);
    console.error('  ' + back.split('\n').join('\n  '));
    console.error('');
    console.error(
      'Update both files so the const declarations are byte-identical, then re-run.'
    );
    failed++;
    continue;
  }

  console.log(`OK: ${entry.name} frontend ↔ backend in sync.`);
}

if (failed > 0) {
  console.error('');
  console.error(
    `${failed} of ${SHARED_CONSTS.length} shared constants are out of sync.`
  );
  process.exit(1);
}
