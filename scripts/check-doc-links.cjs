#!/usr/bin/env node
/**
 * Documentation link checker.
 *
 * Walks every Markdown file under `docs/` plus the repository-root Markdown
 * files (README.md and CLAUDE.md — the latter carries its own index into
 * `docs/` and is the file most likely to rot when a page is renamed) and
 * verifies that each *relative* link resolves:
 *
 *   - the file part must exist on disk;
 *   - an `#anchor` into a Markdown file must match a heading in that file.
 *
 * External links (http/https/mailto) are skipped. Anchors are checked because
 * a heading containing an em dash slugs to a *double* hyphen, which is easy to
 * get wrong by hand and silently produces a link that jumps nowhere.
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
const ROOTS = ['docs', 'README.md', 'CLAUDE.md'];
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

/** Strip fenced code blocks so example Markdown is not treated as real links. */
function stripFences(markdown) {
  return markdown.replace(/```[\s\S]*?```/g, '');
}

/**
 * Extract link targets from Markdown.
 *
 * Handles inline links `[text](target)` and reference definitions
 * `[label]: target`.
 */
function extractLinks(markdown) {
  const withoutFences = stripFences(markdown);
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

/**
 * GitHub's heading-to-anchor rule: lowercase, strip anything that is not a
 * word character, space or hyphen, then turn spaces into hyphens.
 *
 * The consequence worth knowing: an em dash is *stripped* rather than replaced,
 * so `## Caveats — read this` leaves two spaces and slugs to
 * `caveats--read-this` with a DOUBLE hyphen.
 */
function slugify(headingText) {
  return (
    headingText
      .trim()
      .toLowerCase()
      .replace(/`/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links render as their text
      // Emphasis markers only. NOT `_`: it is a word character that GitHub
      // keeps, and stripping it mangles identifiers such as
      // `spheroid_disintegration` that legitimately appear in headings.
      .replace(/[*~]/g, '')
      .replace(/[^\w\s-]/g, '')
      .replace(/\s/g, '-')
  );
}

/** Every anchor a Markdown file offers: its headings, plus explicit anchors. */
function collectAnchors(absPath) {
  const markdown = stripFences(fs.readFileSync(absPath, 'utf8'));
  const anchors = new Set();
  const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/gm;
  let match;
  while ((match = heading.exec(markdown)) !== null) {
    anchors.add(slugify(match[1]));
  }
  // Explicit HTML anchors, e.g. <a id="x"> or <a name="x">.
  const explicit = /<a\s+(?:id|name)=["']([^"']+)["']/gi;
  while ((match = explicit.exec(markdown)) !== null) {
    anchors.add(match[1].toLowerCase());
  }
  return anchors;
}

/** True for targets this checker deliberately does not resolve. */
function isSkippable(target) {
  return (
    /^[a-z][a-z0-9+.-]*:/i.test(target) || // http:, https:, mailto:, tel:, ...
    target.startsWith('//')
  );
}

/**
 * Decode percent-escapes, tolerating a literal `%` that is not a valid escape.
 * `decodeURI` throws `URIError` on those, which would kill the whole gate with
 * a stack trace instead of reporting the link.
 */
function safeDecode(target) {
  try {
    return decodeURI(target);
  } catch {
    return target;
  }
}

function main() {
  const verbose = process.argv.includes('--list');
  const files = ROOTS.flatMap(collectMarkdown).sort();
  const anchorCache = new Map();
  const dead = [];
  let checked = 0;

  const anchorsFor = absPath => {
    if (!anchorCache.has(absPath)) {
      anchorCache.set(absPath, collectAnchors(absPath));
    }
    return anchorCache.get(absPath);
  };

  for (const file of files) {
    const markdown = fs.readFileSync(file, 'utf8');
    const rel = path.relative(REPO_ROOT, file);

    for (const rawTarget of extractLinks(markdown)) {
      if (isSkippable(rawTarget)) continue;

      const hashAt = rawTarget.indexOf('#');
      const filePart = hashAt === -1 ? rawTarget : rawTarget.slice(0, hashAt);
      const anchor = hashAt === -1 ? '' : rawTarget.slice(hashAt + 1);

      // A bare `#anchor` points at a heading in this same file.
      const targetFile = filePart === '' ? file : null;
      let resolved = targetFile;

      if (resolved === null) {
        // A root-absolute target (`/docs/x.md`) is resolved from the repository
        // root, not from `/` — docs are read from a checkout, not a web server.
        const base = filePart.startsWith('/') ? REPO_ROOT : path.dirname(file);
        resolved = path.resolve(
          base,
          `.${path.sep}`,
          safeDecode(filePart).replace(/^\//, '')
        );
      }

      checked += 1;
      let problem = null;

      if (!fs.existsSync(resolved)) {
        problem = 'file not found';
      } else if (anchor && resolved.endsWith('.md')) {
        const wanted = safeDecode(anchor).toLowerCase();
        if (!anchorsFor(resolved).has(wanted)) {
          problem = 'no such heading';
        }
      }

      if (verbose) {
        console.log(`${problem ? 'DEAD' : 'ok  '} ${rel} -> ${rawTarget}`);
      }
      if (problem) {
        dead.push({ file: rel, target: rawTarget, problem });
      }
    }
  }

  console.log(
    `Checked ${checked} relative link(s) across ${files.length} Markdown file(s).`
  );

  if (dead.length > 0) {
    console.error(`\n${dead.length} dead link(s):`);
    for (const { file, target, problem } of dead) {
      console.error(`  ${file} -> ${target}  (${problem})`);
    }
    process.exit(1);
  }

  console.log('No dead links.');
}

main();
