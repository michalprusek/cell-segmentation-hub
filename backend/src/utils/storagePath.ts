import path from 'path';

/**
 * Thrown when a value that is about to be used as a storage path component
 * fails validation. Distinct error type so callers (and tests) can assert on
 * the failure mode rather than matching message text.
 */
export class UnsafeStorageSegmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeStorageSegmentError';
  }
}

/**
 * Assert that ``segment`` is safe to use as a SINGLE path component when
 * building a storage path with ``path.join`` / ``path.posix.join``, and
 * return it unchanged so callers can inline the check:
 *
 * ```ts
 * path.join(base, assertSafeStorageSegment(containerId, 'containerId'));
 * ```
 *
 * A storage segment is a leaf name — a UUID, a zero-padded index, a channel
 * name, ``frames``, ``original.tif`` — that must never span directories. The
 * multi-position ND2 upload path builds filesystem paths from values that
 * originate (transitively) in the request, so a crafted source file or
 * malformed metadata could otherwise smuggle ``../`` into a path and escape
 * the project's upload directory. This guard makes that impossible at the
 * point of use.
 *
 * Rejected: empty strings, NUL bytes, the directory references ``.`` and
 * ``..``, absolute paths, and anything containing a POSIX (``/``) or Windows
 * (``\``) separator. Both separators are checked regardless of host OS so the
 * guard stays correct on every deploy target. Server-generated UUIDs,
 * ``pos_%04d`` indices and ordinary channel names all pass untouched.
 *
 * @throws {UnsafeStorageSegmentError} if ``segment`` could escape its parent.
 */
export function assertSafeStorageSegment(
  segment: string,
  label = 'path segment'
): string {
  if (typeof segment !== 'string' || segment.length === 0) {
    throw new UnsafeStorageSegmentError(`${label} must be a non-empty string`);
  }
  // NUL truncates paths in many syscalls — never valid in a storage segment.
  if (segment.includes('\0')) {
    throw new UnsafeStorageSegmentError(`${label} contains a NUL byte`);
  }
  // '.' / '..' are directory references: '..' escapes upward, '.' is a no-op
  // that signals corrupt input. Neither is ever a legitimate leaf name.
  if (segment === '.' || segment === '..') {
    throw new UnsafeStorageSegmentError(
      `${label} is a directory reference ("${segment}")`
    );
  }
  // A single component must not span directories. Reject both separators (not
  // just the host's) and absolute paths. With no separator present, an
  // embedded ".." (e.g. "a..b") cannot traverse, so substring checks aren't
  // needed beyond the exact "." / ".." cases handled above.
  if (
    segment.includes('/') ||
    segment.includes('\\') ||
    path.isAbsolute(segment)
  ) {
    throw new UnsafeStorageSegmentError(
      `${label} must be a single path component, got "${segment}"`
    );
  }
  return segment;
}
