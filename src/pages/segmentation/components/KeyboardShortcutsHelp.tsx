import React, { useState } from 'react';
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

  const handleToggle = (open: boolean) => {
    if (onToggle) {
      onToggle(open);
    } else {
      setInternalIsOpen(open);
    }
  };

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
        {
          key: 'S',
          description: t('segmentation.shortcuts.sliceMode'),
          condition: t('segmentation.shortcuts.requiresSelection'),
        },
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
        className="flex items-center gap-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg"
        size="sm"
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
              className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 max-w-md w-full"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={e => e.stopPropagation()}
            >
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-medium">
                  {t('segmentation.shortcuts.title')}
                </h3>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => handleToggle(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="space-y-4 max-h-80 overflow-y-auto">
                {shortcutCategories.map((category, categoryIndex) => (
                  <div key={categoryIndex} className="space-y-2">
                    <h4 className="text-md font-semibold text-gray-800 dark:text-gray-200">
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
                            delay:
                              (categoryIndex * category.shortcuts.length +
                                index) *
                              0.02,
                          }}
                        >
                          <div className="bg-gray-100 dark:bg-gray-700 rounded px-2.5 py-1 font-mono text-sm min-w-16 text-center flex-shrink-0">
                            {shortcut.key}
                          </div>
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
