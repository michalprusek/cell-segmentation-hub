import { describe, it, expect } from 'vitest';
import { deflateSync } from 'zlib';
import { readCellSensPixelSizeUm } from '../olympusCellSensScale';
import {
  cellSensJpeg,
  cellSensJson,
  cellSensTiff,
  omeXml,
  exifTiff,
  jpeg,
  makerNote,
  um,
} from '../../test/fixtures/cellSens';

const DIMS = { width: 4104, height: 2174 };

describe('readCellSensPixelSizeUm', () => {
  it('reads the DP28 40x calibration, without the binary noise cellSens writes', () => {
    expect(readCellSensPixelSizeUm(cellSensJpeg(), DIMS)).toEqual({
      pixelSizeUm: 0.08625,
    });
  });

  it('reads big-endian (MM) Exif the same way', () => {
    expect(
      readCellSensPixelSizeUm(cellSensJpeg(cellSensJson(), false), DIMS)
        .pixelSizeUm
    ).toBe(0.08625);
  });

  it('reads the second production geometry (3840x2160)', () => {
    const json = cellSensJson({ lengths: [3840, 2160] });
    expect(
      readCellSensPixelSizeUm(cellSensJpeg(json), { width: 3840, height: 2160 })
        .pixelSizeUm
    ).toBe(0.08625);
  });

  it('converts a self-describing non-µm unit', () => {
    const nm = um(172.5, '10^-9m^1');
    const json = cellSensJson({ sx: nm, sy: nm });
    expect(readCellSensPixelSizeUm(cellSensJpeg(json), DIMS).pixelSizeUm).toBe(
      0.1725
    );
  });

  // The guard that matters most: the calibration describes the pixel grid it
  // was written for. A resampled file keeps the MakerNote but not the grid.
  it('refuses a file resampled after cellSens wrote the scale', () => {
    expect(
      readCellSensPixelSizeUm(cellSensJpeg(), { width: 2052, height: 1087 })
    ).toEqual({ pixelSizeUm: null, reason: 'size-mismatch' });
    expect(
      readCellSensPixelSizeUm(cellSensJpeg(), { width: 4104, height: 2175 })
        .reason
    ).toBe('size-mismatch');
  });

  it('refuses when the decoded size is unknown', () => {
    expect(readCellSensPixelSizeUm(cellSensJpeg(), {}).reason).toBe(
      'size-mismatch'
    );
  });

  it('refuses a scale with no layer calibration to tie it to the pixels', () => {
    expect(
      readCellSensPixelSizeUm(cellSensJpeg(cellSensJson({ layer: [] })), DIMS)
        .reason
    ).toBe('no-calibration');
  });

  it('refuses when the layer calibration disagrees with the canvas scale', () => {
    const json = cellSensJson({ calScale: um(0.1725) });
    expect(readCellSensPixelSizeUm(cellSensJpeg(json), DIMS).reason).toBe(
      'no-calibration'
    );
  });

  it('refuses anisotropic pixels (the column is one isotropic value)', () => {
    const json = cellSensJson({ sx: um(0.08625), sy: um(0.09) });
    expect(readCellSensPixelSizeUm(cellSensJpeg(json), DIMS).reason).toBe(
      'anisotropic'
    );
  });

  it('refuses a unit it cannot read and a non-numeric value', () => {
    for (const q of [um(0.08625, 'px'), { unit: '10^-6m^1', value: '0.08' }]) {
      const json = cellSensJson({ sx: q, sy: q });
      expect(readCellSensPixelSizeUm(cellSensJpeg(json), DIMS).reason).toBe(
        'bad-unit'
      );
    }
  });

  it('refuses values outside the bounds the project setting accepts', () => {
    for (const v of [0, -0.08625, 0.0001, 5000]) {
      const json = cellSensJson({ sx: um(v), sy: um(v) });
      expect(readCellSensPixelSizeUm(cellSensJpeg(json), DIMS).reason).toBe(
        'out-of-range'
      );
    }
  });

  it('refuses another MakerNote version rather than guessing its layout', () => {
    const note = makerNote(cellSensJson(), { version: 3 });
    expect(readCellSensPixelSizeUm(jpeg(exifTiff(note)), DIMS).reason).toBe(
      'unsupported-version'
    );
  });

  it('refuses a corrupt or non-JSON payload', () => {
    const garbage = makerNote(Buffer.from('not zlib at all'));
    expect(readCellSensPixelSizeUm(jpeg(exifTiff(garbage)), DIMS).reason).toBe(
      'bad-payload'
    );
    const notJson = makerNote(deflateSync(Buffer.from('{oops')));
    expect(readCellSensPixelSizeUm(jpeg(exifTiff(notJson)), DIMS).reason).toBe(
      'bad-payload'
    );
  });

  it('ignores other makers and files without Exif', () => {
    const canon = Buffer.from('Canon\0\0\0 some maker data', 'latin1');
    expect(readCellSensPixelSizeUm(jpeg(exifTiff(canon)), DIMS).reason).toBe(
      'not-cellsens'
    );
    expect(readCellSensPixelSizeUm(jpeg(null), DIMS).reason).toBe('no-exif');
    expect(
      readCellSensPixelSizeUm(Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), DIMS)
        .reason
    ).toBe('unsupported-format');
  });

  // A byte search for "OLYXV" would accept both of these.
  it('reads the MakerNote tag only — not the same bytes in another tag or in the scan data', () => {
    const payload = makerNote(cellSensJson());
    // Same bytes, stored under UserComment (0x9286) instead of MakerNote.
    expect(
      readCellSensPixelSizeUm(jpeg(exifTiff(payload, true, 0x9286)), DIMS)
        .reason
    ).toBe('no-makernote');
    // Same bytes after the start of scan, with no Exif at all.
    expect(readCellSensPixelSizeUm(jpeg(null, payload), DIMS).reason).toBe(
      'no-exif'
    );
  });

  it('survives truncated and out-of-bounds Exif without throwing', () => {
    const tiff = exifTiff(makerNote(cellSensJson()));
    // MakerNote count pointing past the end of the block.
    const longCount = Buffer.from(tiff);
    longCount.writeUInt32LE(1_000_000, 32);
    expect(readCellSensPixelSizeUm(jpeg(longCount), DIMS).reason).toBe(
      'no-makernote'
    );
    // Exif IFD pointer past the end.
    const badPtr = Buffer.from(tiff);
    badPtr.writeUInt32LE(1_000_000, 18);
    expect(readCellSensPixelSizeUm(jpeg(badPtr), DIMS).reason).toBe(
      'no-makernote'
    );
    // Every truncation of a real-shaped file.
    const full = cellSensJpeg();
    for (let n = 0; n < full.length; n += 7) {
      expect(() =>
        readCellSensPixelSizeUm(full.subarray(0, n), DIMS)
      ).not.toThrow();
    }
  });
});

