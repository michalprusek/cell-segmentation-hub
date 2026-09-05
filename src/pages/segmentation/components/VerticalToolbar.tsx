import React from 'react';
import { Button } from '@/components/ui/button';
import {
  MousePointer,
  Edit3,
  Plus,
  Pentagon,
  Spline,
  Scissors,
  Trash2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  type LucideIcon,
} from 'lucide-react';
import { useLanguage } from '@/contexts/useLanguage';
import { EditMode } from '../types';
import { annotationGeometryForProjectType } from '@/lib/polylineSemantics';

interface VerticalToolbarProps {
  editMode: EditMode;
  selectedPolygonId: string | null;
  setEditMode: (mode: EditMode) => void;
  disabled?: boolean;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onResetView?: () => void;
  hasExistingPolygons?: boolean;
  /** Project type, deciding WHICH create tool is offered. A project annotates
   *  exactly one geometry, so the other button is not rendered at all — see
   *  `annotationGeometryForProjectType`.
   *
   *  Undefined keeps BOTH, which is both the pre-prop behaviour and the state
   *  every mount passes through: `projectType` arrives with the `useProjectData`
   *  fetch, so the rail can show two create tools for one paint and then
   *  settle. Failing open is deliberate — a rail with no create tool at all
   *  would be a worse regression than a brief extra one. */
  projectType?: string | null;
}

/**
 * One record per edit mode instead of four parallel `switch` statements.
 * Keeping icon + hue + i18n key + shortcut together makes it impossible for
 * the "active" colour and the "hover" colour of a mode to drift apart, which
 * is what happened while they lived in separate functions.
 *
 * `bar` is the rail-edge indicator: a solid 3 px stripe painted on the active
 * tool. The tinted background alone is too subtle to answer "which tool is
 * armed?" at a glance — especially the neutral View mode in dark theme, where
 * `bg-gray-600` on a `bg-gray-900` rail is nearly invisible.
 */
interface ModeAccent {
  icon: LucideIcon;
  labelKey: string;
  shortcut: string;
  /** Idle hover treatment. */
  idle: string;
  /** Active (armed) treatment — background + ring + icon colour. */
  active: string;
  /** Rail-edge indicator stripe colour when active. */
  bar: string;
}

const MODE_ACCENTS: Record<EditMode, ModeAccent> = {
  [EditMode.View]: {
    icon: MousePointer,
    labelKey: 'segmentation.mode.view',
    shortcut: 'V',
    idle: 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white',
    active:
      'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white ring-1 ring-inset ring-gray-400 dark:ring-gray-500',
    bar: 'bg-gray-500 dark:bg-gray-300',
  },
  [EditMode.EditVertices]: {
    icon: Edit3,
    labelKey: 'segmentation.mode.editVertices',
    shortcut: 'E',
    idle: 'text-gray-600 dark:text-gray-300 hover:bg-purple-100 dark:hover:bg-purple-900/40 hover:text-purple-700 dark:hover:text-purple-200',
    active:
      'bg-purple-100 dark:bg-purple-900/60 text-purple-700 dark:text-purple-100 ring-1 ring-inset ring-purple-400 dark:ring-purple-500',
    bar: 'bg-purple-500',
  },
  [EditMode.AddPoints]: {
    icon: Plus,
    labelKey: 'segmentation.mode.addPoints',
    shortcut: 'A',
    idle: 'text-gray-600 dark:text-gray-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 hover:text-emerald-700 dark:hover:text-emerald-200',
    active:
      'bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-100 ring-1 ring-inset ring-emerald-400 dark:ring-emerald-500',
    bar: 'bg-emerald-500',
  },
  [EditMode.CreatePolygon]: {
    icon: Pentagon,
    labelKey: 'segmentation.mode.createPolygon',
    shortcut: 'N',
    idle: 'text-gray-600 dark:text-gray-300 hover:bg-blue-100 dark:hover:bg-blue-900/40 hover:text-blue-700 dark:hover:text-blue-200',
    active:
      'bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-100 ring-1 ring-inset ring-blue-400 dark:ring-blue-500',
    bar: 'bg-blue-500',
  },
  [EditMode.CreatePolyline]: {
    icon: Spline,
    labelKey: 'segmentation.mode.createPolyline',
    shortcut: 'P',
    idle: 'text-gray-600 dark:text-gray-300 hover:bg-violet-100 dark:hover:bg-violet-900/40 hover:text-violet-700 dark:hover:text-violet-200',
    active:
      'bg-violet-100 dark:bg-violet-900/60 text-violet-700 dark:text-violet-100 ring-1 ring-inset ring-violet-400 dark:ring-violet-500',
    bar: 'bg-violet-500',
  },
  [EditMode.Slice]: {
    icon: Scissors,
    labelKey: 'segmentation.mode.slice',
    shortcut: 'S',
    idle: 'text-gray-600 dark:text-gray-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 hover:text-amber-700 dark:hover:text-amber-200',
    active:
      'bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-100 ring-1 ring-inset ring-amber-400 dark:ring-amber-500',
    bar: 'bg-amber-500',
  },
  [EditMode.DeletePolygon]: {
    icon: Trash2,
    labelKey: 'segmentation.mode.deletePolygon',
    shortcut: 'D',
    idle: 'text-gray-600 dark:text-gray-300 hover:bg-red-100 dark:hover:bg-red-900/40 hover:text-red-700 dark:hover:text-red-300',
    active:
      'bg-red-100 dark:bg-red-900/60 text-red-700 dark:text-red-100 ring-1 ring-inset ring-red-500 dark:ring-red-500',
    bar: 'bg-red-500',
  },
};

