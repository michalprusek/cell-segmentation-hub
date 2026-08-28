import React, { useCallback, useId, useMemo, useRef, useState } from 'react';
import { useLanguage } from '@/contexts/useLanguage';
import { SPECIMENS, type Specimen, type SpecimenId } from './specimens';

/**
 * Keyframes and the reduced-motion opt-out live here rather than in a global
 * stylesheet so the animation ships with the only component that uses it.
 * `pathLength="1"` on each path normalises its length, so one dash length
 * draws every outline correctly regardless of how long it really is.
 */
const SHOWCASE_CSS = `
.specimen-draw path {
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  animation: specimen-draw 900ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
}
@keyframes specimen-draw {
  to { stroke-dashoffset: 0; }
}
.specimen-frame img {
  animation: specimen-fade 320ms ease-out both;
}
@keyframes specimen-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .specimen-draw path {
    animation: none;
    stroke-dashoffset: 0;
  }
  .specimen-frame img {
    animation: none;
  }
}
`;

/**
 * Stagger the draw-on, but cap it: the disintegration tile carries 108
 * outlines and a per-outline delay would run for ten seconds.
 */
const STAGGER_MS = 14;
const MAX_STAGGER_STEPS = 26;

interface OutlineLayerProps {
  specimen: Specimen;
  strokeWidth: number;
  animate: boolean;
}

/** The real segmentation, drawn as vectors over the frame. */
function OutlineLayer({ specimen, strokeWidth, animate }: OutlineLayerProps) {
  return (
    <svg
      viewBox="0 0 1000 1000"
      className={`pointer-events-none absolute inset-0 h-full w-full ${
        animate ? 'specimen-draw' : ''
      }`}
      aria-hidden="true"
      focusable="false"
    >
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {specimen.outlines.map((outline, index) => (
          <path
            key={index}
            d={outline.d}
            stroke={outline.stroke}
            strokeWidth={strokeWidth}
            pathLength={1}
            vectorEffect="non-scaling-stroke"
            style={
              animate
                ? {
                    animationDelay: `${Math.min(index, MAX_STAGGER_STEPS) * STAGGER_MS}ms`,
                  }
                : undefined
            }
          />
        ))}
      </g>
    </svg>
  );
}

/**
 * The landing page's centrepiece: a tray of real microscopy frames from this
 * deployment, each shown with the outlines its model actually produced. Picking
 * a specimen re-draws the outlines over the frame.
 */
function SpecimenShowcase() {
  const { t } = useLanguage();
  const tx = useCallback((key: string) => String(t(key)), [t]);

  const [activeId, setActiveId] = useState<SpecimenId>(SPECIMENS[0].id);
  // The first frame is the page's LCP element, so it must not start at
  // opacity 0; the cross-fade only applies once the reader has switched.
  const [hasSwitched, setHasSwitched] = useState(false);
  const tabRefs = useRef(new Map<SpecimenId, HTMLButtonElement>());
  const baseId = useId();

  const active = useMemo(
    () => SPECIMENS.find(specimen => specimen.id === activeId) ?? SPECIMENS[0],
    [activeId]
  );

  const selectTab = useCallback((id: SpecimenId) => {
    setHasSwitched(true);
    setActiveId(id);
  }, []);

  const focusTab = useCallback(
    (id: SpecimenId) => {
      selectTab(id);
      tabRefs.current.get(id)?.focus();
    },
    [selectTab]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const index = SPECIMENS.findIndex(specimen => specimen.id === activeId);
      let next = -1;
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        next = (index + 1) % SPECIMENS.length;
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        next = (index - 1 + SPECIMENS.length) % SPECIMENS.length;
      } else if (event.key === 'Home') {
        next = 0;
      } else if (event.key === 'End') {
        next = SPECIMENS.length - 1;
      }
      if (next < 0) return;
      event.preventDefault();
      focusTab(SPECIMENS[next].id);
    },
    [activeId, focusTab]
  );

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,40rem)_minmax(0,20rem)] lg:gap-10">
      <style>{SHOWCASE_CSS}</style>

      <figure
        className={`m-0 w-full max-w-[40rem] ${hasSwitched ? 'specimen-frame' : ''}`}
        id={`${baseId}-panel`}
        role="tabpanel"
        tabIndex={0}
        aria-labelledby={`${baseId}-tab-${active.id}`}
      >
        <div className="relative aspect-square overflow-hidden rounded-2xl bg-gray-900 ring-1 ring-gray-900/10 dark:ring-white/10">
          <img
            key={active.id}
            src={active.image}
            alt={tx(`landing.specimens.${active.id}.alt`)}
            width={720}
            height={720}
            className="h-full w-full object-cover"
            decoding="async"
            fetchPriority="high"
          />
          <OutlineLayer
            key={`outlines-${active.id}`}
            specimen={active}
            strokeWidth={1.6}
            animate
          />
        </div>
        <figcaption className="mt-4">
          <span className="block font-mono text-[11px] uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">
            {tx(`landing.specimens.${active.id}.label`)}
            <span aria-hidden="true"> · </span>
            {active.model}
          </span>
          <span className="mt-1 block max-w-prose text-sm leading-relaxed text-gray-600 dark:text-gray-300">
            {tx(`landing.specimens.${active.id}.detail`)}
          </span>
        </figcaption>
      </figure>

      <div>
        <p
          id={`${baseId}-tablist-label`}
          className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400"
        >
          {tx('landing.specimens.trayLabel')}
        </p>
        <div
          role="tablist"
          aria-orientation="vertical"
          aria-labelledby={`${baseId}-tablist-label`}
          onKeyDown={handleKeyDown}
          className="flex flex-col gap-1"
        >
          {SPECIMENS.map(specimen => {
            const isActive = specimen.id === active.id;
            return (
              <button
                key={specimen.id}
                ref={node => {
                  if (node) tabRefs.current.set(specimen.id, node);
                  else tabRefs.current.delete(specimen.id);
                }}
                type="button"
                role="tab"
                id={`${baseId}-tab-${specimen.id}`}
                aria-selected={isActive}
                aria-controls={`${baseId}-panel`}
                tabIndex={isActive ? 0 : -1}
                onClick={() => selectTab(specimen.id)}
                className={`flex items-center gap-3 rounded-lg p-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  isActive
                    ? 'bg-gray-100 dark:bg-gray-800'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-800/60'
                }`}
              >
                <span className="relative block h-14 w-14 shrink-0 overflow-hidden rounded-md bg-gray-900">
                  <img
                    src={specimen.image}
                    alt=""
                    width={56}
                    height={56}
                    className="h-full w-full object-cover"
                    loading="lazy"
                    decoding="async"
                  />
                  <OutlineLayer
                    specimen={specimen}
                    strokeWidth={0.6}
                    animate={false}
                  />
                </span>
                <span className="min-w-0">
                  <span
                    className={`block truncate text-sm font-medium ${
                      isActive
                        ? 'text-gray-900 dark:text-gray-50'
                        : 'text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    {tx(`landing.specimens.${specimen.id}.label`)}
                  </span>
                  <span className="block truncate font-mono text-[11px] text-gray-500 dark:text-gray-400">
                    {specimen.model}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default SpecimenShowcase;
