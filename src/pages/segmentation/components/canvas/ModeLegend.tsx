import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Scissors, Edit3, Trash2 } from 'lucide-react';

interface ModeLegendProps {
  editMode: boolean;
  slicingMode: boolean;
  pointAddingMode: boolean;
  deleteMode: boolean;
}

/**
 * Floating legend showing the current active mode
 */
const ModeLegend: React.FC<ModeLegendProps> = ({
  editMode,
  slicingMode,
  pointAddingMode,
  deleteMode,
}) => {
  const getCurrentMode = () => {
    if (editMode)
      return { label: 'Create Polygon', icon: Plus, color: 'purple' };
    if (slicingMode)
      return { label: 'Slice Polygon', icon: Scissors, color: 'red' };
    if (pointAddingMode)
      return { label: 'Add Points', icon: Edit3, color: 'emerald' };
    if (deleteMode)
      return { label: 'Delete Polygon', icon: Trash2, color: 'orange' };
    return null;
  };

  const currentMode = getCurrentMode();

  return (
    <AnimatePresence>
      {currentMode && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.2 }}
          className="absolute top-4 left-4 z-10 pointer-events-none"
        >
          <div
            className={`flex items-center space-x-2 px-3 py-2 rounded-lg shadow-lg border backdrop-blur-sm transition-all duration-200 ${
              currentMode.color === 'purple'
                ? 'bg-purple-100/90 dark:bg-purple-900/90 border-purple-300 dark:border-purple-600 text-purple-800 dark:text-purple-200'
                : currentMode.color === 'red'
                  ? 'bg-red-100/90 dark:bg-red-900/90 border-red-300 dark:border-red-600 text-red-800 dark:text-red-200'
                  : currentMode.color === 'emerald'
                    ? 'bg-emerald-100/90 dark:bg-emerald-900/90 border-emerald-300 dark:border-emerald-600 text-emerald-800 dark:text-emerald-200'
                    : 'bg-orange-100/90 dark:bg-orange-900/90 border-orange-300 dark:border-orange-600 text-orange-800 dark:text-orange-200'
            }`}
          >
            <currentMode.icon className="h-4 w-4" />
            <span className="text-sm font-medium">{currentMode.label}</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default ModeLegend;
