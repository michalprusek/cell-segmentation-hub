/**
 * Recovering the uploaded folder's name from the files the dropzone yielded.
 *
 * Lives beside EssaysDropzone because it is entirely about that component's two
 * input paths: the same folder arrives with its relative path on a DIFFERENT
 * property depending on how the user chose it, and reading only one of them
 * silently dropped every dragged folder's name (all three of the reporting
 * user's runs fell back to `essays_<date>`, 2026-07).
 */

/** A File as the browser and react-dropzone's file-selector hand it over. */
type FileWithPath = File & {
  /** Set by a `webkitdirectory` input: `"Run/A01.nd2"`. */
  webkitRelativePath?: string;
  /**
   * Set by file-selector on every dropped file (see its `toFileWithPath`):
   * the FileSystemEntry `fullPath` for a dragged folder (`"/Run/A01.nd2"`,
   * leading slash included), otherwise a copy of `webkitRelativePath`, and for
   * a loose dropped file it degrades to the bare file name.
   */
  path?: string;
};

/**
 * Top-level folder the selection came from, or `undefined` when there isn't
 * one — so the caller can fall back rather than name a run after a single file.
 */
export const folderNameFromFiles = (files: File[]): string | undefined => {
  const first = files[0] as FileWithPath | undefined;
  const rel = first?.webkitRelativePath || first?.path;
  if (!rel) return undefined;
  const segments = rel.split('/').filter(Boolean);
  return segments.length > 1 ? segments[0] : undefined;
};
