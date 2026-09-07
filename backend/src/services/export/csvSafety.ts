/**
 * The one place a CSV cell is made safe to open in a spreadsheet.
 *
 * Excel, LibreOffice and Google Sheets EVALUATE a cell whose first character is
 * `=`, `+`, `-` or `@`, and they strip a leading tab or CR before deciding — so
 * `\t=1+1` runs too. A value that reaches a sheet from user-controlled text is
 * therefore a formula, not a string.
 *
 * Reachable in this project, not theoretical: every metrics export writes an
 * image or frame NAME into a column, and that name is the filename the uploader
 * chose. Projects can be SHARED, so the person who named the file and the
 * person who opens the sheet are not necessarily the same person.
 *
 * The mitigation is a leading apostrophe — every spreadsheet reads the rest as
 * text and hides the quote. The cost is a visible `'` in a plain-text reader
 * for a legitimate name starting with `-` (`-control.tif` is plausible), which
 * is preferred to dropping or rewriting the character: that would lose which
 * frame a row came from, and a metrics row whose provenance is unreadable is
 * worse than one with a stray quote.
 *
 * Call this BEFORE quoting the cell. After quoting, the apostrophe would land
 * outside the quotes and be read as part of the previous field.
 */

/** Leading characters that make a spreadsheet treat the cell as a formula. */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

export function neutraliseCsvFormula(text: string): string {
  return FORMULA_LEAD.test(text) ? `'${text}` : text;
}
