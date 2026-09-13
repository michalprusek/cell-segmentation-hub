#!/usr/bin/env node
/**
 * Regenerates the expected values for the editor's ImageJ histogram port by
 * running ImageJ's OWN Brightness & Contrast code on every case in
 * `src/lib/__tests__/fixtures/imagejHistogram/cases.mjs`.
 *
 *   node scripts/imagej-histogram-oracle/run.mjs
 *
 * Needs docker and network access, nothing else: the JDK comes from the
 * `eclipse-temurin` image and ImageJ from Maven Central, pinned below. The
 * output is `expected.json` next to `cases.mjs`; commit it with the change
 * that made it move, and say in that commit why ImageJ's numbers changed.
 *
 * WHY 1.54p. It is the release on Maven Central, so the URL is stable and the
 * fixture is reproducible. The daily build (1.54u8 when this was written)
 * differs in how the plot is PAINTED — LUT-coloured bars and a log option,
 * since 1.54q21 — but not in anything read here: the binning, the plot's
 * ceiling and Auto produced identical output from both jars on real
 * production frames.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AUTO_CLICKS,
  CASES,
  generateSamples,
} from '../../src/lib/__tests__/fixtures/imagejHistogram/cases.mjs';

const IJ_VERSION = '1.54p';
const JAR_URL = `https://repo1.maven.org/maven2/net/imagej/ij/${IJ_VERSION}/ij-${IJ_VERSION}.jar`;
const JDK_IMAGE = 'eclipse-temurin:21-jdk';

const here = path.dirname(fileURLToPath(import.meta.url));
const outFile = path.resolve(
  here,
  '../../src/lib/__tests__/fixtures/imagejHistogram/expected.json'
);

const work = mkdtempSync(path.join(tmpdir(), 'imagej-oracle-'));
const user = `${process.getuid()}:${process.getgid()}`;
const inJdk = args =>
  execFileSync(
    'docker',
    [
      'run',
      '--rm',
      '--user',
      user,
      '-v',
      `${work}:/w`,
      '-w',
      '/w',
      JDK_IMAGE,
      ...args,
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );

try {
  const res = await fetch(JAR_URL);
  if (!res.ok) throw new Error(`${JAR_URL}: HTTP ${res.status}`);
  writeFileSync(
    path.join(work, 'ij.jar'),
    Buffer.from(await res.arrayBuffer())
  );
  copyFileSync(
    path.join(here, 'HistogramOracle.java'),
    path.join(work, 'HistogramOracle.java')
  );
  inJdk([
    'javac',
    '-nowarn',
    '-cp',
    'ij.jar',
    '-d',
    'out',
    'HistogramOracle.java',
  ]);

  const expected = {
    imagejVersion: IJ_VERSION,
    generator: 'scripts/imagej-histogram-oracle/run.mjs',
    autoClicks: AUTO_CLICKS,
    cases: {},
  };

  for (const testCase of CASES) {
    const { data, min, max } = generateSamples(testCase);
    // Little-endian, whatever the host is: the oracle reads it that way.
    const bytes = Buffer.alloc(
      data.length * (testCase.bitDepth === 16 ? 2 : 1)
    );
    data.forEach((v, i) =>
      testCase.bitDepth === 16
        ? bytes.writeUInt16LE(v, i * 2)
        : bytes.writeUInt8(v, i)
    );
    const raw = `${testCase.name}.raw`;
    writeFileSync(path.join(work, raw), bytes);

    const axes = testCase.axes(min, max);
    const stdout = inJdk([
      'java',
      '-Djava.awt.headless=true',
      '-cp',
      'ij.jar:out',
      'ij.plugin.frame.HistogramOracle',
      raw,
      String(testCase.width),
      String(testCase.height),
      String(testCase.bitDepth),
      String(AUTO_CLICKS),
      ...axes.flat().map(String),
    ]);
    const result = JSON.parse(stdout);
    if (result.imagejVersion !== IJ_VERSION) {
      throw new Error(
        `ran ImageJ ${result.imagejVersion}, expected ${IJ_VERSION}`
      );
    }
    delete result.imagejVersion;
    expected.cases[testCase.name] = result;
    process.stdout.write(`${testCase.name} `);
  }

  writeFileSync(outFile, `${JSON.stringify(expected, null, 2)}\n`);
  execFileSync('npx', ['prettier', '--write', outFile], { stdio: 'inherit' });
  process.stdout.write(`\nwrote ${path.relative(process.cwd(), outFile)}\n`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
