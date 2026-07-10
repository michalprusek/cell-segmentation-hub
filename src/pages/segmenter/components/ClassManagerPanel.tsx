import React, { useState } from 'react';
import { Tag, Plus, Pencil, Trash2 } from 'lucide-react';
import type { SegmenterClass } from '@/lib/segmenterApi';
import { useLanguage } from '@/contexts/exports';
import ClassLabelDialog from './ClassLabelDialog';

interface ClassManagerPanelProps {
  classes: SegmenterClass[];
  loading?: boolean;
  onCreateClass: (
    name: string,
    color: string
  ) => Promise<SegmenterClass | null>;
  onRenameClass: (id: string, name: string, color: string) => Promise<void>;
  onDeleteClass: (id: string) => Promise<void>;
}

/**
 * Standalone panel to create / rename / delete a dataset's class palette.
 * Generic fork of the label-management section embedded in
 * `@/pages/segmentation/components/MicrotubuleInstancePanel.tsx` (the
 * "manage labels" block at the bottom of that panel), lifted out into its
 * own component since the segmenter dashboard has no polygon list to attach
 * it to.
 */
const ClassManagerPanel: React.FC<ClassManagerPanelProps> = ({
  classes,
  loading = false,
  onCreateClass,
  onRenameClass,
  onDeleteClass,
}) => {
  const { t } = useLanguage();
  // Dialog state: null = closed, 'new' = create, SegmenterClass = rename.
  const [editingClass, setEditingClass] = useState<
    SegmenterClass | null | 'new'
  >(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    if (deletingId) return;
    setDeletingId(id);
    try {
      await onDeleteClass(id);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
      <div className="px-3 py-2 flex items-center justify-between border-b border-gray-200 dark:border-gray-700">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
          <Tag className="h-4 w-4" />
          {t('segmenter.classes.panelTitle')}
        </span>
        <button
          type="button"
          onClick={() => setEditingClass('new')}
          className="flex items-center gap-1 text-sm text-violet-600 hover:text-violet-700 dark:text-violet-400 transition-colors"
          title={t('segmenter.classes.newClass') as string}
        >
          <Plus className="h-4 w-4" />
          <span>{t('segmenter.classes.newClass')}</span>
        </button>
      </div>

      {loading ? (
        <div className="px-3 py-4 text-sm text-gray-400 dark:text-gray-500">
          {t('segmenter.classes.loading')}
        </div>
      ) : classes.length === 0 ? (
        <div className="px-3 py-4 text-sm text-gray-400 dark:text-gray-500">
          {t('segmenter.classes.empty')}
        </div>
      ) : (
        <div className="max-h-64 overflow-y-auto py-1">
          {classes.map(cls => (
            <div
              key={cls.id}
              className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800/50"
            >
              <span
                className="inline-block w-3.5 h-3.5 rounded-sm border border-black/10 dark:border-white/10 flex-shrink-0"
                style={{ backgroundColor: cls.color }}
                aria-hidden
              />
              <span className="flex-1 truncate">{cls.name}</span>
              <button
                type="button"
                onClick={() => setEditingClass(cls)}
                className="p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors flex-shrink-0"
                aria-label={t('segmenter.classes.renameLabel') as string}
                title={t('segmenter.classes.renameLabel') as string}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => handleDelete(cls.id)}
                disabled={deletingId === cls.id}
                className="p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors flex-shrink-0 disabled:opacity-50"
                aria-label={t('segmenter.classes.deleteLabel') as string}
                title={t('segmenter.classes.deleteLabel') as string}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <ClassLabelDialog
        open={editingClass !== null}
        onOpenChange={open => {
          if (!open) setEditingClass(null);
        }}
        mode={editingClass === 'new' ? 'create' : 'rename'}
        initialName={
          editingClass && editingClass !== 'new' ? editingClass.name : ''
        }
        initialColor={
          editingClass && editingClass !== 'new'
            ? editingClass.color
            : undefined
        }
        onConfirm={(name, color) => {
          if (editingClass === 'new') {
            void onCreateClass(name, color);
          } else if (editingClass) {
            void onRenameClass(editingClass.id, name, color);
          }
          setEditingClass(null);
        }}
      />
    </div>
  );
};

export default ClassManagerPanel;
