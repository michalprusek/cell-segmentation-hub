/**
 * Which channel a "segment this" dialog should have selected when it opens.
 *
 * A channel is preselected ONLY when the container itself marks it as the
 * segmentation source - which happens on positive evidence (an IRM / BF /
 * DIC / TL name, or a zero emission wavelength). Otherwise nothing is: the
 * dialog's Confirm stays disabled until the user picks.
 *
 * Both pickers used to fall back to "the first channel" - and on the project
 * page that meant the alphabetically first, which put `488_nm` ahead of a
 * correctly identified `IRM`. The microtubule model on a fluorescence
 * channel returns plenty of confident-looking filaments with nothing under
 * them, so a default the user merely confirms is the dangerous one.
 *
 * @param channels the channels offered, in display order
 * @param sources  names marked as a segmentation source
 * @returns the first offered channel that is a marked source, or '' for
 *   "no preselection"
 */
export function pickDefaultSegmentationChannel(
  channels: readonly string[],
  sources: readonly string[] | null | undefined
): string {
  if (!sources || sources.length === 0) {
    return '';
  }
  return channels.find(channel => sources.includes(channel)) ?? '';
}
