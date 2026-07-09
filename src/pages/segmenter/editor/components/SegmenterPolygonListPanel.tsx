import React, { useMemo } from 'react';
import { Trash2 } from 'lucide-react';
import type { SegmenterClass, SegmenterPolygon } from '@/lib/segmenterApi';
import { cn } from '@/lib/utils';
import { resolveClassColor, resolveClassName } from '../utils/classColor';

interface SegmenterPolygonListPanelProps {
  polygons: SegmenterPolygon[];
  classes: SegmenterClass[];
  selectedPolygonId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onChangeClass: (id: string, classId: string | null) => void;
}

interface InstanceGroup {
  instanceId: string;
  polygons: SegmenterPolygon[];
}

/**
 * Generic polygon list panel: groups polygons by `instanceId` (defaulting
 * to the polygon's own id, matching the editor's "one instance per
 * polygon" default per the P0 spec — instances are independent by
 * default), coloured by `classId`. Merges the role
 * `PolygonListPanel`/`MicrotubuleInstancePanel` play in the reused editor
 * into one generic panel since there is no per-project-type distinction
 * here — just an arbitrary class registry.
 */
const SegmenterPolygonListPanel: React.FC<SegmenterPolygonListPanelProps> = ({
  polygons,
  classes,
  selectedPolygonId,
  onSelect,
  onDelete,
  onChangeClass,
}) => {
  const groups = useMemo<InstanceGroup[]>(() => {
    const map = new Map<string, SegmenterPolygon[]>();
    for (const polygon of polygons) {
      const key = polygon.instanceId ?? polygon.id;
      const list = map.get(key);
      if (list) list.push(polygon);
      else map.set(key, [polygon]);
    }
    return Array.from(map.entries()).map(([instanceId, list]) => ({
      instanceId,
      polygons: list,
    }));
  }, [polygons]);

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300">
        Polygons ({polygons.length})
      </div>
      {groups.length === 0 ? (
        <div className="px-3 py-4 text-sm text-gray-400 dark:text-gray-500">
          No polygons yet. Switch to “Draw polygon” and click on the image.
        </div>
      ) : (
        <div className="max-h-[60vh] overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800">
          {groups.map(group => (
            <div key={group.instanceId}>
              {group.polygons.length > 1 && (
                <div className="px-3 pt-2 text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
                  Instance {group.instanceId.slice(0, 8)}
                </div>
              )}
              {group.polygons.map(polygon => {
                const color = resolveClassColor(polygon.classId, classes);
                const isSelected = polygon.id === selectedPolygonId;
                return (
                  <div
                    key={polygon.id}
                    onClick={() => onSelect(polygon.id)}
                    className={cn(
                      'flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer',
                      isSelected
                        ? 'bg-violet-50 dark:bg-violet-950/30'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                    )}
                  >
                    <span
                      className="inline-block h-3 w-3 flex-shrink-0 rounded-sm border border-black/10 dark:border-white/10"
                      style={{ backgroundColor: color }}
                      aria-hidden
                    />
                    <span className="flex-1 truncate">
                      {resolveClassName(polygon.classId, classes)}
                      <span className="ml-1 text-gray-400 dark:text-gray-500">
                        · {polygon.points.length} pts
                      </span>
                    </span>
                    <select
                      value={polygon.classId ?? ''}
                      onClick={e => e.stopPropagation()}
                      onChange={e =>
                        onChangeClass(polygon.id, e.target.value || null)
                      }
                      className="flex-shrink-0 rounded border border-gray-200 dark:border-gray-700 bg-transparent text-xs px-1 py-0.5 max-w-[6.5rem]"
                      aria-label="Change class"
                    >
                      <option value="">Unclassified</option>
                      {classes.map(cls => (
                        <option key={cls.id} value={cls.id}>
                          {cls.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        onDelete(polygon.id);
                      }}
                      className="flex-shrink-0 p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                      aria-label="Delete polygon"
                      title="Delete polygon"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SegmenterPolygonListPanel;
