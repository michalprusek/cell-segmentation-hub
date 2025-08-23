import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Keyboard, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/useLanguage';

interface KeyboardShortcutsHelpProps {
  className?: string;
}

const KeyboardShortcutsHelp: React.FC<KeyboardShortcutsHelpProps> = ({
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const { t } = useLanguage();

  const shortcuts = [
    { key: 'V', description: t('keyboardShortcuts.viewMode') },
    { key: 'E', description: t('keyboardShortcuts.editVertices') },
    { key: 'A', description: t('keyboardShortcuts.addPoints') },
    { key: 'N', description: t('keyboardShortcuts.createPolygon') },
    { key: 'S', description: t('keyboardShortcuts.sliceMode') },
    { key: 'D', description: t('keyboardShortcuts.deleteMode') },
    { key: 'Shift', description: t('keyboardShortcuts.holdToAutoAdd') },
    { key: 'Ctrl+Z', description: t('keyboardShortcuts.undo') },
    { key: 'Ctrl+Y', description: t('keyboardShortcuts.redo') },
    { key: 'Delete', description: t('keyboardShortcuts.deleteSelected') },
    { key: 'Esc', description: t('keyboardShortcuts.cancelOperation') },
    { key: '+', description: t('keyboardShortcuts.zoomIn') },
    { key: '-', description: t('keyboardShortcuts.zoomOut') },
    { key: 'R', description: t('keyboardShortcuts.resetView') },
  ];

  return (
    <div className={`${className}`}>
      <Button
        className="flex items-center gap-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg"
        size="sm"
        onClick={() => setIsOpen(true)}
      >
        <Keyboard className="h-4 w-4" />
        <span className="hidden sm:inline">
          {t('keyboardShortcuts.buttonLabel')}
        </span>
      </Button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsOpen(false)}
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
                  {t('keyboardShortcuts.title')}
                </h3>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setIsOpen(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="grid gap-3">
                {shortcuts.map((shortcut, index) => (
                  <motion.div
                    key={index}
                    className="flex items-center gap-3"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.03 }}
                  >
                    <div className="bg-gray-100 dark:bg-gray-700 rounded px-2.5 py-1 font-mono text-sm min-w-16 text-center">
                      {shortcut.key}
                    </div>
                    <div className="text-sm text-gray-700 dark:text-gray-300">
                      {shortcut.description}
                    </div>
                  </motion.div>
                ))}
              </div>

              <div className="mt-5 text-xs text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700 pt-3">
                {t('keyboardShortcuts.helperText')}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default KeyboardShortcutsHelp;
