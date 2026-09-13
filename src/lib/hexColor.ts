/** Parse `#RRGGBB` (or `#rgb`) into [r, g, b]. White is the grayscale
 *  identity — invalid inputs degrade to it rather than throwing.
 *
 *  Shared by the multi-channel canvas, which tints each channel by it, and the
 *  Display panel's histogram, whose bars must carry the same tint or the plot
 *  would describe a different picture from the one on screen. */
export function hexToRgb(hex: string): [number, number, number] {
  if (!hex || hex[0] !== '#') return [255, 255, 255];
  if (hex.length === 4) {
    return [
      parseInt(hex[1] + hex[1], 16),
      parseInt(hex[2] + hex[2], 16),
      parseInt(hex[3] + hex[3], 16),
    ];
  }
  if (hex.length === 7) {
    return [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
  }
  return [255, 255, 255];
}
