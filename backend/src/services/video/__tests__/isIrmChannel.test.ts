/**
 * Which channel gets segmented, and what we claim to know about it.
 *
 * An IRM-trained model fed a TIRF channel produces confident, wrong centerlines
 * — measured 2026-08-17, the detections correlate with image content at
 * −0.02 SD, i.e. not at all, while looking entirely plausible. Nothing
 * downstream catches that, so the guard has to be here.
 *
 * The bug these tests pin: `isIrmChannel` used to treat an UNKNOWN wavelength
 * as evidence of IRM. Multi-page TIFFs carry no wavelength at all, so every
 * channel of every TIFF stack was typed `irm` and the first one silently became
 * the segmentation source.
 */

import { describe, it, expect } from 'vitest';
import { isIrmChannel } from '../types';

describe('isIrmChannel', () => {
  describe('positive evidence', () => {
    it.each([
      ['IRM', 'the modality itself'],
      ['BF', 'brightfield'],
      ['DIC', 'differential interference contrast'],
      ['TL', 'transmitted light'],
      ['Brightfield', 'spelled out'],
      ['Transmitted', 'spelled out'],
    ])('accepts %s (%s)', name => {
      expect(isIrmChannel(name, undefined)).toBe(true);
    });

    it('accepts a real ND2 IRM channel, which reports a NONZERO wavelength', () => {
      // Measured on two production files: emissionLambdaNm 525 and 510. The
      // name is the only thing that identifies these, which is why the
      // wavelength fallback never earned its keep.
      expect(isIrmChannel('IRM', 525)).toBe(true);
      expect(isIrmChannel('IRM', 510)).toBe(true);
    });

    it('accepts an explicitly zero wavelength as label-free', () => {
      expect(isIrmChannel('Channel_1', 0)).toBe(true);
      expect(isIrmChannel(undefined, 0)).toBe(true);
    });

    it('matches case-insensitively', () => {
      expect(isIrmChannel('irm', undefined)).toBe(true);
      expect(isIrmChannel('Irm_widefield', undefined)).toBe(true);
    });
  });

  describe('absence of metadata is NOT evidence', () => {
    it('rejects an unnamed channel with no wavelength', () => {
      expect(isIrmChannel(undefined, undefined)).toBe(false);
    });

    it('rejects generic TIFF channel names with no wavelength', () => {
      // THE regression. A multi-page TIFF yields ch0/ch1/ch2 and no
      // wavelength; all three used to come back true.
      expect(isIrmChannel('ch0', undefined)).toBe(false);
      expect(isIrmChannel('ch1', undefined)).toBe(false);
      expect(isIrmChannel('ch2', undefined)).toBe(false);
    });

    it('rejects a named fluorescence channel with no wavelength', () => {
      expect(isIrmChannel('TIRF_488', undefined)).toBe(false);
      expect(isIrmChannel('GFP', undefined)).toBe(false);
    });
  });

  describe('fluorescence is still rejected', () => {
    it.each([
      ['TIRF 488', 525],
      ['GFP', 509],
      ['mCherry', 610],
      ['DAPI', 461],
    ])('rejects %s at %i nm', (name, nm) => {
      expect(isIrmChannel(name, nm as number)).toBe(false);
    });
  });

  describe('word-boundary matching', () => {
    it('does not match a substring inside an unrelated word', () => {
      // "TL" inside "SETTLE" or "BF" inside "ABFP" must not qualify.
      expect(isIrmChannel('SETTLE', undefined)).toBe(false);
      expect(isIrmChannel('ABFP', undefined)).toBe(false);
    });

    it('matches when the token is separated', () => {
      expect(isIrmChannel('Widefield TL', undefined)).toBe(true);
    });
  });
});

describe('underscore-separated names', () => {
  it('treats underscores as separators, not word characters', () => {
    // `\b` counts `_` as a word char, so a bare /\bIRM\b/ misses this — and
    // underscore-separated channel names are the norm in microscopy exports.
    expect(isIrmChannel('IRM_widefield', undefined)).toBe(true);
    expect(isIrmChannel('widefield_BF', undefined)).toBe(true);
    expect(isIrmChannel('cam0_DIC_z0', undefined)).toBe(true);
  });

  it('still rejects fluorescence channels with underscores', () => {
    expect(isIrmChannel('TIRF_488', undefined)).toBe(false);
    expect(isIrmChannel('TIRF_640', undefined)).toBe(false);
    expect(isIrmChannel('Alexa_594', undefined)).toBe(false);
  });
});

describe('the TIFF stack that motivated this', () => {
  it('no longer identifies any channel of a nameless TIFF stack as IRM', () => {
    // 20260429_CH2_DNA_origami_..._10x_001_merged_TEST_3frames.tif yields
    // ch0/ch1/ch2 with no wavelength. All three used to come back `irm`, so the
    // container was stored claiming three IRM channels and ch0 — actually TIRF
    // — became the segmentation source for an IRM-trained model.
    const tiffStack = ['ch0', 'ch1', 'ch2'];
    expect(tiffStack.map(n => isIrmChannel(n, undefined))).toEqual([
      false,
      false,
      false,
    ]);
  });

  it('still identifies the IRM channel of a real ND2 well', () => {
    // WellD03_ChannelIRM_TIRF_488_Seq0000.nd2 — both channels report 525 nm,
    // so only the name distinguishes them.
    expect(isIrmChannel('IRM', 525)).toBe(true);
    expect(isIrmChannel('TIRF 488', 525)).toBe(false);
  });
});
