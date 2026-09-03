import React, { useDeferredValue, useMemo, useState } from 'react';
import { Spline, Eye, EyeOff, Trash2, Tag, Plus, Pencil } from 'lucide-react';
import { useLanguage } from '@/contexts/useLanguage';
import { Checkbox } from '@/components/ui/checkbox';
import { Polygon } from '@/lib/segmentation';
import type { MTTypeLabel } from '@/lib/api';
import { calculatePolylineLength } from '../utils/metricCalculations';
import {
  colorFromInstanceId,
  isMicrotubuleInstance,
} from '../utils/instanceColors';
import {
  buildInstanceLabelMap,
  MICROTUBULE_LABEL_PREFIX,
} from '../utils/instanceLabels';
import MtTypeLabelDialog from './context-menu/MtTypeLabelDialog';

interface MicrotubuleInstancePanelProps {
  polygons: Polygon[];
  selectedPolygonId: string | null;
  onSelectPolygon: (id: string | null) => void;
  // Visibility controls — wired through to the same hidden-id set that
  // the PolygonListPanel + canvas use, so toggling here also hides the
  // polyline on the canvas (not just the list row).
  hiddenPolygonIds?: Set<string>;
  onToggleVisibility?: (polygonId: string) => void;
  /**
   * Multi-selection (per-row checkbox), synced with the canvas selection: a row
   * is checked when it is the single selection OR a member of the
   * Shift+left-click multi-select set. Omit to hide the checkboxes.
   */
  selectedPolygonIds?: Set<string>;
  onToggleSelected?: (id: string) => void;
  onSelectAll?: (ids: string[]) => void;
  onClearSelection?: () => void;
  /** Delete a single microtubule polyline (the generic Polygon List is hidden
   *  for MT projects, so delete lives here). Omit to hide the delete button. */
  onDeletePolygon?: (id: string) => void;
  /** Rename a single microtubule (writes `polygon.name`). The backend mirrors
   *  the new name onto every frame of the same trackId, so a rename survives
   *  frame scrubbing. Omit to hide the rename affordance. */
  onRenamePolygon?: (id: string, name: string) => void;
  // ── Type-label palette (SSOT for tubulin class name+colour) ──
  mtTypeLabels?: MTTypeLabel[];
  mtLabelById?: Map<string, MTTypeLabel>;
  /** Canvas colour mode; the header toggle switches it. */
  colorMode?: 'instance' | 'semantic';
  onSetColorMode?: (mode: 'instance' | 'semantic') => void;
  onCreateLabel?: (name: string, color: string) => Promise<MTTypeLabel | null>;
  onRenameLabel?: (id: string, name: string, color: string) => Promise<void>;
  onDeleteLabel?: (id: string) => Promise<void>;
}

const ICON_BUTTON =
  'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100';

/** Same geometry, destructive hue — red is reserved for delete. */
const ICON_BUTTON_DESTRUCTIVE =
  'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:text-gray-400 dark:hover:bg-red-950/50 dark:hover:text-red-400';