/** Tooltip shell shared by the mode buttons and the zoom controls. */
const RAIL_TOOLTIP =
  'pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 ' +
  'whitespace-nowrap rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm ' +
  'text-white shadow-lg opacity-0 transition-opacity duration-150 ' +
  'group-hover:opacity-100 group-focus-within:opacity-100 ' +
  'dark:border-gray-600 dark:bg-gray-800';

const RAIL_TOOLTIP_ARROW =
  'absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent ' +
  'border-r-gray-900 dark:border-r-gray-800';

/** Shared geometry for every rail button so the column stays a straight line. */
const RAIL_BUTTON = 'h-11 w-11 rounded-lg transition-colors duration-150';

interface ModeButtonProps {
  mode: EditMode;
  editMode: EditMode;
  selectedPolygonId: string | null;
  disabled: boolean;
  setEditMode: (mode: EditMode) => void;
  t: (key: string, options?: Record<string, unknown>) => string | string[];
}

const isRequiredSelectionMode = (mode: EditMode) =>
  mode === EditMode.EditVertices || mode === EditMode.AddPoints;

/**
 * Declared at module scope (not inside VerticalToolbar): a component defined
 * in a render body is a new type on every render, so React unmounts and
 * remounts the whole rail whenever the edit mode changes — which throws away
 * keyboard focus mid-Tab. The rail is a keyboard surface; it has to survive.
 */
const ModeButton: React.FC<ModeButtonProps> = ({
  mode,
  editMode,
  selectedPolygonId,
  disabled,
  setEditMode,
  t,
}) => {
  const accent = MODE_ACCENTS[mode];
  const Icon = accent.icon;
  const label = String(t(accent.labelKey));
  const isActive = editMode === mode;
  const requiresSelection = isRequiredSelectionMode(mode);
  const awaitingSelection = requiresSelection && !selectedPolygonId;
  const canActivate = !disabled && !awaitingSelection;

  return (
    <div className="group relative flex w-full justify-center">
      {/* Rail-edge indicator — the unambiguous "this tool is armed" mark. */}
      {isActive && (
        <span
          aria-hidden
          className={`absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full ${accent.bar}`}
        />
      )}
      <Button
        variant="ghost"
        size="icon"
        disabled={!canActivate}
        aria-pressed={isActive}
        aria-label={label}
        onClick={() => {
          if (!canActivate) return;
          // Clicking the armed tool disarms it back to View.
          setEditMode(isActive ? EditMode.View : mode);
        }}
        className={`${RAIL_BUTTON} relative ${isActive ? accent.active : accent.idle}`}
      >
        <Icon size={20} />
        {awaitingSelection && (
          // A state, not an alarm: the old `animate-pulse` ran forever and
          // read as an unresolved error. A static ringed dot says the same
          // thing without hijacking attention on every frame.
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-orange-500 ring-2 ring-white dark:ring-gray-900"
          />
        )}
      </Button>

      {/* Tooltip — also shown on keyboard focus (group-focus-within), since
          this editor is driven mostly from the keyboard. `aria-hidden`: the
          button already carries the same text as its accessible name, and a
          screen reader would otherwise read it twice. */}
      <div className={RAIL_TOOLTIP} aria-hidden>
        <div className="font-medium">{label}</div>
        <div className="mt-1 text-xs text-gray-300 dark:text-gray-400">
          {t('segmentation.toolbar.keyboard', { key: accent.shortcut })}
        </div>
        {awaitingSelection && (
          <div className="mt-1 text-xs text-orange-300">
            {t('segmentation.toolbar.requiresSelection')}
          </div>
        )}
        <div className={RAIL_TOOLTIP_ARROW} />
      </div>
    </div>
  );
};

