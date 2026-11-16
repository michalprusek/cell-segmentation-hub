import { useCallback, useRef, useState } from 'react';
import type { Point, Polygon } from '@/lib/segmentation';
import type { ScribbleState } from '../types';
import {
  SCRIBBLE_HIT_TOLERANCE_PX,
  collectScribbleHits,
  prepareScribbleCandidates,
  type ScribbleCandidate,
} from '../utils/scribbleErase';

export interface UseScribbleEraseParams {
  /** The shapes a stroke may touch — the ones the canvas RENDERS. Read once,
   *  when the stroke starts. */
  getCandidates: () => Polygon[];
  /** Current zoom; the hit tolerance is constant on screen. Read once, when
   *  the stroke starts (zooming with the button held is not a gesture). */
  getZoom: () => number;
  /** Called on release with every touched id, in candidate order. Not
   *  called when the stroke touched nothing, or was cancelled. */
  onCommit: (polygonIds: string[]) => void;
}

/** The handle the mouse handlers drive. Every method is identity-stable. */
export interface ScribbleEraser {
  /** Render state: trail + pending ids, `null` with no stroke. */
  scribble: ScribbleState | null;
  /** Synchronous truth, for event handlers that run before a re-render. */
  isActive: () => boolean;
  start: (point: Point) => void;
  extend: (point: Point) => void;
  /** Ends the stroke and deletes what it touched. */
  commit: () => void;
  /** Ends the stroke, deletes nothing. Returns whether one was in progress. */
  cancel: () => boolean;
}

interface Session {
  candidates: ScribbleCandidate[];
  tol: number;
  points: Point[];
  pending: Set<string>;
}

/**
 * The delete tool's scribble: a stroke that fades every shape it touches and
 * deletes them on release (see `utils/scribbleErase.ts` for the hit test).
 *
 * The session lives in a REF, mirrored into state for rendering. Two
 * schedules feed it — the canvas's rAF-deferred mousemove and the window
 * listeners that keep a stroke alive outside the canvas — and a canvas
 * mouseup is followed by the window's for the same release. Reading a ref
 * makes the second commit a no-op instead of a double delete, and lets Esc
 * cancel a stroke whose state update has not rendered yet.
 */
export function useScribbleErase({
  getCandidates,
  getZoom,
  onCommit,
}: UseScribbleEraseParams): ScribbleEraser {
  const [scribble, setScribble] = useState<ScribbleState | null>(null);
  const sessionRef = useRef<Session | null>(null);

  // Read through refs so the methods can stay identity-stable — they are
  // handed to `useAdvancedInteractions`, whose callbacks list them as deps.
  const paramsRef = useRef({ getCandidates, getZoom, onCommit });
  paramsRef.current = { getCandidates, getZoom, onCommit };

  const publish = useCallback((s: Session) => {
    setScribble({ points: s.points.slice(), pendingIds: s.pending });
  }, []);

  const start = useCallback(
    (point: Point) => {
      const { getCandidates: candidatesOf, getZoom: zoomOf } =
        paramsRef.current;
      const candidates = prepareScribbleCandidates(candidatesOf());
      const tol = SCRIBBLE_HIT_TOLERANCE_PX / (zoomOf() || 1);
      // A zero-length first segment: a click is a one-point stroke.
      const pending = new Set(
        collectScribbleHits(candidates, point, point, tol, new Set())
      );
      const session: Session = { candidates, tol, points: [point], pending };
      sessionRef.current = session;
      publish(session);
    },
    [publish]
  );

  const extend = useCallback(
    (point: Point) => {
      const s = sessionRef.current;
      if (!s) return;
      const prev = s.points[s.points.length - 1];
      if (prev.x === point.x && prev.y === point.y) return;
      const hits = collectScribbleHits(
        s.candidates,
        prev,
        point,
        s.tol,
        s.pending
      );
      s.points.push(point);
      // A new Set only when something new was touched: polygons compare
      // `pendingIds.has(id)`, but the layout reads the Set itself.
      if (hits.length > 0) s.pending = new Set([...s.pending, ...hits]);
      publish(s);
    },
    [publish]
  );

  const commit = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    sessionRef.current = null;
    setScribble(null);
    if (s.pending.size > 0) paramsRef.current.onCommit(Array.from(s.pending));
  }, []);

  const cancel = useCallback(() => {
    if (!sessionRef.current) return false;
    sessionRef.current = null;
    setScribble(null);
    return true;
  }, []);

  const isActive = useCallback(() => sessionRef.current !== null, []);

  return { scribble, isActive, start, extend, commit, cancel };
}
