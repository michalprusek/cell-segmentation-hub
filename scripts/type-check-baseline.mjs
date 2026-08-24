#!/usr/bin/env node
/**
 * type-check-baseline.mjs — the REAL TypeScript gate for this repo.
 *
 * WHY THIS EXISTS
 * ---------------
 * `tsc --noEmit` on the repo-root tsconfig.json checked NOTHING. That config is
 * solution-style (`"files": []` + `"references"`), and plain `tsc -p` does not
 * descend into project references (only `tsc --build` does). So the old
 * `type-check` script resolved 0 input files, compiled 0 files, and exited 0 —
 * always. Every "typecheck clean" claim made through it was vacuous.
 *
 * Pointing the gate straight at the real project configs surfaces a large set
 * of pre-existing errors, which would block every commit and get the hook
 * bypassed. So this script does the honest thing instead:
 *
 *   1. Runs tsc against each REFERENCED project config for real.
 *   2. Compares the errors it finds against a committed baseline of the
 *      known-bad set (typecheck-baseline.json).
 *   3. Fails on any error that is NOT in the baseline; passes otherwise.
 *
 * ERROR IDENTITY
 * --------------
 * Errors are keyed by (project, file, TS code, normalized message) and stored
 * WITH A COUNT. Deliberately NOT by line/column: those shift on every unrelated
 * edit, which would produce constant false failures. Counting per key is what
 * defeats the naive "total error count" baseline, where fixing one error and
 * introducing another leaves the total unchanged and slips through.
 *
 * Messages are normalised before use as a key, because tsc's wording is not
 * byte-stable across runs — union member order and the property set retained
 * inside an elided `... N more ...` type both drifted on this repo with no
 * source change. See canonicalizeType() and TRUNCATED_RE.
 *
 * Whether something FAILS is arbitrated on the (file, TS code) count, with the
 * message keys naming the culprits; see diffCounts() for why, and for the one
 * residual case that is knowingly let through.
 *
 * REGENERATE THE BASELINE
 * -----------------------
 *     npm run type-check:update
 * (equivalently: node scripts/type-check-baseline.mjs --update)
 *
 * Regenerating is a deliberate, reviewable act: typecheck-baseline.json is
 * committed, so newly-accepted errors appear as added lines in the diff.
 *
 * SELF-TEST (proves the gate actually fails on a new error)
 * --------------------------------------------------------
 *     npm run type-check:self-test
 *
 * EXIT CODES
 * ----------
 *   0  no new errors
 *   1  new error(s) found, or a baselined error got more frequent
 *   2  the gate could not run (tsc missing/crashed, config checks nothing)
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const BASELINE_REL = 'typecheck-baseline.json';
const BASELINE_PATH = resolve(REPO_ROOT, BASELINE_REL);
const UPDATE_CMD = 'npm run type-check:update';
const SELF_TEST_CMD = 'npm run type-check:self-test';

/**
 * The projects the (vacuous) root tsconfig.json claims to cover via
 * "references". Checking all three is the honest replacement for it.
 */
const PROJECTS = [
  'tsconfig.app.json',
  'tsconfig.node.json',
  'tsconfig.test.json',
];

const TSC_BIN = resolve(
  REPO_ROOT,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsc.cmd' : 'tsc'
);

/* ------------------------------------------------------------------ */
/* utilities                                                          */
/* ------------------------------------------------------------------ */

const ESC = '\u001b[';
const paint = (code, s) => `${ESC}${code}m${s}${ESC}0m`;
const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const C = {
  red: s => (useColor ? paint(31, s) : s),
  green: s => (useColor ? paint(32, s) : s),
  yellow: s => (useColor ? paint(33, s) : s),
  dim: s => (useColor ? paint(2, s) : s),
  bold: s => (useColor ? paint(1, s) : s),
};

/** Infrastructure failure: the gate could not run. Never exits 0. */
function bail(message, detail) {
  process.stderr.write(`${C.red('x TypeScript gate could not run')}\n`);
  process.stderr.write(`  ${message}\n`);
  if (detail) {
    process.stderr.write(`\n${String(detail).trimEnd()}\n`);
  }
  process.exit(2);
}

