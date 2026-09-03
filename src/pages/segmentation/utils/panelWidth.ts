/**
 * The pure half of the resizable editor sidebar.
 *
 * Requested by a user (Institut Curie, 2026-09-03): the right-hand panel lists
 * every microtubule with its name and type label, and at the old fixed 288 px
 * a name plus an assigned type label did not fit — the type badge truncates, so
 * checking whether a microtubule was typed correctly meant clicking "rename" on
 * each row to reveal the full text.
 *
 * The drag handle sits on the panel's LEFT edge and the panel is anchored
 * right, so dragging left must make it WIDER: the delta is inverted relative to
 * pointer movement. Getting that backwards is the one bug this file exists to
 * prevent, and it is the reason the arithmetic is a named, tested function
 * rather than three lines inside a pointermove handler.
 */

/** Narrower than this and the rows are unreadable — the width the panel had
 *  before it became resizable is the DEFAULT, not the minimum, so a user can
 *  still make it smaller than it used to be to give the canvas more room. */
export const MIN_PANEL_WIDTH = 200;
/** Wide enough for the longest type label a user has created, and still
 *  leaving the canvas usable on a 1280 px laptop screen. */
export const MAX_PANEL_WIDTH = 640;
/** `lg:w-72` — what the panel measured before it was resizable, so an
 *  untouched editor looks exactly as it did. */
export const DEFAULT_PANEL_WIDTH = 288;

/** localStorage key. Per browser, not per project: it is a display preference
 *  about this user's screen, not about any one dataset. */
export const PANEL_WIDTH_STORAGE_KEY = 'spheroseg.editor.sidebarWidth';

export const clampPanelWidth = (px: number): number =>
  Math.min(Math.max(Math.round(px), MIN_PANEL_WIDTH), MAX_PANEL_WIDTH);

/**
 * Width the panel should take while dragging.
 *
 * @param startWidth width when the drag started
 * @param startX     pointer x when the drag started
 * @param currentX   pointer x now
 */
export function widthFromDrag(
  startWidth: number,
  startX: number,
  currentX: number
): number {
  // Inverted on purpose: the handle is the panel's left edge, so moving the
  // pointer LEFT (currentX < startX) grows the panel.
  return clampPanelWidth(startWidth + (startX - currentX));
}

/** Read the stored width, falling back to the default. Tolerates a private
 *  window, cleared site data, and a hand-edited garbage value. */
export function readStoredPanelWidth(
  storage: Pick<Storage, 'getItem'> | null | undefined
): number {
  try {
    const raw = storage?.getItem(PANEL_WIDTH_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_PANEL_WIDTH;
    }
    const n = Number(raw);
    return Number.isFinite(n) ? clampPanelWidth(n) : DEFAULT_PANEL_WIDTH;
  } catch {
    // Some browsers THROW on storage access rather than returning null.
    return DEFAULT_PANEL_WIDTH;
  }
}