/** Small text link in a section header (show all / new label). */
const HEADER_LINK =
  'flex items-center gap-1 rounded px-1.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const MicrotubuleInstancePanel: React.FC<MicrotubuleInstancePanelProps> = ({
  polygons,
  selectedPolygonId,
  onSelectPolygon,
  hiddenPolygonIds,
  onToggleVisibility,
  selectedPolygonIds = new Set<string>(),
  onToggleSelected,
  onSelectAll,
  onClearSelection,
  onDeletePolygon,
  onRenamePolygon,
  mtTypeLabels = [],
  mtLabelById,
  colorMode = 'instance',
  onSetColorMode,
  onCreateLabel,
  onRenameLabel,
  onDeleteLabel,
}) => {
  const { t } = useLanguage();
  // Label-management dialog state: null = closed, 'new' = create, MTTypeLabel = rename.
  const [editingLabel, setEditingLabel] = useState<MTTypeLabel | null | 'new'>(
    null
  );
  // Inline per-instance rename: id of the MT being renamed (null = none) + the
  // in-progress text. Commit on Enter/blur, cancel on Escape.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const commitRename = () => {
    if (renamingId) onRenamePolygon?.(renamingId, renameValue.trim());
    setRenamingId(null);
    setRenameValue('');
  };

  // Defer the (filter + sort) re-derivation when polygons update
  // rapidly (e.g. during playback ticking at 10 FPS). The canvas
  // uses the live `polygons` reference; this panel can lag a frame
  // or two without the user noticing, but unblocks the main thread
  // for the canvas to commit on time.
  const deferredPolygons = useDeferredValue(polygons);

  // A polyline belongs in the MT panel when:
  //   (a) the ML model stamped class='microtubule' on it, OR
  //   (b) it has no partClass (i.e. not sperm) AND an mt_ instanceId
  //       (covers legacy data from before `class` was added).
  const microtubules = useMemo(
    () =>
      deferredPolygons.filter(
        p =>
          p.geometry === 'polyline' &&
          !p.partClass &&
          (p.class === 'microtubule' || isMicrotubuleInstance(p.instanceId))
      ),
    [deferredPolygons]
  );

  // The identifier the EXPORT uses for each microtubule: the badge burned onto
  // the exported image and the `label` column of the metrics table. Built from
  // the unfiltered, unsorted array, because that is exactly what the export
  // parses — first-appearance order of `instanceId`, not this panel's display
  // order. Showing anything else here is why a metrics row could not be traced
  // back to a microtubule (Institut Curie, 2026-09-03); see
  // `utils/instanceLabels.ts`.
  const instanceLabels = useMemo(
    () => buildInstanceLabelMap(deferredPolygons, MICROTUBULE_LABEL_PREFIX),
    [deferredPolygons]
  );

  // Rows are listed in EXPORT-LABEL order, so the panel reads top-to-bottom in
  // the same order as the metrics table and a spreadsheet row can be found by
  // scanning down. That is a deliberate trade against the previous trackId
  // sort, which kept a microtubule at a fixed row position while scrubbing:
  // the label is a per-frame ordinal, so its NUMBER already changes between
  // frames, and holding the row still while the number moved was the more
  // confusing half of the pair.
  //
  // `trackId ?? instanceId` remains the tie-break, so rows that earn no export
  // label (no instanceId, or too few points to draw) keep a stable, defined
  // order at the end of the list instead of shuffling on every render.
  const sorted = useMemo(() => {
    const rank = (p: Polygon): number => {
      const label = p.instanceId ? instanceLabels.get(p.instanceId) : undefined;
      if (!label) return Number.POSITIVE_INFINITY;
      // `MT12` -> 12. Numeric, not lexicographic: a string sort puts MT10
      // between MT1 and MT2.
      const n = Number.parseInt(
        label.slice(MICROTUBULE_LABEL_PREFIX.length),
        10
      );
      return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
    };
    return [...microtubules].sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      // Compared rather than subtracted. `ra - rb` would in fact be correct
      // here — the `!==` guard already excludes the only NaN case,
      // `Infinity - Infinity` — but that is a fact the reader has to derive.
      // A comparison is true on its face and stays true if the guard moves.
      if (ra !== rb) return ra < rb ? -1 : 1;
      return (a.trackId ?? a.instanceId ?? '').localeCompare(
        b.trackId ?? b.instanceId ?? ''
      );
    });
  }, [microtubules, instanceLabels]);

  if (sorted.length === 0) return null;

  const allHidden = sorted.every(mt => hiddenPolygonIds?.has(mt.id) ?? false);
  const handleToggleAll = () => {
    if (!onToggleVisibility) return;
    // Iterating onToggleVisibility per row is the only API we have; the
    // current set drives the direction so a single click reaches a
    // consistent end-state (no flicker between mixed states).
    for (const mt of sorted) {
      const isHidden = hiddenPolygonIds?.has(mt.id) ?? false;
      if (allHidden && isHidden) onToggleVisibility(mt.id);
      else if (!allHidden && !isHidden) onToggleVisibility(mt.id);
    }
  };

  // Multi-selection checkbox column (mirrors PolygonListPanel). Checked when a
  // row is the single selection OR in the Shift+click multi-select set.
  const multiSelectEnabled = !!onToggleSelected;
  const isRowSelected = (id: string) =>
    id === selectedPolygonId || selectedPolygonIds.has(id);
  const selectableIds = sorted.map(mt => mt.id);
  const selectedCount = selectableIds.filter(isRowSelected).length;
  const allSelected = sorted.length > 0 && selectedCount === sorted.length;
  const headerCheckboxState: boolean | 'indeterminate' = allSelected
    ? true
    : selectedCount > 0
      ? 'indeterminate'
      : false;
  const handleHeaderToggle = () => {
    if (allSelected) onClearSelection?.();
    else onSelectAll?.(selectableIds);
  };

  return (
    <div className="shrink-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 dark:bg-gray-900">
      <div className="flex items-center justify-between gap-2 border-b border-gray-200 p-2 dark:border-gray-700">
        <div className="flex min-w-0 items-center gap-2">
          {/* Select-all: toggles every MT into the multi-select set (also
              driven by Shift+left-click on the canvas). */}
          {multiSelectEnabled && sorted.length > 0 && (
            <Checkbox
              checked={headerCheckboxState}
              onCheckedChange={handleHeaderToggle}
              aria-label={
                allSelected
                  ? t('segmentation.selection.deselectAll')
                  : t('segmentation.selection.selectAll')
              }
              title={
                allSelected
                  ? t('segmentation.selection.deselectAll')
                  : t('segmentation.selection.selectAll')
              }
            />
          )}
          <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Spline className="h-4 w-4" />
            {t('microtubule.instancePanel')}{' '}
            <span className="text-xs text-gray-500 dark:text-gray-400">
              ({sorted.length})
            </span>
          </h4>
        </div>
        {onToggleVisibility && (
          <button
            type="button"
            onClick={handleToggleAll}
            className={`${HEADER_LINK} text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200`}
            title={
              allHidden ? t('microtubule.showAll') : t('microtubule.hideAll')
            }
          >
            {allHidden ? (
              <EyeOff className="h-3.5 w-3.5" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
            <span>
              {allHidden ? t('microtubule.showAll') : t('microtubule.hideAll')}
            </span>
          </button>
        )}
      </div>

      {/* Colour-by toggle: Instance (per-trackId hash) vs Label (semantic). A
          view preference only — it does not change stored data. */}
      {onSetColorMode && (
        <div className="flex items-center gap-2 border-b border-gray-200 px-2 py-2 dark:border-gray-700">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {t('microtubule.color.label')}
          </span>
          <div className="inline-flex rounded-md border border-gray-300 dark:border-gray-600 overflow-hidden">
            {(['instance', 'semantic'] as const).map(mode => (
              <button
                key={mode}
                type="button"
                onClick={() => onSetColorMode(mode)}
                aria-pressed={colorMode === mode}
                className={`px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                  colorMode === mode
                    ? 'bg-violet-600 font-medium text-white'
                    : 'bg-transparent text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
                }`}
              >
                {mode === 'instance'
                  ? t('microtubule.color.byInstance')
                  : t('microtubule.color.byLabel')}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="max-h-64 min-h-[6rem] overflow-y-auto">
        {sorted.map((mt, idx) => {
          // trackId is the cross-frame stable key. Same MT keeps the same
          // color when the user scrubs to the next frame.
          const colorKey = mt.trackId ?? mt.instanceId ?? '';
          const instanceColor = colorFromInstanceId(colorKey);
          // The MT's assigned type label (if any) + the swatch colour, which
          // follows the active colour mode so the panel matches the canvas.
          const typeLabel = mt.mtType ? mtLabelById?.get(mt.mtType) : undefined;
          const color =
            colorMode === 'semantic'
              ? (typeLabel?.color ?? 'hsl(0, 0%, 60%)')
              : instanceColor;
          const isSelected = selectedPolygonId === mt.id;
          const isChecked = isSelected || selectedPolygonIds.has(mt.id);
          // Default display name. The EXPORT label ("MT1", …) so this row and
          // the metrics table name the same object; the positional
          // "Microtubule N" survives only for a polyline that earns no badge
          // (no instanceId, or too few points to draw), which is also the case
          // the export leaves blank.
          const exportLabel = mt.instanceId
            ? instanceLabels.get(mt.instanceId)
            : undefined;
          const defaultName =
            exportLabel ?? `${t('microtubule.instance')} ${idx + 1}`;
          const isHidden = hiddenPolygonIds?.has(mt.id) ?? false;
          return (
            <div
              key={mt.id}
              className={`flex items-center gap-1 border-b border-l-2 border-gray-100 px-2 py-1.5 text-xs transition-colors last:border-b-0 dark:border-gray-700 ${
                isSelected
                  ? 'border-l-violet-500 bg-violet-50 dark:bg-violet-900/30'
                  : 'border-l-transparent hover:bg-gray-50 dark:hover:bg-gray-700/50'
              }`}
            >
              {multiSelectEnabled && (
                <Checkbox
                  checked={isChecked}
                  onCheckedChange={() => onToggleSelected?.(mt.id)}
                  aria-label={defaultName}
                  className="flex-shrink-0"
                />
              )}
              {renamingId === mt.id ? (
                <div className="flex flex-1 items-center gap-2">
                  <span
                    className="inline-block w-3 h-3 rounded-sm border border-black/10 dark:border-white/10 flex-shrink-0"
                    style={{ backgroundColor: color }}
                    aria-hidden
                  />
                  <input
                    autoFocus
                    type="text"
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitRename();
                      } else if (e.key === 'Escape') {
                        setRenamingId(null);
                        setRenameValue('');
                      }
                    }}
                    placeholder={defaultName}
                    className="flex-1 min-w-0 px-1 py-0.5 text-xs bg-white dark:bg-gray-900 border border-violet-400 rounded focus:outline-none focus:ring-1 focus:ring-violet-500"
                    aria-label={t('microtubule.renameInstance')}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isHidden ? 'opacity-50' : ''}`}
                  onClick={() => onSelectPolygon(isSelected ? null : mt.id)}
                >
                  <span
                    className="inline-block w-3 h-3 rounded-sm border border-black/10 dark:border-white/10 flex-shrink-0"
                    style={{ backgroundColor: color }}
                    aria-hidden
                  />
                  <span className="font-mono truncate">
                    {mt.name && mt.name.trim() ? mt.name : defaultName}
                  </span>
                  {typeLabel && (
                    <span
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-white truncate max-w-[90px]"
                      style={{ backgroundColor: typeLabel.color }}
                      title={typeLabel.name}
                    >
                      {typeLabel.name}
                    </span>
                  )}
                  <span className="flex-1" />
                  <span className="whitespace-nowrap text-[11px] tabular-nums text-gray-500 dark:text-gray-400">
                    {Math.round(calculatePolylineLength(mt.points))} px
                  </span>
                </button>
              )}
              {onRenamePolygon && renamingId !== mt.id && (
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    setRenamingId(mt.id);
                    setRenameValue(mt.name ?? '');
                  }}
                  className={ICON_BUTTON}
                  aria-label={String(t('microtubule.renameInstance'))}
                  title={String(t('microtubule.renameInstance'))}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
              {onToggleVisibility && (
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    onToggleVisibility(mt.id);
                  }}
                  className={ICON_BUTTON}
                  aria-label={String(
                    isHidden
                      ? t('microtubule.showInstance')
                      : t('microtubule.hideInstance')
                  )}
                  title={String(
                    isHidden
                      ? t('microtubule.showInstance')
                      : t('microtubule.hideInstance')
                  )}
                >
                  {isHidden ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
              {onDeletePolygon && (
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    onDeletePolygon(mt.id);
                  }}
                  className={ICON_BUTTON_DESTRUCTIVE}
                  aria-label={String(t('common.delete'))}
                  title={String(t('common.delete'))}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Type-label management: list of the project's tubulin labels with
          rename / delete, plus a "+" to add. Only shown when the palette
          callbacks are wired (microtubule projects). */}
      {(onCreateLabel || onRenameLabel || onDeleteLabel) && (
        <div className="border-t border-gray-200 dark:border-gray-700">
          <div className="px-3 py-2 flex items-center justify-between">
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
              <Tag className="h-3.5 w-3.5" />
              {t('microtubule.type.manageLabels')}
            </span>
            {onCreateLabel && (
              <button
                type="button"
                onClick={() => setEditingLabel('new')}
                className={`${HEADER_LINK} text-violet-600 hover:bg-violet-50 hover:text-violet-700 dark:text-violet-400 dark:hover:bg-violet-950/40`}
                title={String(t('microtubule.type.newLabel'))}
              >
                <Plus className="h-3.5 w-3.5" />
                <span>{t('microtubule.type.newLabel')}</span>
              </button>
            )}
          </div>
          {mtTypeLabels.length > 0 && (
            <div className="max-h-32 overflow-y-auto pb-1">
              {mtTypeLabels.map(label => (
                <div
                  key={label.id}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-700/50"
                >
                  <span
                    className="inline-block w-3 h-3 rounded-sm border border-black/10 dark:border-white/10 flex-shrink-0"
                    style={{ backgroundColor: label.color }}
                    aria-hidden
                  />
                  <span className="flex-1 truncate">{label.name}</span>
                  {onRenameLabel && (
                    <button
                      type="button"
                      onClick={() => setEditingLabel(label)}
                      className={ICON_BUTTON}
                      aria-label={String(t('microtubule.type.renameLabel'))}
                      title={String(t('microtubule.type.renameLabel'))}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {onDeleteLabel && (
                    <button
                      type="button"
                      onClick={() => onDeleteLabel(label.id)}
                      className={ICON_BUTTON_DESTRUCTIVE}
                      aria-label={String(t('microtubule.type.deleteLabel'))}
                      title={String(t('microtubule.type.deleteLabel'))}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <MtTypeLabelDialog
        open={editingLabel !== null}
        onOpenChange={open => {
          if (!open) setEditingLabel(null);
        }}
        mode={editingLabel === 'new' ? 'create' : 'rename'}
        initialName={
          editingLabel && editingLabel !== 'new' ? editingLabel.name : ''
        }
        initialColor={
          editingLabel && editingLabel !== 'new'
            ? editingLabel.color
            : undefined
        }
        onConfirm={(name, color) => {
          if (editingLabel === 'new') {
            void onCreateLabel?.(name, color);
          } else if (editingLabel) {
            void onRenameLabel?.(editingLabel.id, name, color);
          }
          setEditingLabel(null);
        }}
      />
    </div>
  );
};

export default MicrotubuleInstancePanel;
