/**
 * A `Content-Disposition` value that Node will actually accept.
 *
 * Node's `setHeader` throws `ERR_INVALID_CHAR` for any header value containing a
 * code point above U+00FF, so interpolating a filename straight in turns the
 * whole response into a 500. That is not hypothetical: 784 production images
 * carry such a name — the multi-position ND2 split joins its parts with an em
 * dash (U+2014), so `GET /images/:id/display` failed for every frame of every
 * multi-position container, and the browser showed a broken image with a 500 in
 * the console.
 *
 * Stripping the offending characters would work but throws the real name away,
 * which is the one thing the header is for. RFC 6266 already solves this: send a
 * plain ASCII `filename` for anything that cannot read the extended form, and a
 * percent-encoded UTF-8 `filename*` beside it, which every current browser
 * prefers.
 */

/** Characters a quoted-string `filename` may not contain, plus anything
 *  non-ASCII, replaced by `_` in the fallback. Control characters are excluded
 *  because they terminate or forge headers, `"` and `\` because they escape the
 *  quoted string. */
const UNSAFE_IN_QUOTED_ASCII = /[^\x20-\x7E]|["\\]/g;

export type DispositionType = 'inline' | 'attachment';

/**
 * Build the header value.
 *
 * @param type     `inline` to display in place, `attachment` to download.
 * @param filename The real filename, in any encoding the database holds.
 */
export function contentDisposition(
  type: DispositionType,
  filename: string
): string {
  const ascii = filename.replace(UNSAFE_IN_QUOTED_ASCII, '_');
  // An all-unrepresentable name (e.g. entirely CJK) would collapse to a row of
  // underscores, which is useless as a save-dialog default; give those a name
  // that at least says what it is. The `filename*` below still carries the real
  // one for anything that can read it.
  const fallback = /[^_.\s]/.test(ascii) ? ascii : 'download';
  // encodeURIComponent leaves !'()* alone; RFC 5987's attr-char excludes them,
  // so percent-encode those too rather than emit a value a strict parser rejects.
  const encoded = encodeURIComponent(filename).replace(
    /['()!*]/g,
    c => '%' + c.charCodeAt(0).toString(16).toUpperCase()
  );
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
