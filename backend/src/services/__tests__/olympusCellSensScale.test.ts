import { describe, it, expect } from 'vitest';
import { deflateSync } from 'zlib';
import { readCellSensPixelSizeUm } from '../olympusCellSensScale';
import {
  cellSensJpeg,
  cellSensJson,
  exifTiff,
  jpeg,
  makerNote,
  um,
} from '../../test/fixtures/cellSensJpeg';

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
    ).toBe('not-jpeg');
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