describe('readCellSensPixelSizeUm — cellSens XV TIFF', () => {
  const XV = { width: 2052, height: 1086 };

  it('reads the new-PC calibration (2052x1086, 0.1725 µm/px)', () => {
    expect(readCellSensPixelSizeUm(cellSensTiff(), XV)).toEqual({
      pixelSizeUm: 0.1725,
    });
  });

  it('reads big-endian TIFF (the SIS block itself is always little-endian)', () => {
    expect(
      readCellSensPixelSizeUm(cellSensTiff({ le: false }), XV).pixelSizeUm
    ).toBe(0.1725);
  });

  it('converts an OME pixel size written in nm (one real file has it)', () => {
    const description = omeXml({
      sizeX: 4104,
      sizeY: 2174,
      x: '86.250000000000057',
      unit: 'nm',
    });
    const buf = cellSensTiff({ description, sis: { xCal: 0.08625 } });
    expect(
      readCellSensPixelSizeUm(buf, { width: 4104, height: 2174 }).pixelSizeUm
    ).toBe(0.08625);
  });

  // tifffile reads the SIS tag's value field as the block's offset whatever
  // its declared type (`TiffTag.fromfile`, TAG_READERS), so a block declared
  // as UNDEFINED x its length must read the same as cellSens' LONG x1.
  it('finds the SIS block from the value field whatever the tag type', () => {
    expect(
      readCellSensPixelSizeUm(cellSensTiff({ sisTag: 'undefined-block' }), XV)
        .pixelSizeUm
    ).toBe(0.1725);
  });

  it('applies the SIS length exponent', () => {
    const buf = cellSensTiff({ sis: { xCal: 1.725e-7, lenExp: 0 } });
    expect(readCellSensPixelSizeUm(buf, XV).pixelSizeUm).toBe(0.1725);
  });

  it('accepts an unprefixed <Pixels> element and the Greek mu', () => {
    const description = omeXml({ unit: 'μm' }, { prefix: '' });
    expect(
      readCellSensPixelSizeUm(cellSensTiff({ description }), XV).pixelSizeUm
    ).toBe(0.1725);
  });

  // analySIS 5.0 writes the SIS block alone: 211 production files, nothing
  // tying the scale to the pixel grid.
  it('refuses a SIS block with no OME to check it against', () => {
    expect(
      readCellSensPixelSizeUm(cellSensTiff({ description: null }), XV).reason
    ).toBe('no-ome');
    expect(
      readCellSensPixelSizeUm(
        cellSensTiff({ description: 'analySIS image' }),
        XV
      ).reason
    ).toBe('no-ome');
  });

  it('refuses when SIS and OME disagree', () => {
    const buf = cellSensTiff({ sis: { xCal: 0.08625 } });
    expect(readCellSensPixelSizeUm(buf, XV).reason).toBe('sources-disagree');
  });

  it('refuses a file whose OME size is not the decoded size (resampled)', () => {
    expect(
      readCellSensPixelSizeUm(cellSensTiff(), { width: 1026, height: 543 })
        .reason
    ).toBe('size-mismatch');
    expect(readCellSensPixelSizeUm(cellSensTiff(), {}).reason).toBe(
      'size-mismatch'
    );
  });

  it('refuses an OME file describing several images', () => {
    const description = omeXml({}, { count: 2 });
    expect(
      readCellSensPixelSizeUm(cellSensTiff({ description }), XV).reason
    ).toBe('no-ome');
  });

  it('refuses an OME unit it cannot convert, and anisotropic pixels', () => {
    expect(
      readCellSensPixelSizeUm(
        cellSensTiff({ description: omeXml({ unit: 'pixel' }) }),
        XV
      ).reason
    ).toBe('bad-unit');
    expect(
      readCellSensPixelSizeUm(
        cellSensTiff({ description: omeXml({ y: '0.2' }) }),
        XV
      ).reason
    ).toBe('anisotropic');
    expect(
      readCellSensPixelSizeUm(cellSensTiff({ sis: { yCal: 0.2 } }), XV).reason
    ).toBe('anisotropic');
  });

  it('refuses values outside the accepted bounds', () => {
    const buf = cellSensTiff({
      description: omeXml({ x: '5000' }),
      sis: { xCal: 5000 },
    });
    expect(readCellSensPixelSizeUm(buf, XV).reason).toBe('out-of-range');
  });

  // OME alone (Bio-Formats exports) and the TIFF resolution tags are not
  // sources: 72 dpi would read as 352.8 µm/px, inside every bound.
  it('ignores TIFFs without the SIS block, whatever else they carry', () => {
    expect(
      readCellSensPixelSizeUm(
        cellSensTiff({
          sis: null,
          extraTags: [
            [282, 4, 1, 72],
            [296, 3, 1, 2],
          ],
        }),
        XV
      ).reason
    ).toBe('not-cellsens');
  });

  it('refuses a corrupt SIS block and BigTIFF', () => {
    const buf = cellSensTiff();
    const sisAt = buf.indexOf('SIS0', 0, 'latin1');
    const bad = Buffer.from(buf);
    bad.write('XXXX', sisAt, 'latin1');
    expect(readCellSensPixelSizeUm(bad, XV).reason).toBe('no-sis');
    expect(
      readCellSensPixelSizeUm(cellSensTiff({ magic: 43 }), XV).reason
    ).toBe('unsupported-format');
  });

  it('survives every truncation without throwing', () => {
    const full = cellSensTiff();
    for (let n = 0; n < full.length; n += 5) {
      expect(() =>
        readCellSensPixelSizeUm(full.subarray(0, n), XV)
      ).not.toThrow();
    }
  });
});

