import React from 'react';
import type { SegmenterClass } from '@/lib/segmenterApi';
import { cn } from '@/lib/utils';
import ClassManagerPanel from '../../components/ClassManagerPanel';

interface ActiveClassPickerProps {
  classes: SegmenterClass[];
  loading: boolean;
  activeClassId: string | null;
  onSelectActive: (id: string) => void;
  onCreateClass: (
    name: string,
    color: string
  ) => Promise<SegmenterClass | null>;
  onRenameClass: (id: string, name: string, color: string) => Promise<void>;
  onDeleteClass: (id: string) => Promise<void>;
}

/**
 * Active-class selector for drawing new polygons (click a swatch to make it
 * the class stamped onto the next `CreatePolygon`), plus the full class
 * CRUD panel (`ClassManagerPanel`, reused as-is from the dataset-detail
 * page) so a missing class can be added without leaving the editor.
 */
const ActiveClassPicker: React.FC<ActiveClassPickerProps> = ({
  classes,
  loading,
  activeClassId,
  onSelectActive,
  onCreateClass,
  onRenameClass,
  onDeleteClass,
}) => {
  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3">
        <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Active class
        </div>
        {classes.length === 0 ? (
          <p className="text-xs text-gray-400 dark:text-gray-500">
            No classes yet — create one below before drawing.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {classes.map(cls => (
              <button
                key={cls.id}
                type="button"
                onClick={() => onSelectActive(cls.id)}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors',
                  activeClassId === cls.id
                    ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300'
                    : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                )}
                aria-pressed={activeClassId === cls.id}
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full border border-black/10 dark:border-white/10"
                  style={{ backgroundColor: cls.color }}
                  aria-hidden
                />
                {cls.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <ClassManagerPanel
        classes={classes}
        loading={loading}
        onCreateClass={onCreateClass}
        onRenameClass={onRenameClass}
        onDeleteClass={onDeleteClass}
      />
    </div>
  );
};

export default ActiveClassPicker;
