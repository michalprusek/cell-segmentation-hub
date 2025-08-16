import React from 'react';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

interface CanvasLoadingOverlayProps {
  loading: boolean;
}

const CanvasLoadingOverlay = ({ loading }: CanvasLoadingOverlayProps) => {
  const { t } = useLanguage();

  if (!loading) return null;

  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center z-30"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex flex-col items-center bg-slate-800/80 p-6 rounded-lg shadow-lg backdrop-blur-sm">
        <Loader2 className="h-10 w-10 text-blue-500 animate-spin mb-4" />
        <p className="text-slate-300">{t('segmentation.loading')}</p>
      </div>
    </motion.div>
  );
};

export default CanvasLoadingOverlay;
