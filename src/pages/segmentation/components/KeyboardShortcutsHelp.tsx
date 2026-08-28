import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Keyboard, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/exports';

interface KeyboardShortcutsHelpProps {
  className?: string;
  isOpen?: boolean;
  onToggle?: (open: boolean) => void;
}

const KeyboardShortcutsHelp: React.FC<KeyboardShortcutsHelpProps> = ({
  className = '',
  isOpen: externalIsOpen,
  onToggle,
}) => {
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const isOpen = externalIsOpen !== undefined ? externalIsOpen : internalIsOpen;
  const { t } = useLanguage();

  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const handleToggle = (open: boolean) => {
    if (onToggle) {
      onToggle(open);
    } else {
      setInternalIsOpen(open);
    }
  };

  // Escape used to fall through to the editor's global key handler, which
  // switched the edit mode underneath while this overlay stayed open. Own the
  // key while we are on top, and park focus on Close so the sheet is
  // dismissible without a mouse.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        handleToggle(false);
      }
    };
    const previouslyFocused = document.activeElement as HTMLElement | null;
    window.addEventListener('keydown', onKeyDown, true);
    closeButtonRef.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      // Hand focus back where it came from; otherwise closing the sheet drops
      // the user at <body> and they have to Tab in from the top of the editor.
      previouslyFocused?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Organized shortcuts by category
  const shortcutCategories = [
    {
      title: t('segmentation.shortcuts.categories.modes'),
      shortcuts: [
        { key: 'V', description: t('segmentation.shortcuts.viewMode') },
        {
          key: 'E',
          description: t('segmentation.shortcuts.editVertices'),
          condition: t('segmentation.shortcuts.requiresSelection'),
        },
        {
          key: 'A',
          description: t('segmentation.shortcuts.addPoints'),
          condition: t('segmentation.shortcuts.requiresSelection'),
        },
        { key: 'N', description: t('segmentation.shortcuts.createPolygon') },
        { key: 'P', description: t('segmentation.mode.createPolyline') },
        { key: 'S', description: t('segmentation.shortcuts.sliceMode') },
        { key: 'D', description: t('segmentation.shortcuts.deleteMode') },
      ],
    },
    {
      title: t('segmentation.shortcuts.categories.actions'),
      shortcuts: [
        { key: 'Ctrl+S', description: t('segmentation.shortcuts.save') },
        { key: 'Ctrl+Z', description: t('segmentation.shortcuts.undo') },
        { key: 'Ctrl+Y', description: t('segmentation.shortcuts.redo') },
        {
          key: 'Delete',
          description: t('segmentation.shortcuts.deleteSelected'),
          condition: t('segmentation.shortcuts.requiresSelection'),
        },
        { key: 'Enter', description: t('segmentation.shortcuts.finishShape') },
      ],
    },
    {
      title: t('segmentation.shortcuts.categories.view'),
      shortcuts: [
        { key: '+/-', description: t('segmentation.shortcuts.zoom') },
        { key: 'R', description: t('segmentation.shortcuts.resetView') },
        { key: '0', description: t('segmentation.shortcuts.fitToScreen') },
      ],
    },
    {
      title: t('segmentation.shortcuts.categories.navigation'),
      shortcuts: [
        { key: 'Tab', description: t('segmentation.shortcuts.cycleModes') },
        {
          key: 'Shift+Tab',
          description: t('segmentation.shortcuts.cycleModesReverse'),
        },
        { key: 'Escape', description: t('segmentation.shortcuts.cancel') },
        { key: 'H / ?', description: t('segmentation.shortcuts.showHelp') },
      ],
    },
  ];

  return (
    <div className={`${className}`}>
      <Button
        className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-100 text-gray-700 hover:bg-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
        size="sm"
        aria-haspopup="dialog"
        onClick={() => handleToggle(true)}
      >
        <Keyboard className="h-4 w-4" />
        <span className="hidden sm:inline">
          {t('segmentation.shortcuts.buttonText')}
        </span>
      </Button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => handleToggle(false)}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label={String(t('segmentation.shortcuts.title'))}
              className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-gray-900"
              initial={{ scale: 0.97, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.97, opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={e => e.stopPropagation()}
            >
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-medium">
                  {t('segmentation.shortcuts.title')}
                </h3>
                <Button
                  ref={closeButtonRef}
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label={String(t('common.cancel'))}
                  onClick={() => handleToggle(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
                {shortcutCategories.map((category, categoryIndex) => (
                  <div key={categoryIndex} className="space-y-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      {category.title}
                    </h4>
                    <div className="grid gap-2">
                      {category.shortcuts.map((shortcut, index) => (
                        <motion.div
                          key={index}
                          className="flex items-start gap-3"
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{
                            duration: 0.15,
                            delay: Math.min(index, 6) * 0.015,
                          }}
                        >
                          <kbd className="min-w-16 flex-shrink-0 rounded border border-gray-300 bg-gray-100 px-2.5 py-1 text-center font-mono text-xs font-medium text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200">
                            {shortcut.key}
                          </kbd>
                          <div className="text-sm text-gray-700 dark:text-gray-300">
                            <div>{shortcut.description}</div>
                            {shortcut.condition && (
                              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                {shortcut.condition}
                              </div>
                            )}
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-5 text-xs text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700 pt-3">
                {t('segmentation.shortcuts.footerNote')}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default KeyboardShortcutsHelp;
