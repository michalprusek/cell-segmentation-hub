
import React from 'react';
import { Button } from "@/components/ui/button";
import { ImageIcon } from "lucide-react";
import { useLanguage } from '@/contexts/LanguageContext';

interface EmptyStateProps {
  hasSearchTerm: boolean;
  onUpload: () => void;
}

const EmptyState = ({ hasSearchTerm, onUpload }: EmptyStateProps) => {
  const { t } = useLanguage();

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-8 text-center">
      <ImageIcon className="h-12 w-12 mx-auto text-gray-400 mb-4" />
      <h3 className="text-lg font-medium mb-2 dark:text-white">{t('common.noImages')}</h3>
      <p className="text-gray-500 dark:text-gray-400 mb-6">
        {hasSearchTerm ? t('dashboard.searchImagesPlaceholder') : t('dashboard.noImagesDescription')}
      </p>
      <Button onClick={onUpload}>
        {t('common.uploadImages')}
      </Button>
    </div>
  );
};

export default EmptyState;
