/**
 * Generic renderers for the documentation content model.
 *
 * One component per `DocsBlock` kind, plus `Highlight`, which marks search
 * terms inside any rendered string. Keeping the highlighting here (rather than
 * in the page) means every block kind gets it without remembering to opt in.
 */

import React from 'react';
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { normalizeForSearch } from './useDocsSearch';
import type { DocsBlock, DocsTone } from './docsContent';

/**
 * Render `text`, wrapping any occurrence of a search term in a `<mark>`.
 *
 * Matching runs on the diacritic-stripped form so a query without accents
 * still highlights the accented original; because that transform is
 * character-for-character (combining marks are dropped, not letters), offsets
 * in the normalized string map back onto the original safely.
 */
export const Highlight: React.FC<{ text: string; terms: string[] }> = ({
  text,
  terms,
}) => {
  if (terms.length === 0) return <>{text}</>;

  const haystack = normalizeForSearch(text);
  // Collect [start, end) ranges for every term occurrence, then merge overlaps.
  const ranges: Array<[number, number]> = [];
  for (const term of terms) {
    if (!term) continue;
    let from = haystack.indexOf(term);
    while (from !== -1) {
      ranges.push([from, from + term.length]);
      from = haystack.indexOf(term, from + term.length);
    }
  }
  if (ranges.length === 0) return <>{text}</>;

  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) {
      last[1] = Math.max(last[1], range[1]);
    } else {
      merged.push([range[0], range[1]]);
    }
  }

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  merged.forEach(([start, end], index) => {
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(
      <mark
        key={`${start}-${index}`}
        className="bg-yellow-200 text-inherit rounded-sm px-0.5 dark:bg-yellow-500/40"
      >
        {text.slice(start, end)}
      </mark>
    );
    cursor = end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));

  return <>{parts}</>;
};

const TONE_CARD: Record<DocsTone, string> = {
  info: 'bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-900',
  warning:
    'bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-900',
  success:
    'bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-900',
  neutral:
    'bg-gray-50 border-gray-200 dark:bg-gray-800/60 dark:border-gray-700',
};

const TONE_NOTE: Record<'info' | 'warning' | 'success', string> = {
  info: 'bg-blue-50 border-blue-400 text-blue-900 dark:bg-blue-950/30 dark:text-blue-100',
  warning:
    'bg-amber-50 border-amber-400 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100',
  success:
    'bg-green-50 border-green-400 text-green-900 dark:bg-green-950/30 dark:text-green-100',
};

const NOTE_ICON: Record<'info' | 'warning' | 'success', React.ElementType> = {
  info: Info,
  warning: AlertTriangle,
  success: CheckCircle2,
};

interface BlockProps {
  block: DocsBlock;
  terms: string[];
}

/** Render one content block. */
export const DocsBlockView: React.FC<BlockProps> = ({ block, terms }) => {
  switch (block.kind) {
    case 'heading':
      return (
        <h3 className="text-xl font-semibold mb-3 mt-6">
          <Highlight text={block.text} terms={terms} />
        </h3>
      );

    case 'paragraph':
      return (
        <p className="mb-4 text-gray-700 dark:text-gray-300">
          <Highlight text={block.text} terms={terms} />
        </p>
      );

    case 'list': {
      const className = block.ordered
        ? 'list-decimal pl-6 mb-6 space-y-2'
        : 'list-disc pl-6 mb-6 space-y-2';
      const items = block.items.map((item, index) => (
        <li key={index} className="text-gray-700 dark:text-gray-300">
          <Highlight text={item} terms={terms} />
        </li>
      ));
      return block.ordered ? (
        <ol className={className}>{items}</ol>
      ) : (
        <ul className={className}>{items}</ul>
      );
    }

    case 'note': {
      const NoteIcon = NOTE_ICON[block.tone];
      return (
        <div
          className={`border-l-4 p-4 mb-6 rounded-r-md ${TONE_NOTE[block.tone]}`}
        >
          <div className="flex gap-3">
            <NoteIcon
              className="h-5 w-5 flex-shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <p className="text-sm">
              <strong className="font-semibold">
                <Highlight text={block.label} terms={terms} />
              </strong>{' '}
              <Highlight text={block.text} terms={terms} />
            </p>
          </div>
        </div>
      );
    }

    case 'cards':
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {block.items.map((item, index) => (
            <div
              key={index}
              className={`border rounded-lg p-4 ${TONE_CARD[item.tone ?? 'neutral']}`}
            >
              <h4 className="font-semibold mb-2 text-gray-900 dark:text-gray-100">
                <Highlight text={item.title} terms={terms} />
              </h4>
              {item.lines.map((line, lineIndex) => (
                <p
                  key={lineIndex}
                  className="text-sm text-gray-700 dark:text-gray-300 mb-1 last:mb-0"
                >
                  <Highlight text={line} terms={terms} />
                </p>
              ))}
            </div>
          ))}
        </div>
      );

    case 'table':
      return (
        <div className="overflow-x-auto mb-6">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b-2 border-gray-200 dark:border-gray-700">
                {block.headers.map((header, index) => (
                  <th
                    key={index}
                    className="text-left font-semibold py-2 pr-4 text-gray-900 dark:text-gray-100"
                  >
                    <Highlight text={header} terms={terms} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr
                  key={rowIndex}
                  className="border-b border-gray-100 dark:border-gray-800"
                >
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      className="py-2 pr-4 align-top text-gray-700 dark:text-gray-300"
                    >
                      <Highlight text={cell} terms={terms} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case 'shortcuts':
      return (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-6 dark:bg-gray-900 dark:border-gray-700">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 text-sm">
            {block.groups.map((group, groupIndex) => (
              <div key={groupIndex}>
                <p className="font-medium mb-2 text-gray-900 dark:text-gray-100">
                  <Highlight text={group.title} terms={terms} />
                </p>
                <ul className="space-y-1.5">
                  {group.items.map((item, itemIndex) => (
                    <li
                      key={itemIndex}
                      className="flex items-baseline gap-2 text-gray-700 dark:text-gray-300"
                    >
                      <kbd className="bg-gray-200 px-2 py-0.5 rounded text-xs font-mono whitespace-nowrap dark:bg-gray-700">
                        <Highlight text={item.keys} terms={terms} />
                      </kbd>
                      <span>
                        <Highlight text={item.label} terms={terms} />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      );

    default:
      return null;
  }
};

DocsBlockView.displayName = 'DocsBlockView';
