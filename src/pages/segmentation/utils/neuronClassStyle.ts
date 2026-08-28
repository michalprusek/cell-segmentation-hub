import type { NeuronPartClass } from '@/lib/segmentation';

/**
 * View-layer SSOT for how the two neuron classes (`neurite` / `soma`) are
 * surfaced in the editor: canvas stroke colour, sidebar dot, CSS class and
 * translation key.
 *
 * WHY the hues: they match the model's own `--overlay` output (cyan =
 * neurite, magenta = soma, see `neurite-soma-seg/README.md`). Someone
 * comparing an editor screenshot against a `predict.py` overlay sees the same
 * two colours, which is worth more than avoiding the incidental clash with the
 * sperm `tail` cyan — sperm parts are polylines in a different project type
 * and can never appear on the same canvas.
 *
 * WHY a CSS class carries the fill rather than the SVG `fill` attribute:
 * `src/index.css` styles `.polygon-external` / `.polygon-internal` /
 * `.polygon-core` with real CSS rules, and a CSS declaration beats a
 * presentation attribute. A neuron polygon whose fill lived only in the
 * attribute would be painted the plain external red. `.polygon-neurite` /
 * `.polygon-soma` in `src/index.css` are the counterparts of these entries;
 * the two must be edited together.
 */
export interface NeuronClassStyle {
  /** Canvas stroke, unselected. */
  readonly stroke: string;
  /** Canvas stroke, selected (one step darker). */
  readonly strokeSelected: string;
  /** `src/index.css` class that supplies the polygon fill. */
  readonly cssClass: string;
  /** Tailwind background utility for the sidebar's colour dot. */
  readonly dotClass: string;
  /** Key under `segmentation.partClass.*`. Deliberately NOT the sperm
   *  `sperm.part.*` namespace — these are object classes of a different
   *  model, and reusing sperm's keys would mistranslate them. */
  readonly i18nKey: string;
}

export const NEURON_CLASS_STYLES: Record<NeuronPartClass, NeuronClassStyle> = {
  neurite: {
    stroke: '#06b6d4',
    strokeSelected: '#0891b2',
    cssClass: 'polygon-neurite',
    dotClass: 'bg-cyan-500',
    i18nKey: 'segmentation.partClass.neurite',
  },
  soma: {
    stroke: '#d946ef',
    strokeSelected: '#c026d3',
    cssClass: 'polygon-soma',
    dotClass: 'bg-fuchsia-500',
    i18nKey: 'segmentation.partClass.soma',
  },
};

/**
 * Style for a polygon's `partClass`, or `undefined` when it is not a neuron
 * class (a sperm part, the spheroid `core`, or absent). Total over
 * `string | undefined` so callers need no cast.
 */
export const neuronClassStyle = (
  partClass: string | undefined
): NeuronClassStyle | undefined =>
  partClass === undefined
    ? undefined
    : NEURON_CLASS_STYLES[partClass as NeuronPartClass];
