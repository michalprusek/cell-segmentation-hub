import { describe, it, expect } from 'vitest';
import { resolveScalePrefill } from '../scalePrefill';

const jpeg = { pixelSizeUm: 0.08625 };
const tiff = { pixelSizeUm: 0.1725 };
const plain = { pixelSizeUm: null };

describe('resolveScalePrefill', () => {
  // The sperm report applies each image's own scale on the server; the field
  // is the fallback for images without one and must not borrow another's.
  it('never offers an image scale for a sperm project', () => {
    expect(
      resolveScalePrefill({ projectType: 'sperm', images: [jpeg, plain] })
    ).toBeUndefined();
    expect(
      resolveScalePrefill({
        projectType: 'sperm',
        images: [jpeg, plain],
        projectPixelSizeUm: 0.1725,
      })
    ).toBe(0.1725);
  });

  it('offers the image scale when every calibrated image agrees', () => {
    expect(
      resolveScalePrefill({
        projectType: 'spheroid',
        images: [plain, jpeg, { pixelSizeUm: 0.08625000000000002 }],
        projectPixelSizeUm: 1.28,
      })
    ).toBe(0.08625);
  });

  it('falls back to the project when calibrated images disagree', () => {
    expect(
      resolveScalePrefill({
        projectType: 'spheroid',
        images: [jpeg, tiff],
        projectPixelSizeUm: 1.28,
      })
    ).toBe(1.28);
    expect(
      resolveScalePrefill({ projectType: 'wound', images: [tiff, jpeg] })
    ).toBeUndefined();
  });

  it('uses the project, or nothing, when no image is calibrated', () => {
    expect(
      resolveScalePrefill({
        projectType: 'neurite',
        images: [plain, { pixelSizeUm: 0 }, {}],
        projectPixelSizeUm: 0.18,
      })
    ).toBe(0.18);
    expect(
      resolveScalePrefill({ projectType: null, images: [plain] })
    ).toBeUndefined();
  });
});
