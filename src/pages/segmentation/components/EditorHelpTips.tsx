import React from 'react';
import { motion } from 'framer-motion';
import { Info } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

interface EditorHelpTipsProps {
  editMode: boolean;
  slicingMode: boolean;
  pointAddingMode: boolean;
}

const EditorHelpTips = ({
  editMode,
  slicingMode,
  pointAddingMode,
}: EditorHelpTipsProps) => {
  const { t } = useLanguage();
  const tipVariants = {
    initial: { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0, transition: { duration: 0.3 } },
    exit: { opacity: 0, y: 10, transition: { duration: 0.2 } },
  };

  const getHelpTips = () => {
    if (editMode) {
      return t('segmentation.helpTips.editMode');
    }
    if (slicingMode) {
      return t('segmentation.helpTips.slicingMode');
    }
    if (pointAddingMode) {
      return t('segmentation.helpTips.pointAddingMode');
    }
    return [];
  };

  const tips = getHelpTips();

  if (tips.length === 0) return null;

  return (
    <motion.div
      className="absolute top-4 right-4 bg-gray-900/80 dark:bg-gray-800/90 backdrop-blur-sm text-white p-4 rounded-lg shadow-xl max-w-xs"
      initial="initial"
      animate="animate"
      exit="exit"
      variants={tipVariants}
    >
      <div className="flex items-center mb-2 border-b border-gray-700 pb-2">
        <Info className="h-5 w-5 mr-2 text-blue-400" />
        <span className="font-medium">{t('segmentation.tips.header')}</span>
      </div>
      <ul className="space-y-2 text-sm">
        {tips.map((tip, index) => (
          <motion.li
            key={index}
            className="flex items-start"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 * index }}
          >
            <span className="inline-flex items-center justify-center bg-blue-500 text-white rounded-full h-5 w-5 text-xs mr-2 flex-shrink-0 mt-0.5">
              {index + 1}
            </span>
            <span className="text-gray-200">{tip}</span>
          </motion.li>
        ))}
      </ul>
    </motion.div>
  );
};

export default EditorHelpTips;
