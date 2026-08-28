#!/usr/bin/env node
/**
 * eslint-baseline.mjs — the ESLint gate for backend/src.
 *
 * WHY THIS EXISTS
 * ---------------
 * `make ci` ran `npx eslint --max-warnings=0 src/` from the repo root. That is
 * the FRONTEND tree only: the root eslint.config.js explicitly ignores
 * `backend/**` (it has its own, stricter config and its own tsconfig). Nothing
 * else covered it either — the CI `backend` job ran TypeScript and Vitest but
 * no lint, and `.lintstagedrc.json` maps `backend/src/**` to an empty task
 * list while its `*.{ts,tsx}` entry hands backend files to the ROOT eslint,
 * which ignores them (`--no-warn-ignored` hides even that).
 *
 * So `backend/src` had never been linted by any gate. That is not theoretical:
 * a hard ESLint error (an unused `NextFunction` import left behind when its
 * users were deleted) shipped through a green `make ci` on 2026-08-28.
 *
 * Pointing a gate straight at it surfaces a set of pre-existing problems,
 * which would block every commit and get the hook bypassed. So this script
 * does the same honest thing scripts/type-check-baseline.mjs does for tsc:
 *
 *   1. Runs ESLint against backend/src for real.
 *   2. Compares what it finds against a committed baseline of the known-bad
 *      set (eslint-baseline.json).
 *   3. Fails on any problem that is NOT in the baseline; passes otherwise.
 *
 * PROBLEM IDENTITY
 * ----------------
 * Problems are keyed by (target, file, severity, rule, normalised message) and
 * stored WITH A COUNT. Deliberately NOT by line/column: those shift on every
 * unrelated edit, which would produce constant false failures. Counting per
 * key is what defeats the naive "total problem count" baseline, where fixing
 * one problem and introducing another leaves the total unchanged and slips
 * through.
 *
 * Whether something FAILS is arbitrated on the (file, severity, rule) count,
 * with the message keys naming the culprits; see diffCounts().
 *
 * WARNINGS ARE GATED TOO
 * ----------------------
 * The frontend gate is `eslint --max-warnings=0`: a warning is a failure
 * there. Gating errors only here would create a severity that nobody ever
 * sees and that can therefore only grow. Severity is part of the key, so a
 * rule downgraded from error to warning shows up as a change rather than
 * vanishing.
 *
 * REGENERATE THE BASELINE
 * -----------------------
 *     npm run lint:backend:update
 * (equivalently: node scripts/eslint-baseline.mjs --update)
 *
 * Regenerating is a deliberate, reviewable act: eslint-baseline.json is
 * committed, so newly-accepted problems appear as added lines in the diff.
 *
 * SELF-TEST (proves the gate actually fails on a new problem)
 * ----------------------------------------------------------
 *     npm run lint:backend:self-test
 *
 * NO ROOT DEPENDENCIES: this script uses only Node builtins and spawns the
 * TARGET's own ESLint (backend/node_modules/.bin/eslint), so the CI `backend`
 * job — which only runs `npm ci` inside backend/ — can run it as-is.
 *
 * EXIT CODES
 * ----------
 *   0  no new problems
 *   1  new problem(s) found, or a baselined problem got more frequent
 *   2  the gate could not run (eslint missing/crashed, nothing linted, a file
 *      failed to parse, or the lint scope silently shrank)
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const BASELINE_REL = 'eslint-baseline.json';
const BASELINE_PATH = resolve(REPO_ROOT, BASELINE_REL);
const UPDATE_CMD = 'npm run lint:backend:update';
const SELF_TEST_CMD = 'npm run lint:backend:self-test';

/**
 * The trees this gate covers.
 *
 * Only `backend/src` for now — it is the one tree with no lint gate at all.
 * The frontend is already at zero problems and is gated directly by
 * `npx eslint --max-warnings=0 src/`, so it needs no baseline; putting it here
 * would only make its clean state look like something being tolerated.
 *
 * NOTE: backend/eslint.config.js ignores `**\/*.test.ts` and `**\/__tests__/**`,
 * so backend test files are still unlinted. Widening that is a separate change
 * (it adds a large amount of new debt to review at once); this gate is scoped
 * to what `npx eslint src/` in backend/ actually checks today.
 */
