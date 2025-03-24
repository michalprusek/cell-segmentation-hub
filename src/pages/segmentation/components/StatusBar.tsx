
import React from 'react';
import { CheckCircle, AlertCircle, Info } from 'lucide-react';
import { SegmentationResult } from '@/lib/segmentation';
import { formatDistanceToNow } from 'date-fns';
import { cs, de, enUS, es, fr, zhCN } from 'date-fns/locale';
import { useLanguage } from '@/contexts/LanguageContext';

interface StatusBarProps {
  segmentation: SegmentationResult | null;
}

const StatusBar = ({ segmentation }: StatusBarProps) => {
  const { language, t } = useLanguage();
  
  // Mapování jazyků na locale z date-fns
  const localeMap = {
    en: enUS,
    cs,
    de,
    es,
    fr,
    zh: zhCN
  };
  
  // Určení správného locale pro datum
  const dateLocale = localeMap[language as keyof typeof localeMap] || enUS;
  
  if (!segmentation) {
    return (
      <div className="bg-slate-800 border-t border-slate-700 p-2 px-4 flex justify-between items-center">
        <div className="flex items-center">
          <Info className="h-4 w-4 text-slate-400 mr-2" />
          <span className="text-sm text-slate-400">{t('common.loading')}</span>
        </div>
        <div className="text-sm text-slate-500">
          0 {t('projects.images').toLowerCase()}
        </div>
      </div>
    );
  }
  
  // Zjištění stavu
  const isComplete = segmentation.status === 'completed';
  const polygonCount = segmentation?.polygons.length || 0;
  const timestamp = segmentation.timestamp 
    ? formatDistanceToNow(new Date(segmentation.timestamp), { addSuffix: true, locale: dateLocale })
    : '';
  
  return (
    <div className="bg-slate-800 border-t border-slate-700 p-2 px-4 flex justify-between items-center">
      <div className="flex items-center space-x-4">
        <div className="flex items-center">
          {isComplete ? (
            <CheckCircle className="h-4 w-4 text-green-500 mr-2" />
          ) : (
            <AlertCircle className="h-4 w-4 text-amber-500 mr-2" />
          )}
          <span className="text-sm">
            {isComplete ? t('dashboard.completed') : t('dashboard.processing')}
          </span>
        </div>
        
        {timestamp && (
          <div className="text-sm text-slate-400">
            {t('dashboard.lastUpdated')} {timestamp}
          </div>
        )}
      </div>
      
      <div className="flex items-center space-x-4">
        <div className="text-sm px-2 py-1 bg-slate-700 rounded-md">
          {polygonCount} {polygonCount === 1 ? t('image') : t('images')}
        </div>
        <div className="text-xs text-slate-500">
          ID: {segmentation.id}
        </div>
      </div>
    </div>
  );
};

export default StatusBar;
