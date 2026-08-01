/**
 * folderNameFromFiles — the run's name must survive BOTH ways of choosing a
 * folder.
 *
 * Reported 2026-07-31: every Automated Essays run was named `essays_<date>`
 * instead of the uploaded folder, losing the acquisition identifier the user
 * encodes there. The helper read only `webkitRelativePath`, which the native
 * folder picker sets and a dragged folder does not — react-dropzone's
 * file-selector puts the entry's `fullPath` on `path` instead. Both real shapes
 * are pinned below, taken from the library's own `toFileWithPath()`
 * (node_modules/file-selector/dist/es5/file.js).
 *
 * Not tested here: that the name reaches the request body. That path
 * (`folderName: folderNameFromFiles(staged)` -> FormData -> essay_jobs.name)
 * was never broken — the whole defect lived inside this function.
 */

import { describe, it, expect } from 'vitest';
import { folderNameFromFiles } from '../folderName';

type PathedFile = File & { webkitRelativePath?: string; path?: string };

/** A File as the browser/file-selector hands it over, per source. */
const fileWith = (
  name: string,
  props: { webkitRelativePath?: string; path?: string }
): PathedFile => {
  const f = new File(['x'], name) as PathedFile;
  // Both are read-only accessors on a real File; define them the way
  // file-selector does rather than assigning.
  Object.defineProperty(f, 'webkitRelativePath', {
    value: props.webkitRelativePath ?? '',
    enumerable: true,
  });
  if (props.path !== undefined) {
    Object.defineProperty(f, 'path', { value: props.path, enumerable: true });
  }
  return f;
};

describe('folderNameFromFiles', () => {
  it('reads the folder from a native folder picker (webkitRelativePath)', () => {
    const files = [
      fileWith('WellA01.nd2', {
        webkitRelativePath: '20260731_1423_acquisition/WellA01.nd2',
      }),
    ];
    expect(folderNameFromFiles(files)).toBe('20260731_1423_acquisition');
  });

  it('reads the folder from a dragged folder (path, with leading slash)', () => {
    // file-selector sets `path` to the FileSystemEntry fullPath and leaves
    // webkitRelativePath empty. This is the case that regressed.
    const files = [
      fileWith('WellA01.nd2', {
        path: '/20260731_1423_acquisition/WellA01.nd2',
      }),
    ];
    expect(folderNameFromFiles(files)).toBe('20260731_1423_acquisition');
  });

  it('takes the top-level folder when the drop was nested', () => {
    const files = [
      fileWith('WellA01.nd2', {
        path: '/20260731_1423_acquisition/plate1/WellA01.nd2',
      }),
    ];
    expect(folderNameFromFiles(files)).toBe('20260731_1423_acquisition');
  });

  it('prefers webkitRelativePath when both are present', () => {
    // In production both properties agree (file-selector copies
    // webkitRelativePath into `path` for picker-sourced files), so the two are
    // given DIFFERENT folders here on purpose — otherwise the assertion holds
    // whichever property is read and pins nothing.
    const files = [
      fileWith('WellA01.nd2', {
        webkitRelativePath: 'run_from_picker/WellA01.nd2',
        path: '/run_from_drop/WellA01.nd2',
      }),
    ];
    expect(folderNameFromFiles(files)).toBe('run_from_picker');
  });

  it('returns undefined for loose files, so the caller keeps its fallback', () => {
    // Dragging bare files (no folder): file-selector degrades `path` to the
    // file name. Returning "WellA01.nd2" as the run name would be worse than
    // the essays_<date> fallback.
    expect(
      folderNameFromFiles([fileWith('WellA01.nd2', { path: 'WellA01.nd2' })])
    ).toBeUndefined();
    expect(folderNameFromFiles([fileWith('WellA01.nd2', {})])).toBeUndefined();
  });

  it('returns undefined for an empty selection', () => {
    expect(folderNameFromFiles([])).toBeUndefined();
  });
});