function runTsc(args) {
  if (!existsSync(TSC_BIN)) {
    bail(
      `TypeScript compiler not found at ${relative(REPO_ROOT, TSC_BIN)}. ` +
        'Run `npm ci`.'
    );
  }
  const res = spawnSync(TSC_BIN, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (res.error) {
    bail(`failed to spawn tsc: ${res.error.message}`);
  }
  if (res.signal) {
    bail(`tsc was killed by signal ${res.signal} (args: ${args.join(' ')})`);
  }
  return res;
}

/**
 * Guard against the exact bug this script exists to fix: a config that resolves
 * to zero input files type-checks nothing and exits 0. `tsc --showConfig`
 * reports the fully-resolved input list, so we can assert there is real work.
 */
function assertProjectHasInputs(project) {
  const res = runTsc(['-p', project, '--showConfig']);
  if (res.status !== 0) {
    bail(`\`tsc -p ${project} --showConfig\` failed`, res.stderr || res.stdout);
  }
  let cfg;
  try {
    cfg = JSON.parse(res.stdout);
  } catch (err) {
    bail(`could not parse --showConfig output for ${project}`, err.message);
  }
  const count = Array.isArray(cfg.files) ? cfg.files.length : 0;
  if (count === 0) {
    bail(
      `${project} resolves to 0 input files — it would type-check nothing and ` +
        'exit 0. That is the vacuous-gate bug this script exists to prevent; ' +
        "fix the config's include/files."
    );
  }
  return count;
}

/* ------------------------------------------------------------------ */
/* parsing                                                            */
/* ------------------------------------------------------------------ */

// e.g. src/lib/config.ts(98,14): error TS2322: Type 'string' is not ...
const DIAG_RE = /^([^\s(][^(]*)\((\d+),(\d+)\): error (TS\d+): (.*)$/;
// e.g. error TS5083: Cannot read file '...'
const GLOBAL_RE = /^error (TS\d+): (.*)$/;

function normalizeFile(file) {
  const rel = relative(REPO_ROOT, resolve(REPO_ROOT, file));
  const posix = sep === '/' ? rel : rel.split(sep).join('/');
  return posix || file;
}

const CLOSERS = { '<': '>', '(': ')', '{': '}', '[': ']' };
const CLOSING = new Set(Object.values(CLOSERS));

/**
 * Split `s` on `sep`, but only at bracket depth 0 and outside string literals.
 * `=>` is not treated as a closing bracket.
 */
function splitTopLevel(s, sep) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch in CLOSERS) depth += 1;
    else if (CLOSING.has(ch) && !(ch === '>' && s[i - 1] === '=')) depth -= 1;
    else if (ch === sep && depth === 0) {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  return parts;
}

/**
 * Put a type expression into a canonical form by sorting the members of every
 * union it contains.
 *
 * MEASURED, NOT HYPOTHETICAL: tsc does not guarantee a stable member order when
 * it prints a union. The same unchanged file in this repo produced both
 *   Type 'undefined' is not assignable to type '"processing" | "pending" | ...'
 * and
 *   Type 'undefined' is not assignable to type '"pending" | "processing" | ...'
 * on consecutive runs, because union print order follows internal type ids,
 * which depend on instantiation order and therefore on incremental state.
 * Without this canonicalisation the gate reports a false regression on a tree
 * nobody touched — and a gate that cries wolf is a gate that gets bypassed.
 */
function canonicalizeType(s) {
  // ORDERED separators first. An object body (`{ a: X; b: "lo" | "hi" }`) and a
  // parameter/tuple list are SEQUENCES whose order tsc prints deterministically
  // (declaration order). Splitting such a body on `|` before splitting it on
  // `;` was the bug this guards: it treated `a: X` and `"lo"` and `"hi"; b: Y`
  // as union members of one union and sorted across them, scrambling the text
  // into something that was neither stable nor readable. Split the sequence
  // first, canonicalise each element independently, and rejoin IN ORDER.
  for (const sep of [';', ',']) {
    const parts = splitTopLevel(s, sep);
    if (parts.length > 1) {
      return parts.map(part => canonicalizeType(part.trim())).join(`${sep} `);
    }
  }
  // A labelled member (`levelOfDetail: "low" | "medium"`) is a NAME plus a
  // union, not a union whose first member happens to start with a name. Peel
  // the label before sorting, or the name travels with whichever member tsc
  // printed first and the sort produces `"high" | "medium" | levelOfDetail:
  // "low"` — different text for the same type, which is the churn this whole
  // function exists to remove.
  const labelled = /^([A-Za-z_$][A-Za-z0-9_$]*\??\s*:\s*)([\s\S]+)$/.exec(
    s.trim()
  );
  if (labelled && splitTopLevel(labelled[2], '|').length > 1) {
    return (
      labelled[1].replace(/\s*:\s*$/, ': ') +
      canonicalizeType(labelled[2].trim())
    );
  }

  const members = splitTopLevel(s, '|');
  if (members.length > 1) {
    return members
      .map(m => canonicalizeType(m.trim()))
      .sort()
      .join(' | ');
  }
  // Single member: recurse into each top-level bracket group so that unions
  // nested inside generics (Array<A | B>) are canonicalised too.
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const close = CLOSERS[ch];
    if (!close) {
      out += ch;
      continue;
    }
    let depth = 0;
    let end = -1;
    for (let j = i; j < s.length; j++) {
      if (s[j] === ch) depth += 1;
      else if (s[j] === close && !(close === '>' && s[j - 1] === '=')) {
        depth -= 1;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end === -1) {
      out += s.slice(i);
      break;
    }
    out += ch + canonicalizeType(s.slice(i + 1, end)) + close;
    i = end;
  }
  return out;
}

// tsc elides very large types as `... 262 more ...`. Which properties survive
// the elision — and the count itself — vary between runs. MEASURED on this
// repo: src/components/ui/breadcrumb.tsx printed a different retained property
// set on consecutive runs with no source change. Such a message can never be a
// stable key, so it is replaced wholesale by a placeholder.
const TRUNCATED_RE = /\.\.\. \d+ more \.\.\./;
const TRUNCATED_PLACEHOLDER = "'<type elided by tsc>'";

/**
 * Collapse whitespace and canonicalise every quoted type in the message, so a
 * message is identified by what it MEANS rather than by how tsc happened to
 * print it on a given run.
 */
/**
 * tsc prints ABSOLUTE paths inside some message bodies — TS6307 names both the
 * offending file and the tsconfig that omits it. Left alone, those make the
 * baseline machine-specific: the same tree checked out at another path (CI, a
 * second developer, a git worktree) regenerates a wholly different file, which
 * destroys the property that justifies committing it — that every added line is
 * an error somebody deliberately accepted. Failure is arbitrated on (file, code)
 * counts, so this never produced a false failure; it is the baseline's value as
 * a review artifact that is at stake.
 */
const REPO_ROOT_POSIX =
  sep === '/' ? REPO_ROOT : REPO_ROOT.split(sep).join('/');
function stripRepoRoot(text) {
  return text
    .split(`${REPO_ROOT}${sep}`)
    .join('')
    .split(`${REPO_ROOT_POSIX}/`)
    .join('');
}

function normalizeMessage(message) {
  const flat = stripRepoRoot(message.replace(/\s+/g, ' ').trim());
  return flat.replace(/'([^']*)'/g, (m, inner) => {
    if (TRUNCATED_RE.test(inner)) return TRUNCATED_PLACEHOLDER;
    return inner.includes('|') ? `'${canonicalizeType(inner)}'` : m;
  });
}

