#!/usr/bin/env node
/**
 * Documentation link checker.
 *
 * Walks every Markdown file under `docs/` plus the repository-root Markdown
 * files and verifies that each *relative* link target resolves on disk.
 * External links (http/https/mailto) and pure in-page anchors (`#section`)
 * are skipped — this checker is about links that rot when a file is renamed
 * or deleted, which is the failure mode the docs tree actually suffers from.
 *
 * Usage:
 *   node scripts/check-doc-links.cjs           # check, exit 1 on any dead link
 *   node scripts/check-doc-links.cjs --list    # also list every checked link
 *
 * Wired into `make ci` via the `docs-links` target.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOTS = ['docs', 'README.md'];
/** Directories never worth walking. */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
]);

/** Collect every Markdown file under the configured roots. */
function collectMarkdown(relRoot) {
  const abs = path.join(REPO_ROOT, relRoot);
  if (!fs.existsSync(abs)) return [];
  if (fs.statSync(abs).isFile()) {
    return abs.endsWith('.md') ? [abs] : [];
  }
  const out = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...collectMarkdown(path.join(relRoot, entry.name)));
    } else if (entry.name.endsWith('.md')) {
      out.push(path.join(abs, entry.name));
    }
  }
  return out;
}

/**
 * Extract link targets from Markdown.
 *
 * Handles inline links `[text](target)` and reference definitions
 * `[label]: target`. Fenced code blocks are stripped first so that example
 * Markdown inside a ``` block is not treated as a real link.
 */
function extractLinks(markdown) {
  const withoutFences = markdown.replace(/```[\s\S]*?```/g, '');
  const links = [];
  const inline = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let match;
  while ((match = inline.exec(withoutFences)) !== null) {
    links.push(match[1]);
  }
  const reference = /^\s*\[[^\]]+\]:\s*(\S+)/gm;
  while ((match = reference.exec(withoutFences)) !== null) {
    links.push(match[1]);
  }
  return links;
}

/** True for targets this checker deliberately does not resolve. */
function isSkippable(target) {
  return (
    target.startsWith('#') ||
    /^[a-z][a-z0-9+.-]*:/i.test(target) || // http:, https:, mailto:, tel:, ...
    target.startsWith('//')
  );
}

function main() {
  const verbose = process.argv.includes('--list');
  const files = ROOTS.flatMap(collectMarkdown).sort();
  const dead = [];
  let checked = 0;

  for (const file of files) {
    const markdown = fs.readFileSync(file, 'utf8');
    for (const rawTarget of extractLinks(markdown)) {
      if (isSkippable(rawTarget)) continue;
      // Drop any in-page anchor; only the file part is resolved on disk.
      const target = rawTarget.split('#')[0];
      if (target === '') continue;
      checked += 1;
      // A root-absolute target (`/docs/x.md`) is resolved from the repository
      // root, not from `/` — docs are read from a checkout, not a web server.
      const base = target.startsWith('/') ? REPO_ROOT : path.dirname(file);
      const resolved = path.resolve(
        base,
        `.${path.sep}`,
        decodeURI(target).replace(/^\//, '')
      );
      const exists = fs.existsSync(resolved);
      if (verbose) {
        const rel = path.relative(REPO_ROOT, file);
        console.log(`${exists ? 'ok  ' : 'DEAD'} ${rel} -> ${rawTarget}`);
      }
      if (!exists) {
        dead.push({ file: path.relative(REPO_ROOT, file), target: rawTarget });
      }
    }
  }

  console.log(
    `Checked ${checked} relative link(s) across ${files.length} Markdown file(s).`
  );

  if (dead.length > 0) {
    console.error(`\n${dead.length} dead link(s):`);
    for (const { file, target } of dead) {
      console.error(`  ${file} -> ${target}`);
    }
    process.exit(1);
  }

  console.log('No dead links.');
}

main();