const TARGETS = [{ name: 'backend', dir: 'backend', patterns: ['src'] }];

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
  process.stderr.write(`${C.red('x ESLint gate could not run')}\n`);
  process.stderr.write(`  ${message}\n`);
  if (detail) {
    process.stderr.write(`\n${String(detail).trimEnd()}\n`);
  }
  process.exit(2);
}

const SEVERITY = { 1: 'warning', 2: 'error' };

function eslintBinFor(target) {
  return resolve(
    REPO_ROOT,
    target.dir,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'eslint.cmd' : 'eslint'
  );
}

function toPosix(p) {
  return sep === '/' ? p : p.split(sep).join('/');
}

function normalizeFile(filePath) {
  return toPosix(relative(REPO_ROOT, resolve(REPO_ROOT, filePath))) || filePath;
}

/**
 * ESLint messages are template-generated and far more stable than tsc's, but
 * some rules interpolate absolute paths (import resolution, config problems).
 * Left alone those would make the baseline machine-specific: the same tree
 * checked out at another path (CI, a git worktree) would regenerate a wholly
 * different file, destroying the property that justifies committing it — that
 * every added line is a problem somebody deliberately accepted.
 */
const REPO_ROOT_POSIX = toPosix(REPO_ROOT);
function normalizeMessage(message) {
  return String(message)
    .replace(/\s+/g, ' ')
    .trim()
    .split(`${REPO_ROOT}${sep}`)
    .join('')
    .split(`${REPO_ROOT_POSIX}/`)
    .join('');
}

/**
 * A message with no ruleId is either a genuine parse failure (`fatal: true`)
 * or a directive-level report such as an unused `eslint-disable`. The first is
 * fatal to the gate (see runEslint); the second gets a stable pseudo-rule so
 * it can be baselined like anything else.
 */
function ruleNameOf(message) {
  return message.ruleId ?? '(directive)';
}

/**
 * The bucket failure is arbitrated on: everything before the first colon, i.e.
 * `"<severity> <rule>"`. Rule ids never contain a colon (plugin rules use `/`),
 * so the split is unambiguous.
 */
export function bucketOf(key) {
  const i = key.indexOf(':');
  return i === -1 ? key : key.slice(0, i);
}

/* ------------------------------------------------------------------ */
/* running ESLint                                                     */
/* ------------------------------------------------------------------ */

function runEslint(target) {
  const bin = eslintBinFor(target);
  if (!existsSync(bin)) {
    bail(
      `ESLint not found at ${toPosix(relative(REPO_ROOT, bin))}. ` +
        `Run \`npm ci\` in ${target.dir}/.`
    );
  }
  const cwd = resolve(REPO_ROOT, target.dir);
  const res = spawnSync(bin, [...target.patterns, '--format', 'json'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: '1' },
  });
  if (res.error) {
    bail(`failed to spawn eslint for ${target.name}: ${res.error.message}`);
  }
  if (res.signal) {
    bail(`eslint was killed by signal ${res.signal} (target ${target.name})`);
  }
  // ESLint exits 0 (clean), 1 (lint problems) or 2 (it could not run: bad
  // config, unresolvable plugin, unmatched pattern). Only 0 and 1 carry a
  // usable report.
  if (res.status !== 0 && res.status !== 1) {
    bail(
      `eslint exited ${res.status} for ${target.name} — it could not run`,
      `${res.stdout ?? ''}\n${res.stderr ?? ''}`
    );
  }
  let results;
  try {
    results = JSON.parse(res.stdout);
  } catch (err) {
    return bail(
      `could not parse eslint JSON output for ${target.name}: ${err.message}`,
      `${res.stdout ?? ''}\n${res.stderr ?? ''}`
    );
  }
  if (!Array.isArray(results)) {
    return bail(`eslint JSON output for ${target.name} is not an array`);
  }
  // FAIL CLOSED on the vacuous-gate bug: a pattern that matches nothing (an
  // over-broad `ignores`, a moved directory) lints zero files and reports zero
  // problems, which reads exactly like "clean".
  if (results.length === 0) {
    bail(
      `eslint linted 0 files for ${target.name} ` +
        `(patterns: ${target.patterns.join(' ')}). It would check nothing and ` +
        'pass unconditionally — that is the vacuous-gate bug this script ' +
        "exists to prevent; fix the config's ignores or the patterns."
    );
  }
  return results;
}