/**
 * Parse plain (non-pretty) tsc output into
 * `{ file: { "TSxxxx: message": count } }`.
 *
 * Indented continuation lines (type elaborations) are ignored on purpose: they
 * add churn without adding identity.
 */
export function parseDiagnostics(stdout) {
  /** @type {Record<string, Record<string, number>>} */
  const byFile = {};
  let total = 0;
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line || /^\s/.test(line)) continue;
    let file;
    let key;
    const m = DIAG_RE.exec(line);
    if (m) {
      file = normalizeFile(m[1]);
      key = `${m[4]}: ${normalizeMessage(m[5])}`;
    } else {
      const g = GLOBAL_RE.exec(line);
      if (!g) continue;
      file = '(project-wide)';
      key = `${g[1]}: ${normalizeMessage(g[2])}`;
    }
    byFile[file] ??= {};
    byFile[file][key] = (byFile[file][key] ?? 0) + 1;
    total += 1;
  }
  return { byFile, total };
}

function sortDeep(byFile) {
  /** @type {Record<string, Record<string, number>>} */
  const out = {};
  for (const file of Object.keys(byFile).sort()) {
    out[file] = {};
    for (const key of Object.keys(byFile[file]).sort()) {
      out[file][key] = byFile[file][key];
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* the comparison — the heart of the gate                             */
/* ------------------------------------------------------------------ */

const codeOf = key => key.slice(0, key.indexOf(':'));

function totalsByCode(keyCounts) {
  const totals = {};
  for (const [key, n] of Object.entries(keyCounts)) {
    const code = codeOf(key);
    totals[code] = (totals[code] ?? 0) + n;
  }
  return totals;
}

/**
 * Compare one project's current errors against its baseline.
 *
 * WHAT COUNTS AS A REGRESSION
 * ---------------------------
 * Errors are tracked per (file, TS code, message) WITH A COUNT. Tracking counts
 * rather than a bare total is what stops the classic defeat of a count-only
 * baseline: fix one error, introduce a different one, total unchanged, gate
 * green. Here the fixed one shows up as an improvement and the new one as a
 * regression, even though the total never moved.
 *
 * A regression is raised when the number of errors with a given TS code in a
 * given file EXCEEDS the baseline for that (file, code). The specific new
 * message keys are then reported so the developer sees what to fix.
 *
 * WHY THE ARBITRATION IS AT (file, code) AND NOT (file, code, message)
 * --------------------------------------------------------------------
 * Message text is not perfectly stable across tsc runs (see canonicalizeType:
 * union print order genuinely flipped on this repo with no source change).
 * Canonicalisation removes the case we measured, but not every possible one. If
 * the message text for an existing error changes while the number of errors of
 * that code in that file stays the same, that is churn, not a regression: it is
 * reported loudly and the gate still passes, so nobody learns to bypass a hook
 * that cries wolf. A genuinely NEW error necessarily raises the (file, code)
 * count and is caught.
 *
 * KNOWN RESIDUAL (stated rather than hidden): fixing one error and introducing
 * a different one with the SAME TS code in the SAME file leaves the (file,
 * code) count unchanged and is reported as churn rather than failure. Narrowing
 * this further would require line numbers, which churn on every unrelated edit.
 *
 * @param {Record<string, Record<string, number>>} baseline
 * @param {Record<string, Record<string, number>>} current
 */
export function diffCounts(baseline, current) {
  const base = baseline ?? {};
  const cur = current ?? {};
  const regressions = [];
  const improvements = [];
  const churn = [];
  let newErrors = 0;
  let fixedErrors = 0;

  for (const file of new Set([...Object.keys(base), ...Object.keys(cur)])) {
    const b = base[file] ?? {};
    const c = cur[file] ?? {};
    const bt = totalsByCode(b);
    const ct = totalsByCode(c);

    for (const code of new Set([...Object.keys(bt), ...Object.keys(ct)])) {
      const before = bt[code] ?? 0;
      const after = ct[code] ?? 0;
      const appeared = Object.entries(c)
        .filter(([key, n]) => codeOf(key) === code && n > (b[key] ?? 0))
        .map(([key, n]) => ({ file, key, before: b[key] ?? 0, after: n }));

      if (after > before) {
        newErrors += after - before;
        regressions.push(...appeared);
      } else {
        if (after < before) {
          fixedErrors += before - after;
          improvements.push({ file, code, before, after });
        }
        churn.push(...appeared);
      }
    }
  }

  const byFileThenKey = (a, b) =>
    a.file.localeCompare(b.file) ||
    (a.key ?? a.code).localeCompare(b.key ?? b.code);
  regressions.sort(byFileThenKey);
  improvements.sort(byFileThenKey);
  churn.sort(byFileThenKey);
  return { regressions, improvements, churn, newErrors, fixedErrors };
}

/* ------------------------------------------------------------------ */
/* collection                                                         */
/* ------------------------------------------------------------------ */

function collect(projects) {
  /** @type {Record<string, {byFile: object, total: number}>} */
  const results = {};
  for (const project of projects) {
    if (!existsSync(resolve(REPO_ROOT, project))) {
      bail(`configured project ${project} does not exist`);
    }
    assertProjectHasInputs(project);
    const res = runTsc(['--noEmit', '--pretty', 'false', '-p', project]);
    const combined = `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
    const parsed = parseDiagnostics(combined);
    // FAIL CLOSED: tsc reported failure but we could not attribute it to any
    // diagnostic (crash, OOM, bad flag). Never let that be read as "clean".
    if (res.status !== 0 && parsed.total === 0) {
      bail(
        `tsc exited ${res.status} for ${project} but produced no parseable ` +
          'diagnostics',
        combined
      );
    }
    results[project] = { byFile: sortDeep(parsed.byFile), total: parsed.total };
  }
  return results;
}

/* ------------------------------------------------------------------ */
/* baseline I/O                                                       */
/* ------------------------------------------------------------------ */

function tscVersion() {
  const res = runTsc(['--version']);
  return (res.stdout || '').trim().replace(/^Version\s+/, '');
}

/**
 * @param {Record<string, {byFile: object, total: number}>} results freshly
 *   measured projects
 * @param {Record<string, object>} carryOver baselined projects that were NOT
 *   re-measured on this run (because of a --project filter). Without this, a
 *   filtered `--update` would silently delete the other projects' sections and
 *   the next full check would report thousands of "new" errors.
 */
function writeBaseline(results, carryOver = {}) {
  const projects = { ...carryOver };
  for (const [project, r] of Object.entries(results)) {
    projects[project] = r.byFile;
  }
  const countOf = byFile =>
    Object.values(byFile)
      .flatMap(keys => Object.values(keys))
      .reduce((a, b) => a + b, 0);
  const totals = {};
  let all = 0;
  for (const [project, byFile] of Object.entries(projects)) {
    totals[project] = countOf(byFile);
    all += totals[project];
  }
  const doc = {
    _comment:
      'Committed baseline of PRE-EXISTING TypeScript errors. The gate ' +
      '(scripts/type-check-baseline.mjs, run by `npm run type-check`) fails ' +
      'on any error not listed here. Errors are keyed by file + TS code + ' +
      'normalised message (NOT line number, which churns on every unrelated ' +
      'edit) and stored with a count, so fixing one error and introducing ' +
      'another cannot cancel out. Every line below is an error someone chose ' +
      'to accept; the file shrinking over time is the point.',
    _regenerateWith: UPDATE_CMD,
    _selfTest: SELF_TEST_CMD,
    _doNotEditByHand: true,
    typescriptVersion: tscVersion(),
    totals: { ...totals, all },
    projects,
  };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  return doc;
}

function readBaseline() {
  if (!existsSync(BASELINE_PATH)) {
    bail(`${BASELINE_REL} is missing. Create it with:  ${UPDATE_CMD}`);
  }
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  } catch (err) {
    return bail(`${BASELINE_REL} is not valid JSON`, err.message);
  }
}

/* ------------------------------------------------------------------ */
/* reporting                                                          */
/* ------------------------------------------------------------------ */

function printRegressions(perProject) {
  const total = Object.values(perProject).reduce((n, d) => n + d.newErrors, 0);
  process.stderr.write(
    `\n${C.red(
      C.bold(`x TypeScript gate: ${total} new error(s) not in the baseline.`)
    )}\n\n`
  );
  for (const [project, d] of Object.entries(perProject)) {
    if (d.regressions.length === 0) continue;
    process.stderr.write(`  ${C.bold(project)}\n`);
    let lastFile = null;
    for (const r of d.regressions) {
      if (r.file !== lastFile) {
        process.stderr.write(`    ${r.file}\n`);
        lastFile = r.file;
      }
      const delta = r.before === 0 ? 'new' : `${r.before} -> ${r.after}`;
      process.stderr.write(
        `      ${C.red('+')} ${r.key} ${C.dim(`(${delta})`)}\n`
      );
    }
    process.stderr.write('\n');
  }
  process.stderr.write(
    `${C.yellow(
      `These errors are not in ${BASELINE_REL}, so this working tree ` +
        'introduced them.'
    )}\n` +
      'Fix them. Do not add `any` or `@ts-expect-error` to silence them.\n\n' +
      'If you are DELIBERATELY accepting them (e.g. a staged refactor),\n' +
      'regenerate the baseline:\n\n' +
      `    ${C.bold(UPDATE_CMD)}\n\n` +
      `${BASELINE_REL} is committed, so accepted errors show up as added ` +
      'lines\nin code review rather than vanishing silently.\n'
  );
}

/* ------------------------------------------------------------------ */
/* modes                                                              */
/* ------------------------------------------------------------------ */

function modeUpdate(projects, filtered) {
  process.stdout.write(
    `Regenerating ${BASELINE_REL} from ${projects.join(', ')} ...\n`
  );
  // Under a --project filter, keep the sections we are not re-measuring.
  const carryOver = {};
  if (filtered && existsSync(BASELINE_PATH)) {
    for (const [p, byFile] of Object.entries(readBaseline().projects ?? {})) {
      if (!projects.includes(p)) carryOver[p] = byFile;
    }
    const kept = Object.keys(carryOver);
    if (kept.length > 0) {
      process.stdout.write(
        `  (keeping existing entries for ${kept.join(', ')})\n`
      );
    }
  }
  const results = collect(projects);
  const doc = writeBaseline(results, carryOver);
  for (const [project, r] of Object.entries(results)) {
    process.stdout.write(`  ${project}: ${r.total} error(s)\n`);
  }
  process.stdout.write(
    `${C.green('OK')} wrote ${BASELINE_REL} (${doc.totals.all} baselined ` +
      `error(s), tsc ${doc.typescriptVersion})\n` +
      `${C.yellow(
        'Review the diff before committing — every added line is an error ' +
          'you are accepting.'
      )}\n`
  );
  return 0;
}

function modeCheck(projects) {
  const baseline = readBaseline();
  const results = collect(projects);

  const perProject = {};
  let anyRegression = false;
  let fixed = 0;
  const churn = [];
  for (const project of projects) {
    const d = diffCounts(baseline.projects?.[project], results[project].byFile);
    perProject[project] = d;
    if (d.regressions.length > 0) anyRegression = true;
    fixed += d.fixedErrors;
    churn.push(...d.churn.map(c => ({ ...c, project })));
  }

  if (anyRegression) {
    printRegressions(perProject);
    return 1;
  }

  const totalNow = projects.reduce((n, p) => n + results[p].total, 0);
  process.stdout.write(
    `${C.green('OK')} TypeScript gate: no new errors. ${totalNow} baselined ` +
      `error(s) across ${projects.length} project(s).\n`
  );
  if (fixed > 0) {
    process.stdout.write(
      `${C.green('->')} ${fixed} baselined error(s) are now fixed. ` +
        `Lock it in:  ${C.bold(UPDATE_CMD)}\n`
    );
  }
  if (churn.length > 0) {
    // Not a failure: the number of errors of this code in this file did not
    // grow, only the text tsc printed for them changed. Surfaced anyway so it
    // never rots silently.
    process.stdout.write(
      `${C.yellow('!')} ${churn.length} baselined error(s) changed message ` +
        `text without changing in number (tsc wording/print-order drift, not ` +
        `a new error). Refresh with:  ${C.bold(UPDATE_CMD)}\n`
    );
    for (const c of churn.slice(0, 10)) {
      process.stdout.write(`    ${C.dim(`${c.project} ${c.file}`)}\n`);
      process.stdout.write(`      ${c.key}\n`);
    }
    if (churn.length > 10) {
      process.stdout.write(
        `    ${C.dim(`... and ${churn.length - 10} more`)}\n`
      );
    }
  }
  return 0;
}

/* ------------------------------------------------------------------ */
/* self-test                                                          */
/* ------------------------------------------------------------------ */

function assert(cond, what) {
  if (cond) {
    process.stdout.write(`  ${C.green('PASS')} ${what}\n`);
  } else {
    process.stdout.write(`  ${C.red('FAIL')} ${what}\n`);
    throw new Error(`self-test failed: ${what}`);
  }
}

/** Unit-level proof that the key/count comparison is not defeatable. */
function unitTests() {
  process.stdout.write('Unit: diffCounts()\n');

  const base = {
    'src/a.ts': { 'TS2322: Type X is not assignable to Y': 2 },
    'src/b.ts': { 'TS2345: Argument of type X': 1 },
  };

  assert(
    diffCounts(base, base).regressions.length === 0,
    'identical input -> no regression'
  );

  assert(
    diffCounts(base, {
      ...base,
      'src/c.ts': { 'TS7006: Parameter x implicitly has an any type': 1 },
    }).regressions.length === 1,
    'a brand-new error in a new file -> regression'
  );

  assert(
    diffCounts(base, {
      ...base,
      'src/a.ts': { 'TS2322: Type X is not assignable to Y': 3 },
    }).regressions.length === 1,
    'an existing key occurring MORE often -> regression'
  );

  // The failure mode a naive count-only baseline cannot see: the total stays
  // at 3, but one error was fixed and a different one introduced.
  const swapped = {
    'src/a.ts': { 'TS2322: Type X is not assignable to Y': 1 },
    'src/b.ts': {
      'TS2345: Argument of type X': 1,
      'TS2531: Object is possibly null': 1,
    },
  };
  const totalOf = m =>
    Object.values(m)
      .flatMap(k => Object.values(k))
      .reduce((a, b) => a + b, 0);
  const swapDiff = diffCounts(base, swapped);
  assert(
    totalOf(base) === totalOf(swapped) && swapDiff.regressions.length === 1,
    'same TOTAL error count but a different error -> still a regression ' +
      '(a naive count-only baseline would pass this)'
  );

  // Same code, same file, but one MORE of them than the baseline allows.
  assert(
    diffCounts(base, {
      ...base,
      'src/b.ts': {
        'TS2345: Argument of type X': 1,
        'TS2345: Argument of type Y': 1,
      },
    }).regressions.length === 1,
    'an ADDITIONAL error of an already-baselined code in the same file -> ' +
      'regression'
  );

  const fixed = { 'src/b.ts': { 'TS2345: Argument of type X': 1 } };
  const fixDiff = diffCounts(base, fixed);
  assert(
    fixDiff.regressions.length === 0 &&
      fixDiff.improvements.length === 1 &&
      fixDiff.fixedErrors === 2,
    'fixing baselined errors -> no regression, reported as improvement'
  );

  // Message text drifted but the number of TS2345s in src/b.ts did not.
  const drifted = {
    ...base,
    'src/b.ts': { 'TS2345: Argument of type X (reworded by tsc)': 1 },
  };
  const driftDiff = diffCounts(base, drifted);
  assert(
    driftDiff.regressions.length === 0 && driftDiff.churn.length === 1,
    'same (file, code) count but different message text -> churn, not a ' +
      'failure (a gate that cries wolf gets bypassed)'
  );

  process.stdout.write('Unit: normalizeMessage() union canonicalisation\n');
  const observedA =
    'Type \'undefined\' is not assignable to type \'"processing" | "pending" | "completed"\'.';
  const observedB =
    'Type \'undefined\' is not assignable to type \'"pending" | "completed" | "processing"\'.';
  assert(
    parseDiagnostics(`src/x.ts(1,1): error TS2322: ${observedA}`).byFile[
      'src/x.ts'
    ] !== undefined,
    'a union-bearing diagnostic parses'
  );
  const keyA = Object.keys(
    parseDiagnostics(`src/x.ts(1,1): error TS2322: ${observedA}`).byFile[
      'src/x.ts'
    ]
  )[0];
  const keyB = Object.keys(
    parseDiagnostics(`src/x.ts(9,9): error TS2322: ${observedB}`).byFile[
      'src/x.ts'
    ]
  )[0];
  assert(
    keyA === keyB,
    'the SAME union printed in a different member order collapses to one key ' +
      '(this exact flip was observed on this repo with no source change)'
  );
  const nested = parseDiagnostics(
    "src/x.ts(1,1): error TS2345: Argument of type 'Array<B | A>' is not assignable."
  ).byFile['src/x.ts'];
  assert(
    Object.keys(nested)[0].includes("'Array<A | B>'"),
    'unions nested inside generics are canonicalised too'
  );

  const elidedKey = s => Object.keys(parseDiagnostics(s).byFile['src/x.ts'])[0];
  assert(
    elidedKey(
      "src/x.ts(1,1): error TS2322: Type '{a: X; ... 262 more ...; z: Y}' is not assignable to type 'P'."
    ) ===
      elidedKey(
        "src/x.ts(7,7): error TS2322: Type '{b: X; ... 259 more ...; q: Y}' is not assignable to type 'P'."
      ),
    'types tsc elided as `... N more ...` collapse to one key (their retained ' +
      'property set was measured to differ between runs on this repo)'
  );

  process.stdout.write('Unit: parseDiagnostics()\n');
  const sample = [
    "src/App.tsx(110,9): error TS2322: Type 'A' is not assignable to type 'B'.",
    "  Property 'future' does not exist on type 'B'.",
    "src/App.tsx(999,1): error TS2322: Type 'A' is not assignable to type 'B'.",
    "error TS5083: Cannot read file 'nope.json'.",
  ].join('\n');
  const parsed = parseDiagnostics(sample);
  assert(
    parsed.total === 3,
    'indented elaboration lines are not counted as errors'
  );
  assert(
    parsed.byFile['src/App.tsx'][
      "TS2322: Type 'A' is not assignable to type 'B'."
    ] === 2,
    'the same error at two DIFFERENT lines collapses to one key with count 2 ' +
      '(line-number churn cannot move it)'
  );
  assert(
    parsed.byFile['(project-wide)']["TS5083: Cannot read file 'nope.json'."] ===
      1,
    'file-less project-wide diagnostics are captured'
  );
}

/** End-to-end proof: the wired gate fails on a real new error, passes clean. */
function endToEndTest() {
  const probeRel = 'src/__typecheck_gate_probe__.ts';
  const probeAbs = resolve(REPO_ROOT, probeRel);
  const runGate = () =>
    spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: '1' },
    });

  process.stdout.write('\nEnd-to-end: gate against the working tree\n');
  const clean = runGate();
  assert(
    clean.status === 0,
    `current tree PASSES the gate (exit ${clean.status})`
  );

  if (existsSync(probeAbs)) {
    throw new Error(`refusing to overwrite existing ${probeRel}`);
  }

  let planted;
  try {
    writeFileSync(
      probeAbs,
      '// Temporary probe written by `npm run type-check:self-test`.\n' +
        '// If you are seeing this file in a commit, the self-test crashed —\n' +
        '// delete it.\n' +
        "export const typecheckGateProbe: number = 'definitely not a number';\n",
      'utf8'
    );
    planted = runGate();
  } finally {
    rmSync(probeAbs, { force: true });
  }

  assert(
    planted.status === 1,
    `planted error FAILS the gate (exit ${planted.status})`
  );
  const out = `${planted.stdout}${planted.stderr}`;
  assert(out.includes(probeRel), 'failure output names the offending file');
  assert(out.includes('TS2322'), 'failure output names the TS error code');
  assert(
    out.includes(UPDATE_CMD),
    `failure output states the regeneration command (${UPDATE_CMD})`
  );

  const restored = runGate();
  assert(
    restored.status === 0,
    `gate PASSES again once the error is removed (exit ${restored.status})`
  );

  process.stdout.write(
    '\n--- captured gate output with the planted error ---\n'
  );
  process.stdout.write(`${out.trimEnd()}\n`);
  process.stdout.write('--- end captured output ---\n');
}

function modeSelfTest() {
  try {
    unitTests();
    endToEndTest();
  } catch (err) {
    process.stderr.write(`\n${C.red('x self-test FAILED')}: ${err.message}\n`);
    return 1;
  }
  process.stdout.write(`\n${C.green('OK self-test passed')}\n`);
  return 0;
}

/* ------------------------------------------------------------------ */
/* cli                                                                */
/* ------------------------------------------------------------------ */

function help() {
  process.stdout.write(
    'Usage: node scripts/type-check-baseline.mjs [options]\n\n' +
      '  (no options)   type-check every referenced project and fail on any\n' +
      `                 error not already in ${BASELINE_REL}\n` +
      `  --update       REGENERATE ${BASELINE_REL} from the current tree\n` +
      `                 npm alias: ${UPDATE_CMD}\n` +
      '  --self-test    prove the gate fails on a newly-introduced error\n' +
      `                 npm alias: ${SELF_TEST_CMD}\n` +
      '  --project=P    restrict to one project config (repeatable)\n' +
      '  --help\n\n' +
      `Projects checked by default: ${PROJECTS.join(', ')}\n`
  );
  return 0;
}

function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return help();

  const selected = argv
    .filter(a => a.startsWith('--project='))
    .map(a => a.slice('--project='.length));
  const projects = selected.length > 0 ? selected : PROJECTS;

  if (argv.includes('--self-test')) return modeSelfTest();
  if (argv.includes('--update'))
    return modeUpdate(projects, selected.length > 0);
  return modeCheck(projects);
}

if (
  resolve(process.argv[1] ?? '') === resolve(fileURLToPath(import.meta.url))
) {
  process.exit(main(process.argv.slice(2)));
}
