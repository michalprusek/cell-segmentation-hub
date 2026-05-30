#!/usr/bin/env node
/**
 * Cross-language model-registry parity check.
 *
 * The model set is a single source of truth WITHIN each language
 * (backend/src/constants/modelRegistry.ts, src/lib/models/modelRegistry.ts) but
 * the Python ML service cannot import a TS literal, so its model list lives in
 * `backend/segmentation/ml/model_loader.py` (`AVAILABLE_MODELS`). This script
 * asserts the three id sets are identical, catching the one drift the
 * per-language registries cannot structurally prevent.
 *
 * Run manually or in CI: `node scripts/check-model-parity.cjs`
 * (intentionally NOT wired into the pre-commit hook — a parser hiccup must
 *  never block an unrelated commit.)
 *
 * Exit 0 = in sync, exit 1 = drift (prints a diff).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/**
 * Extract the top-level (depth-1) keys of the first object literal that follows
 * `<declMarker> {` in a source file. Handles both unquoted TS keys (`hrnet:`)
 * and quoted Python keys (`'hrnet':`). Ignores strings/comments well enough for
 * these registry files (no `{`/`}` inside key names).
 */
function extractObjectKeys(filePath, declMarker) {
  const src = fs.readFileSync(filePath, 'utf8');
  const declIdx = src.indexOf(declMarker);
  if (declIdx === -1) {
    throw new Error(`Could not find "${declMarker}" in ${filePath}`);
  }
  const braceStart = src.indexOf('{', declIdx);
  if (braceStart === -1) {
    throw new Error(`No object literal after "${declMarker}" in ${filePath}`);
  }

  const keys = [];
  let depth = 0;
  let i = braceStart;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') {
      depth++;
      continue;
    }
    if (ch === '}') {
      depth--;
      if (depth === 0) break; // end of the registry object
      continue;
    }
    // Only look for keys at the immediate object level.
    if (depth === 1) {
      // Match an identifier or a quoted string immediately followed by ':'.
      const rest = src.slice(i);
      const m = rest.match(
        /^\s*(?:'([a-z0-9_]+)'|"([a-z0-9_]+)"|([a-z_][a-z0-9_]*))\s*:/i
      );
      if (m) {
        keys.push(m[1] || m[2] || m[3]);
        i += m[0].length - 1; // skip past the matched key:
      }
    }
  }
  return keys;
}

function setEq(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

const sources = [
  {
    name: 'backend registry',
    file: path.join(ROOT, 'backend', 'src', 'constants', 'modelRegistry.ts'),
    marker: 'export const MODEL_REGISTRY',
  },
  {
    name: 'frontend registry',
    file: path.join(ROOT, 'src', 'lib', 'models', 'modelRegistry.ts'),
    marker: 'export const MODEL_REGISTRY',
  },
  {
    name: 'python AVAILABLE_MODELS',
    file: path.join(ROOT, 'backend', 'segmentation', 'ml', 'model_loader.py'),
    marker: 'AVAILABLE_MODELS',
  },
];

let ok = true;
const sets = sources.map(s => {
  const keys = extractObjectKeys(s.file, s.marker).sort();
  return { ...s, keys, set: new Set(keys) };
});

// Compare every source against the first (backend registry = canonical).
const base = sets[0];
for (const s of sets.slice(1)) {
  if (!setEq(base.set, s.set)) {
    ok = false;
    const missing = base.keys.filter(k => !s.set.has(k));
    const extra = s.keys.filter(k => !base.set.has(k));
    console.error(`DRIFT: ${s.name} vs ${base.name}`);
    if (missing.length)
      console.error(`  missing in ${s.name}: ${missing.join(', ')}`);
    if (extra.length)
      console.error(`  extra in ${s.name}: ${extra.join(', ')}`);
  }
}

if (ok) {
  console.log(
    `OK: model ids in sync across ${sets.length} sources (${base.keys.length} models): ${base.keys.join(', ')}`
  );
  process.exit(0);
} else {
  console.error('\n✖ model-registry parity check failed.');
  process.exit(1);
}