// CodeQL findings on the first version (2026-10-14): the description is the
// uploader's text. These assert the deterministic part — the bound, and that a
// hostile attribute name reaches no prototype — not a timing.
describe('readCellSensPixelSizeUm — hostile TIFF descriptions', () => {
  const XV = { width: 2052, height: 1086 };

  it('does not parse a description over the 64 KiB bound', () => {
    const description = omeXml() + ' '.repeat(64 * 1024);
    expect(
      readCellSensPixelSizeUm(cellSensTiff({ description }), XV).reason
    ).toBe('no-ome');
  });

  it('reads up to the first NUL only', () => {
    const description = omeXml() + '\0' + omeXml();
    expect(
      readCellSensPixelSizeUm(cellSensTiff({ description }), XV).pixelSizeUm
    ).toBe(0.1725);
  });

  it('still reads a <Pixels> element carrying attributes named like Object members', () => {
    const description = omeXml().replace(
      'ID="Pixels:0"',
      'ID="Pixels:0" __proto__="x" constructor="y"'
    );
    expect(
      readCellSensPixelSizeUm(cellSensTiff({ description }), XV).pixelSizeUm
    ).toBe(0.1725);
  });

  it('treats a unit named like an Object member as unknown', () => {
    expect(
      readCellSensPixelSizeUm(
        cellSensTiff({ description: omeXml({ unit: 'constructor' }) }),
        XV
      ).reason
    ).toBe('bad-unit');
  });
});