/**
 * Turn one target's ESLint results into `{ file: { key: count } }`.
 *
 * @param {Array} results raw ESLint JSON formatter output
 * @returns {{ byFile: Record<string, Record<string, number>>, total: number,
 *            filesLinted: number, linted: Set<string>, fatals: Array }}
 */
export function collectResults(results) {
  /** @type {Record<string, Record<string, number>>} */
  const byFile = {};
  const linted = new Set();
  const fatals = [];
  let total = 0;
  for (const result of results) {
    const file = normalizeFile(result.filePath);
    linted.add(file);
    for (const m of result.messages ?? []) {
      if (m.fatal) {
        fatals.push({ file, line: m.line, message: m.message });
        continue;
      }
      const key = `${SEVERITY[m.severity] ?? 'error'} ${ruleNameOf(m)}: ${normalizeMessage(m.message)}`;
      byFile[file] ??= {};
      byFile[file][key] = (byFile[file][key] ?? 0) + 1;
      total += 1;
    }
  }
  return { byFile, total, filesLinted: linted.size, linted, fatals };
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

function totalsByBucket(keyCounts) {
  const totals = {};
  for (const [key, n] of Object.entries(keyCounts)) {
    const bucket = bucketOf(key);
    totals[bucket] = (totals[bucket] ?? 0) + n;
  }
  return totals;
}

/**
 * Compare one target's current problems against its baseline.
 *
 * WHAT COUNTS AS A REGRESSION
 * ---------------------------
 * Problems are tracked per (file, severity, rule, message) WITH A COUNT.
 * Tracking counts rather than a bare total is what stops the classic defeat of
 * a count-only baseline: fix one problem, introduce a different one, total
 * unchanged, gate green. Here the fixed one shows up as an improvement and the
 * new one as a regression, even though the total never moved.
 *
 * A regression is raised when the number of problems for a given
 * (severity, rule) in a given file EXCEEDS the baseline. The specific new
 * message keys are then reported so the developer sees what to fix.
 *
 * WHY THE ARBITRATION IS AT (file, severity, rule) AND NOT ON THE MESSAGE
 * ----------------------------------------------------------------------
 * Rule authors reword messages between releases, and several rules interpolate
 * identifiers that a rename changes. Failing on that is crying wolf, and a
 * gate that cries wolf gets bypassed. A genuinely NEW problem necessarily
 * raises the (file, severity, rule) count and is caught.
 *
 * KNOWN RESIDUAL (stated rather than hidden): fixing one violation of a rule
 * and introducing a different violation of the SAME rule in the SAME file
 * leaves the count unchanged and is reported as churn rather than failure.
 * Narrowing this further would require line numbers, which churn on every
 * unrelated edit.
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
  let newProblems = 0;
  let fixedProblems = 0;

  for (const file of new Set([...Object.keys(base), ...Object.keys(cur)])) {
    const b = base[file] ?? {};
    const c = cur[file] ?? {};
    const bt = totalsByBucket(b);
    const ct = totalsByBucket(c);

    for (const bucket of new Set([...Object.keys(bt), ...Object.keys(ct)])) {
      const before = bt[bucket] ?? 0;
      const after = ct[bucket] ?? 0;
      const appeared = Object.entries(c)
        .filter(([key, n]) => bucketOf(key) === bucket && n > (b[key] ?? 0))
        .map(([key, n]) => ({ file, key, before: b[key] ?? 0, after: n }));

      if (after > before) {
        newProblems += after - before;
        regressions.push(...appeared);
      } else {
        if (after < before) {
          fixedProblems += before - after;
          improvements.push({ file, bucket, before, after });
        }
        churn.push(...appeared);
      }
    }
  }

  const byFileThenKey = (a, b) =>
    a.file.localeCompare(b.file) ||
    (a.key ?? a.bucket).localeCompare(b.key ?? b.bucket);
  regressions.sort(byFileThenKey);
  improvements.sort(byFileThenKey);
  churn.sort(byFileThenKey);
  return { regressions, improvements, churn, newProblems, fixedProblems };
}

/* ------------------------------------------------------------------ */
/* collection                                                         */
/* ------------------------------------------------------------------ */

function collect(targets) {
  /** @type {Record<string, ReturnType<typeof collectResults>>} */
  const out = {};
  for (const target of targets) {
    const collected = collectResults(runEslint(target));
    // A file ESLint could not PARSE was not linted at all. Baselining that
    // would bless a permanent blind spot inside a tree the gate claims to
    // cover, so it is an infrastructure failure, not debt.
    if (collected.fatals.length > 0) {
      bail(
        `${collected.fatals.length} file(s) failed to parse in ${target.name} ` +
          '— they are not being linted at all',
        collected.fatals
          .map(f => `  ${f.file}:${f.line ?? '?'}  ${f.message}`)
          .join('\n')
      );
    }
    out[target.name] = { ...collected, byFile: sortDeep(collected.byFile) };
  }
  return out;
}

/**
 * SECOND vacuous-gate guard. The `results.length === 0` check catches a total
 * collapse; this catches a partial one. Every file that carries a baselined
 * problem and STILL EXISTS on disk must appear in the current lint run. If it
 * does not, the tree stopped being linted where it used to be — an `ignores`
 * entry, a moved directory, an `--ext` change — and its problems would
 * otherwise be silently counted as "fixed".
 */
function assertScopeDidNotShrink(targetName, baselineByFile, linted) {
  const missing = Object.keys(baselineByFile ?? {}).filter(
    file => existsSync(resolve(REPO_ROOT, file)) && !linted.has(file)
  );
  if (missing.length > 0) {
    bail(
      `${missing.length} file(s) with baselined problems in ${targetName} ` +
        'still exist but are no longer linted — the lint scope shrank',
      missing.map(f => `  ${f}`).join('\n')
    );
  }
}

/* ------------------------------------------------------------------ */
/* baseline I/O                                                       */
/* ------------------------------------------------------------------ */

function eslintVersion(target) {
  const res = spawnSync(eslintBinFor(target), ['--version'], {
    cwd: resolve(REPO_ROOT, target.dir),
    encoding: 'utf8',
  });
  return (res.stdout || '').trim().replace(/^v/, '');
}

function writeBaseline(results, carryOver = {}) {
  const targets = { ...carryOver };
  for (const [name, r] of Object.entries(results)) {
    targets[name] = { filesLinted: r.filesLinted, files: r.byFile };
  }
  const countOf = byFile =>
    Object.values(byFile)
      .flatMap(keys => Object.values(keys))
      .reduce((a, b) => a + b, 0);
  const totals = {};
  let all = 0;
  for (const [name, t] of Object.entries(targets)) {
    totals[name] = countOf(t.files);
    all += totals[name];
  }
  const doc = {
    _comment:
      'Committed baseline of PRE-EXISTING ESLint problems in backend/src. ' +
      'The gate (scripts/eslint-baseline.mjs, run by `npm run lint:backend` ' +
      'and by `make ci`) fails on any problem not listed here. Problems are ' +
      'keyed by file + severity + rule + normalised message (NOT line number, ' +
      'which churns on every unrelated edit) and stored with a count, so ' +
      'fixing one problem and introducing another cannot cancel out. Warnings ' +
      'are gated as well as errors. Every line below is a problem someone ' +
      'chose to accept; the file shrinking over time is the point.',
    _regenerateWith: UPDATE_CMD,
    _selfTest: SELF_TEST_CMD,
    _doNotEditByHand: true,
    eslintVersion: eslintVersion(
      TARGETS.find(t => t.name === Object.keys(results)[0]) ?? TARGETS[0]
    ),
    totals: { ...totals, all },
    targets,
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

function printRegressions(perTarget) {
  const total = Object.values(perTarget).reduce((n, d) => n + d.newProblems, 0);
  process.stderr.write(
    `\n${C.red(
      C.bold(`x ESLint gate: ${total} new problem(s) not in the baseline.`)
    )}\n\n`
  );
  for (const [name, d] of Object.entries(perTarget)) {
    if (d.regressions.length === 0) continue;
    process.stderr.write(`  ${C.bold(name)}\n`);
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
      `These problems are not in ${BASELINE_REL}, so this working tree ` +
        'introduced them.'
    )}\n` +
      'Fix them. Do not add `eslint-disable` to silence them.\n\n' +
      'If you are DELIBERATELY accepting them (e.g. a staged refactor),\n' +
      'regenerate the baseline:\n\n' +
      `    ${C.bold(UPDATE_CMD)}\n\n` +
      `${BASELINE_REL} is committed, so accepted problems show up as added ` +
      'lines\nin code review rather than vanishing silently.\n'
  );
}

/* ------------------------------------------------------------------ */
/* modes                                                              */
/* ------------------------------------------------------------------ */

function modeUpdate(targets, filtered) {
  process.stdout.write(
    `Regenerating ${BASELINE_REL} from ${targets.map(t => t.name).join(', ')} ...\n`
  );
  const carryOver = {};
  if (filtered && existsSync(BASELINE_PATH)) {
    const names = new Set(targets.map(t => t.name));
    for (const [name, t] of Object.entries(readBaseline().targets ?? {})) {
      if (!names.has(name)) carryOver[name] = t;
    }
    const kept = Object.keys(carryOver);
    if (kept.length > 0) {
      process.stdout.write(
        `  (keeping existing entries for ${kept.join(', ')})\n`
      );
    }
  }
  const results = collect(targets);
  const doc = writeBaseline(results, carryOver);
  for (const [name, r] of Object.entries(results)) {
    process.stdout.write(
      `  ${name}: ${r.total} problem(s) across ${r.filesLinted} linted file(s)\n`
    );
  }
  process.stdout.write(
    `${C.green('OK')} wrote ${BASELINE_REL} (${doc.totals.all} baselined ` +
      `problem(s), eslint ${doc.eslintVersion})\n` +
      `${C.yellow(
        'Review the diff before committing — every added line is a problem ' +
          'you are accepting.'
      )}\n`
  );
  return 0;
}

function modeCheck(targets) {
  const baseline = readBaseline();
  const results = collect(targets);

  const perTarget = {};
  let anyRegression = false;
  let fixed = 0;
  const churn = [];
  const shrunk = [];
  for (const target of targets) {
    const based = baseline.targets?.[target.name] ?? {};
    const cur = results[target.name];
    assertScopeDidNotShrink(target.name, based.files, cur.linted);
    if (
      typeof based.filesLinted === 'number' &&
      cur.filesLinted < based.filesLinted
    ) {
      shrunk.push({
        name: target.name,
        before: based.filesLinted,
        after: cur.filesLinted,
      });
    }
    const d = diffCounts(based.files, cur.byFile);
    perTarget[target.name] = d;
    if (d.regressions.length > 0) anyRegression = true;
    fixed += d.fixedProblems;
    churn.push(...d.churn.map(c => ({ ...c, target: target.name })));
  }

  if (anyRegression) {
    printRegressions(perTarget);
    return 1;
  }

  const totalNow = targets.reduce((n, t) => n + results[t.name].total, 0);
  const filesNow = targets.reduce((n, t) => n + results[t.name].filesLinted, 0);
  process.stdout.write(
    `${C.green('OK')} ESLint gate: no new problems. ${totalNow} baselined ` +
      `problem(s) across ${filesNow} linted file(s).\n`
  );
  if (fixed > 0) {
    process.stdout.write(
      `${C.green('->')} ${fixed} baselined problem(s) are now fixed. ` +
        `Lock it in:  ${C.bold(UPDATE_CMD)}\n`
    );
  }
  for (const s of shrunk) {
    // Not a failure on its own: files get deleted. assertScopeDidNotShrink
    // already failed the run if a file with baselined problems is still on
    // disk but no longer linted, so what is left here is deletions — worth
    // saying out loud so a shrinking lint surface is never silent.
    process.stdout.write(
      `${C.yellow('!')} ${s.name}: ${s.before - s.after} fewer file(s) linted ` +
        `than the baseline records (${s.before} -> ${s.after}).\n`
    );
  }
  if (churn.length > 0) {
    // Not a failure: the number of problems for this rule in this file did not
    // grow, only the message text changed (a rule reworded, an identifier
    // renamed). Surfaced anyway so it never rots silently.
    process.stdout.write(
      `${C.yellow('!')} ${churn.length} baselined problem(s) changed message ` +
        'text without changing in number (rule wording / identifier drift, ' +
        `not a new problem). Refresh with:  ${C.bold(UPDATE_CMD)}\n`
    );
    for (const c of churn.slice(0, 10)) {
      process.stdout.write(`    ${C.dim(`${c.target} ${c.file}`)}\n`);
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
    'backend/src/a.ts': { "error curly: Expected { after 'if' condition": 2 },
    'backend/src/b.ts': {
      'error @typescript-eslint/no-explicit-any: Unexpected any.': 1,
    },
  };

  assert(
    diffCounts(base, base).regressions.length === 0,
    'identical input -> no regression'
  );

  assert(
    diffCounts(base, {
      ...base,
      'backend/src/c.ts': {
        'error eqeqeq: Expected === and instead saw ==.': 1,
      },
    }).regressions.length === 1,
    'a brand-new problem in a new file -> regression'
  );

  assert(
    diffCounts(base, {
      ...base,
      'backend/src/a.ts': { "error curly: Expected { after 'if' condition": 3 },
    }).regressions.length === 1,
    'an existing key occurring MORE often -> regression'
  );

  // The failure mode a naive count-only baseline cannot see: the total stays
  // at 3, but one problem was fixed and a different one introduced.
  const swapped = {
    'backend/src/a.ts': { "error curly: Expected { after 'if' condition": 1 },
    'backend/src/b.ts': {
      'error @typescript-eslint/no-explicit-any: Unexpected any.': 1,
      'error no-console: Unexpected console statement.': 1,
    },
  };
  const totalOf = m =>
    Object.values(m)
      .flatMap(k => Object.values(k))
      .reduce((a, b) => a + b, 0);
  const swapDiff = diffCounts(base, swapped);
  assert(
    totalOf(base) === totalOf(swapped) && swapDiff.regressions.length === 1,
    'same TOTAL problem count but a different problem -> still a regression ' +
      '(a naive count-only baseline would pass this)'
  );

  assert(
    diffCounts(base, {
      ...base,
      'backend/src/b.ts': {
        'error @typescript-eslint/no-explicit-any: Unexpected any.': 1,
        'error @typescript-eslint/no-explicit-any: Unexpected any. Specify a different type.': 1,
      },
    }).regressions.length === 1,
    'an ADDITIONAL violation of an already-baselined rule in the same file ' +
      '-> regression'
  );

  // Severity is part of the bucket, so an error is never absorbed by a
  // baselined warning of the same rule.
  const anyWarn =
    'warning @typescript-eslint/no-explicit-any: Unexpected any. Specify a different type.';
  const anyErr =
    'error @typescript-eslint/no-explicit-any: Unexpected any. Specify a different type.';
  assert(
    diffCounts(
      { 'backend/src/d.ts': { [anyWarn]: 1 } },
      { 'backend/src/d.ts': { [anyWarn]: 1, [anyErr]: 1 } }
    ).regressions.length === 1,
    'an error is not absorbed by a baselined warning of the same rule'
  );

  const fixed = {
    'backend/src/b.ts': {
      'error @typescript-eslint/no-explicit-any: Unexpected any.': 1,
    },
  };
  const fixDiff = diffCounts(base, fixed);
  assert(
    fixDiff.regressions.length === 0 &&
      fixDiff.improvements.length === 1 &&
      fixDiff.fixedProblems === 2,
    'fixing baselined problems -> no regression, reported as improvement'
  );

  const drifted = {
    ...base,
    'backend/src/b.ts': {
      'error @typescript-eslint/no-explicit-any: Unexpected any (reworded).': 1,
    },
  };
  const driftDiff = diffCounts(base, drifted);
  assert(
    driftDiff.regressions.length === 0 && driftDiff.churn.length === 1,
    'same (file, severity, rule) count but different message text -> churn, ' +
      'not a failure (a gate that cries wolf gets bypassed)'
  );

  process.stdout.write('Unit: collectResults()\n');
  const parsed = collectResults([
    {
      filePath: resolve(REPO_ROOT, 'backend/src/x.ts'),
      messages: [
        {
          ruleId: 'curly',
          severity: 2,
          message: "Expected { after 'if'",
          line: 1,
        },
        {
          ruleId: 'curly',
          severity: 2,
          message: "Expected { after 'if'",
          line: 99,
        },
        {
          ruleId: 'curly',
          severity: 1,
          message: "Expected { after 'if'",
          line: 5,
        },
        {
          ruleId: null,
          severity: 1,
          message: 'Unused eslint-disable directive',
          line: 2,
        },
      ],
    },
    { filePath: resolve(REPO_ROOT, 'backend/src/clean.ts'), messages: [] },
  ]);
  assert(parsed.total === 4, 'every message is counted');
  assert(
    parsed.filesLinted === 2,
    'files with zero problems still count as linted (that is what makes the ' +
      'scope-shrink guard possible)'
  );
  assert(
    parsed.byFile['backend/src/x.ts']["error curly: Expected { after 'if'"] ===
      2,
    'the same problem at two DIFFERENT lines collapses to one key with ' +
      'count 2 (line-number churn cannot move it)'
  );
  assert(
    parsed.byFile['backend/src/x.ts'][
      "warning curly: Expected { after 'if'"
    ] === 1,
    'the same rule at a different severity is a DIFFERENT key'
  );
  assert(
    parsed.byFile['backend/src/x.ts'][
      'warning (directive): Unused eslint-disable directive'
    ] === 1,
    'rule-less directive reports get a stable pseudo-rule'
  );

  const withFatal = collectResults([
    {
      filePath: resolve(REPO_ROOT, 'backend/src/broken.ts'),
      messages: [
        {
          ruleId: null,
          fatal: true,
          severity: 2,
          message: 'Parsing error',
          line: 1,
        },
      ],
    },
  ]);
  assert(
    withFatal.fatals.length === 1 && withFatal.total === 0,
    'a parse failure is reported separately and never becomes a baselinable ' +
      'problem (collect() turns it into exit 2)'
  );
}

/** End-to-end proof: the wired gate fails on a real new problem, passes clean. */
function endToEndTest() {
  const probeRel = 'backend/src/__eslint_gate_probe__.ts';
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
      '// Temporary probe written by `npm run lint:backend:self-test`.\n' +
        '// If you are seeing this file in a commit, the self-test crashed —\n' +
        '// delete it.\n' +
        'export const eslintGateProbe = (a: number, b: number) => a == b;\n',
      'utf8'
    );
    planted = runGate();
  } finally {
    rmSync(probeAbs, { force: true });
  }

  assert(
    planted.status === 1,
    `planted problem FAILS the gate (exit ${planted.status})`
  );
  const out = `${planted.stdout}${planted.stderr}`;
  assert(out.includes(probeRel), 'failure output names the offending file');
  assert(
    out.includes('eqeqeq'),
    'failure output names the rule — and eqeqeq specifically still bites on a ' +
      'non-null loose comparison after the `{ null: "ignore" }` relaxation'
  );
  assert(
    out.includes('@typescript-eslint/explicit-function-return-type'),
    'a second, unrelated rule is reported too'
  );
  assert(
    out.includes(UPDATE_CMD),
    `failure output states the regeneration command (${UPDATE_CMD})`
  );

  const restored = runGate();
  assert(
    restored.status === 0,
    `gate PASSES again once the problem is removed (exit ${restored.status})`
  );

  process.stdout.write(
    '\n--- captured gate output with the planted problem ---\n'
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
    'Usage: node scripts/eslint-baseline.mjs [options]\n\n' +
      '  (no options)   lint every target for real and fail on any problem\n' +
      `                 not already in ${BASELINE_REL}\n` +
      `  --update       REGENERATE ${BASELINE_REL} from the current tree\n` +
      `                 npm alias: ${UPDATE_CMD}\n` +
      '  --self-test    prove the gate fails on a newly-introduced problem\n' +
      `                 npm alias: ${SELF_TEST_CMD}\n` +
      '  --target=T     restrict to one target (repeatable)\n' +
      '  --help\n\n' +
      `Targets checked by default: ${TARGETS.map(t => t.name).join(', ')}\n`
  );
  return 0;
}

function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return help();

  const selected = argv
    .filter(a => a.startsWith('--target='))
    .map(a => a.slice('--target='.length));
  const targets =
    selected.length > 0
      ? TARGETS.filter(t => selected.includes(t.name))
      : TARGETS;
  if (targets.length === 0) {
    bail(
      `no target matches ${selected.join(', ')}. ` +
        `Known targets: ${TARGETS.map(t => t.name).join(', ')}`
    );
  }

  if (argv.includes('--self-test')) return modeSelfTest();
  if (argv.includes('--update'))
    return modeUpdate(targets, selected.length > 0);
  return modeCheck(targets);
}

if (
  resolve(process.argv[1] ?? '') === resolve(fileURLToPath(import.meta.url))
) {
  process.exit(main(process.argv.slice(2)));
}