interface ViewButtonProps {
  icon: LucideIcon;
  label: string;
  shortcut: string;
  disabled: boolean;
  onClick?: () => void;
}

const ViewButton: React.FC<ViewButtonProps> = ({
  icon: Icon,
  label,
  shortcut,
  disabled,
  onClick,
}) => (
  <div className="group relative flex w-full justify-center">
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`${RAIL_BUTTON} text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white`}
    >
      <Icon size={20} />
    </Button>
    <div className={RAIL_TOOLTIP} aria-hidden>
      <div className="font-medium">{label}</div>
      <div className="mt-1 text-xs text-gray-300 dark:text-gray-400">
        {shortcut}
      </div>
      <div className={RAIL_TOOLTIP_ARROW} />
    </div>
  </div>
);

/**
 * Vertikální toolbar s ikonkami pro jednotlivé edit modes.
 */
const VerticalToolbar: React.FC<VerticalToolbarProps> = ({
  editMode,
  selectedPolygonId,
  setEditMode,
  disabled = false,
  onZoomIn,
  onZoomOut,
  onResetView,
  hasExistingPolygons: _hasExistingPolygons = false,
  projectType,
}) => {
  // null = type not loaded yet, or unrecognised → offer both; see the prop doc.
  const geometry = annotationGeometryForProjectType(projectType);
  const { t } = useLanguage();

  return (
    <div className="flex w-14 flex-col items-center gap-1 border-r border-gray-200 bg-white py-4 dark:border-gray-700 dark:bg-gray-900">
      {/* Resegment lives in TopToolbar now (next to Undo/Redo). */}

      {/* Mode buttons */}
      <ModeButton
        mode={EditMode.View}
        editMode={editMode}
        selectedPolygonId={selectedPolygonId}
        disabled={disabled}
        setEditMode={setEditMode}
        t={t}
      />
      <ModeButton
        mode={EditMode.EditVertices}
        editMode={editMode}
        selectedPolygonId={selectedPolygonId}
        disabled={disabled}
        setEditMode={setEditMode}
        t={t}
      />
      <ModeButton
        mode={EditMode.AddPoints}
        editMode={editMode}
        selectedPolygonId={selectedPolygonId}
        disabled={disabled}
        setEditMode={setEditMode}
        t={t}
      />
      {geometry !== 'polyline' && (
        <ModeButton
          mode={EditMode.CreatePolygon}
          editMode={editMode}
          selectedPolygonId={selectedPolygonId}
          disabled={disabled}
          setEditMode={setEditMode}
          t={t}
        />
      )}
      {geometry !== 'polygon' && (
        <ModeButton
          mode={EditMode.CreatePolyline}
          editMode={editMode}
          selectedPolygonId={selectedPolygonId}
          disabled={disabled}
          setEditMode={setEditMode}
          t={t}
        />
      )}
      <ModeButton
        mode={EditMode.Slice}
        editMode={editMode}
        selectedPolygonId={selectedPolygonId}
        disabled={disabled}
        setEditMode={setEditMode}
        t={t}
      />

      {/* Destructive tools sit in their own group: a delete-on-click mode
          should never be one mis-aimed pixel away from a drawing tool. */}
      <div className="my-1 h-px w-8 bg-gray-200 dark:bg-gray-700" />
      <ModeButton
        mode={EditMode.DeletePolygon}
        editMode={editMode}
        selectedPolygonId={selectedPolygonId}
        disabled={disabled}
        setEditMode={setEditMode}
        t={t}
      />

      {/* Separator */}
      <div className="my-2 h-px w-8 bg-gray-200 dark:bg-gray-700" />

      {/* Zoom controls */}
      <ViewButton
        icon={ZoomIn}
        disabled={disabled}
        label={String(t('segmentation.toolbar.zoomIn'))}
        shortcut="+"
        onClick={onZoomIn}
      />
      <ViewButton
        icon={ZoomOut}
        disabled={disabled}
        label={String(t('segmentation.toolbar.zoomOut'))}
        shortcut="-"
        onClick={onZoomOut}
      />
      <ViewButton
        icon={Maximize2}
        disabled={disabled}
        label={String(t('segmentation.toolbar.resetView'))}
        shortcut="R"
        onClick={onResetView}
      />
    </div>
  );
};

export default VerticalToolbar;
