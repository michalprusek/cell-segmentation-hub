
import React from 'react';
import { Button } from "@/components/ui/button";
import ImageUploader from "@/components/ImageUploader";
import { useLanguage } from '@/contexts/LanguageContext';

interface ProjectUploaderSectionProps {
  onCancel: () => void;
}

const ProjectUploaderSection = ({ onCancel }: ProjectUploaderSectionProps) => {
  const { t } = useLanguage();

  return (
    <div className="mb-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-medium dark:text-white">{t('images.uploadImages')}</h2>
        <Button variant="outline" size="sm" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
      <ImageUploader />
    </div>
  );
};

export default ProjectUploaderSection;
