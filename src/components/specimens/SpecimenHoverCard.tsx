/**
 * Hover preview for one option of the project-type or model picker.
 *
 * Shows three real production frames with the outlines the model actually
 * produced, so the reader can pick by recognising their own kind of image
 * rather than by decoding a model name.
 *
 * ERGONOMICS, in the order they matter:
 *
 * - `OPEN_DELAY_MS` keeps a card from flashing at every option the pointer
 *   crosses on its way down a list. `CLOSE_DELAY_MS` is short but non-zero so
 *   the card does not blink when the pointer skims the gap between rows.
 * - The geometry fetch starts on pointer-enter, BEFORE the open delay elapses.
 *   By the time the card is due, its outlines are usually already in hand, so
 *   it opens complete instead of filling in afterwards.
 * - Nothing is fetched until then: the whole set is ~127 kB of geometry plus
 *   ~514 kB of tiles, none of which a reader who never hovers should pay for.
 * - An option with no examples renders its trigger untouched — an empty card
 *   is worse than no card.
 *
 * Radix opens a hover card on keyboard focus too, so tabbing through the model
 * list surfaces the same previews.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import SpecimenOutlineLayer from '@/components/specimens/SpecimenOutlineLayer';
import {
  HoverCard,
  HoverCardContent,
  HoverCardPortal,
  HoverCardTrigger,
} from '@/components/ui/hover-card';
import { useLanguage } from '@/contexts/useLanguage';
import { MODEL_REGISTRY, type ModelType } from '@/lib/models/modelRegistry';
import {
  loadSpecimenGeometry,
  peekSpecimenGeometry,
} from '@/lib/specimens/previewGeometry';
import type { SpecimenPreview } from '@/lib/specimens/previewIndex';
import {
  previewsForModel,
  previewsForProjectType,
} from '@/lib/specimens/selectPreviews';
import {
  specimenStroke,
  type SpecimenOutline,
} from '@/lib/specimens/specimenStroke';
import type { ProjectType } from '@/types';

/** Long enough that scanning a list opens nothing, short enough that a
 *  deliberate hover feels immediate. */
const OPEN_DELAY_MS = 320;
const CLOSE_DELAY_MS = 120;
/** Screen pixels; the tiles render at ~150 css px. */
const TILE_STROKE_WIDTH = 1;

type SpecimenTarget =
  | { kind: 'model'; value: ModelType }
  | { kind: 'projectType'; value: ProjectType };

type SpecimenHoverCardProps = SpecimenTarget & {
  children: React.ReactNode;
  side?: React.ComponentPropsWithoutRef<typeof HoverCardContent>['side'];
  align?: React.ComponentPropsWithoutRef<typeof HoverCardContent>['align'];
};

interface TileProps {
  preview: SpecimenPreview;
  outlines: readonly SpecimenOutline[] | undefined;
  alt: string;
}

function SpecimenTile({ preview, outlines, alt }: TileProps) {
  const paths = useMemo(
    () =>
      (outlines ?? []).map(outline => ({
        d: outline.d,
        stroke: specimenStroke(outline),
      })),
    [outlines]
  );

  return (
    <figure className="m-0 min-w-0 flex-1">
      <div className="relative aspect-square overflow-hidden rounded-md bg-gray-900 ring-1 ring-black/10 dark:ring-white/10">
        <img
          src={preview.image}
          alt={alt}
          width={150}
          height={150}
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
        />
        {paths.length > 0 && (
          <SpecimenOutlineLayer
            outlines={paths}
            strokeWidth={TILE_STROKE_WIDTH}
          />
        )}
      </div>
      <figcaption className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
        {MODEL_REGISTRY[preview.model].name}
      </figcaption>
    </figure>
  );
}

function SpecimenHoverCard({
  kind,
  value,
  children,
  side = 'right',
  align = 'center',
}: SpecimenHoverCardProps) {
  const { t } = useLanguage();
  const tx = useCallback(
    (key: string, options?: Record<string, unknown>) => String(t(key, options)),
    [t]
  );

  const previews = useMemo(
    () =>
      kind === 'model'
        ? previewsForModel(value as ModelType)
        : previewsForProjectType(value as ProjectType),
    [kind, value]
  );

  const [geometry, setGeometry] = useState<
    Record<string, readonly SpecimenOutline[]>
  >(() => seedFromCache(previews));
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** Warm the card before it is due to open: geometry over the network, tiles
   *  into the image cache. Both are no-ops on a second hover. */
  const prefetch = useCallback(() => {
    for (const preview of previews) {
      if (typeof Image !== 'undefined') {
        new Image().src = preview.image;
      }
      if (peekSpecimenGeometry(preview.geometry)) continue;
      void loadSpecimenGeometry(preview.geometry).then(outlines => {
        if (!alive.current) return;
        setGeometry(current =>
          current[preview.geometry] === outlines
            ? current
            : { ...current, [preview.geometry]: outlines }
        );
      });
    }
  }, [previews]);

  if (previews.length === 0) return <>{children}</>;

  const heading =
    kind === 'model'
      ? MODEL_REGISTRY[value as ModelType].name
      : tx(`projects.types.${value}`);
  const detail =
    kind === 'model'
      ? tx('specimens.preview.byModel')
      : tx('specimens.preview.byType');

  return (
    <HoverCard openDelay={OPEN_DELAY_MS} closeDelay={CLOSE_DELAY_MS}>
      <HoverCardTrigger asChild onPointerEnter={prefetch} onFocus={prefetch}>
        {children}
      </HoverCardTrigger>
      <HoverCardPortal>
        <HoverCardContent
          side={side}
          align={align}
          className="w-[26rem] max-w-[calc(100vw-2rem)]"
          // The card is a picture, not a control: it must never steal the
          // pointer from the option the reader is about to click.
          onPointerDownOutside={event => event.preventDefault()}
        >
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            {heading}
          </p>
          <div className="mt-2 flex gap-2">
            {previews.map(preview => (
              <SpecimenTile
                key={preview.id}
                preview={preview}
                outlines={
                  geometry[preview.geometry] ??
                  peekSpecimenGeometry(preview.geometry)
                }
                alt={tx('specimens.preview.alt', {
                  type: tx(`projects.types.${preview.projectType}`),
                  model: MODEL_REGISTRY[preview.model].name,
                })}
              />
            ))}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {detail}
          </p>
        </HoverCardContent>
      </HoverCardPortal>
    </HoverCard>
  );
}

/** Geometry already fetched by an earlier hover, so a re-open paints its
 *  outlines on the first frame instead of after a state round-trip. */
function seedFromCache(
  previews: readonly SpecimenPreview[]
): Record<string, readonly SpecimenOutline[]> {
  const seed: Record<string, readonly SpecimenOutline[]> = {};
  for (const preview of previews) {
    const cached = peekSpecimenGeometry(preview.geometry);
    if (cached) seed[preview.geometry] = cached;
  }
  return seed;
}

export default SpecimenHoverCard;
