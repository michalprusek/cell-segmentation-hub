import React from 'react';
import {
  Film,
  Microscope,
  PenLine,
  Server,
  Table2,
  Waypoints,
} from 'lucide-react';
import { useLanguage } from '@/contexts/exports';

/**
 * The mono tag on each capability is the object that capability operates on —
 * the same vocabulary the editor and the API use (`polygon`, `frame`, `track`,
 * `vertex`, `roi`, `queue`). It carries information; it is not a decorative
 * 01/02/03 counter.
 */
const CAPABILITIES = [
  { id: 'models', tag: 'polygon', Icon: Microscope },
  { id: 'stacks', tag: 'frame', Icon: Film },
  { id: 'tracking', tag: 'track', Icon: Waypoints },
  { id: 'corrections', tag: 'vertex', Icon: PenLine },
  { id: 'measurements', tag: 'roi', Icon: Table2 },
  { id: 'batch', tag: 'queue', Icon: Server },
] as const;

function Features() {
  const { t } = useLanguage();

  return (
    <section
      id="features"
      className="border-t border-gray-200 py-20 dark:border-gray-800"
    >
      <div className="container mx-auto px-4">
        <div className="max-w-2xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-blue-700 dark:text-blue-300">
            {t('landing.features.badge')}
          </p>
          <h2 className="mt-4 text-3xl font-semibold tracking-[-0.025em] text-gray-900 md:text-4xl dark:text-gray-50">
            {t('landing.features.title')}
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-gray-600 dark:text-gray-300">
            {t('landing.features.subtitle')}
          </p>
        </div>

        <ul className="mt-14 grid grid-cols-1 gap-x-10 gap-y-10 md:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map(({ id, tag, Icon }) => (
            <li
              key={id}
              className="border-t border-gray-200 pt-5 dark:border-gray-800"
            >
              <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span className="font-mono text-[11px] uppercase tracking-[0.14em]">
                  {tag}
                </span>
              </div>
              <h3 className="mt-3 text-lg font-semibold text-gray-900 dark:text-gray-50">
                {t(`landing.features.cards.${id}.title`)}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                {t(`landing.features.cards.${id}.description`)}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export default Features;
