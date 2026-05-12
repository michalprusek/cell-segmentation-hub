import { describe, it, expect } from 'vitest';
import { safeMlFilename } from '../mlFilename';

describe('safeMlFilename', () => {
  it('prefers mimeType-derived extension for PNG', () => {
    expect(
      safeMlFilename({
        id: 'abc-123',
        name: 'doesnt-matter.weird',
        mimeType: 'image/png',
      })
    ).toBe('abc-123.png');
  });

  it('maps image/jpeg to .jpg', () => {
    expect(
      safeMlFilename({ id: 'xyz', name: 'photo.jpg', mimeType: 'image/jpeg' })
    ).toBe('xyz.jpg');
  });

  it('maps image/tiff to .tif', () => {
    expect(
      safeMlFilename({ id: 'tif-1', name: 'stack.tif', mimeType: 'image/tiff' })
    ).toBe('tif-1.tif');
  });

  it('case-insensitive mimeType lookup', () => {
    expect(
      safeMlFilename({ id: 'casing', name: null, mimeType: 'Image/PNG' })
    ).toBe('casing.png');
  });

  it('sanitises spaces and parens in fallback name', () => {
    // The video-frame bug: name contains "(frame 98)" with spaces and
    // parens, ML extension validator fails. Helper either uses mimeType
    // or sanitises this safely.
    expect(
      safeMlFilename({
        id: 'frame-xyz',
        name: 'video.nd2 (frame 98)',
        mimeType: undefined,
      })
    ).toBe('frame-xyz.png');
  });

  it('passes through a clean image-extension filename', () => {
    expect(
      safeMlFilename({
        id: 'std-1',
        name: 'clean_image.png',
        mimeType: null,
      })
    ).toBe('clean_image.png');
  });

  it('preserves clean tiff/jpeg filenames in fallback', () => {
    expect(
      safeMlFilename({
        id: 's',
        name: 'sample.jpeg',
        mimeType: undefined,
      })
    ).toBe('sample.jpeg');
    expect(
      safeMlFilename({
        id: 's',
        name: 'stack.tiff',
        mimeType: undefined,
      })
    ).toBe('stack.tiff');
  });

  it('falls back to id-based .png when mimeType missing and name has unsupported ext', () => {
    expect(
      safeMlFilename({
        id: 'fallback-id',
        name: 'binary.bin',
        mimeType: undefined,
      })
    ).toBe('fallback-id.png');
  });

  it('regression: ND2-frame style name no longer trips ML validator', () => {
    // Exact shape of the failing case from production logs (2026-05-12):
    // ML extracts ext via split('.').pop() → 'nd2 (frame 98)' which is
    // not in {.png, .jpg, .jpeg, .tiff, .tif, .bmp}. Helper either uses
    // mimeType to short-circuit or sanitises away the spaces/parens.
    const out = safeMlFilename({
      id: '62a94898-b2c7-4503-a935-41c336d61859',
      name: '20260429_CH2_DNA_origami_BRB80MB_DO1_v2_10x_.nd2 (frame 98)',
      mimeType: 'image/png',
    });
    expect(out).toBe('62a94898-b2c7-4503-a935-41c336d61859.png');
    // Critically: the result's last '.' token IS in the allowed set.
    const ext = '.' + out.split('.').pop()!.toLowerCase();
    expect(['.png', '.jpg', '.jpeg', '.tiff', '.tif', '.bmp']).toContain(ext);
  });
});
