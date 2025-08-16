import React from 'react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useModel, ModelType } from '@/contexts/ModelContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { Cpu, Zap, Target } from 'lucide-react';

const ModelSettingsSection = () => {
  const { t } = useLanguage();
  const {
    selectedModel,
    confidenceThreshold,
    setSelectedModel,
    setConfidenceThreshold,
    availableModels,
  } = useModel();

  const handleModelChange = (modelId: string) => {
    setSelectedModel(modelId as ModelType);
    toast.success(t('settings.modelSelected'));
  };

  const handleThresholdChange = (value: number[]) => {
    setConfidenceThreshold(value[0] / 100); // Convert from 0-100 to 0-1
  };

  const handleThresholdCommit = (value: number[]) => {
    toast.success(t('settings.modelSettingsSaved'));
  };

  const getSizeIcon = (size: string) => {
    switch (size) {
      case 'small':
        return <Zap className="h-4 w-4" />;
      case 'medium':
        return <Cpu className="h-4 w-4" />;
      case 'large':
        return <Target className="h-4 w-4" />;
      default:
        return <Cpu className="h-4 w-4" />;
    }
  };

  const getSizeBadgeColor = (size: string) => {
    switch (size) {
      case 'small':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300';
      case 'large':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300';
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium mb-4">
          {t('settings.modelSelection')}
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          {t('settings.modelSelectionDescription')}
        </p>

        <RadioGroup value={selectedModel} onValueChange={handleModelChange}>
          <div className="space-y-4">
            {availableModels.map(model => (
              <div key={model.id} className="flex items-center space-x-4">
                <RadioGroupItem value={model.id} id={model.id} />
                <Label 
                  htmlFor={model.id} 
                  className="flex-1 cursor-pointer"
                >
                  <Card className="transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base flex items-center gap-2">
                          {getSizeIcon(model.size)}
                          {model.displayName}
                        </CardTitle>
                        <Badge className={getSizeBadgeColor(model.size)}>
                          {t(`settings.modelSize.${model.size}`)}
                        </Badge>
                      </div>
                      <CardDescription className="text-sm">
                        {t(`settings.modelDescription.${model.id}`)}
                      </CardDescription>
                    </CardHeader>
                  </Card>
                </Label>
              </div>
            ))}
          </div>
        </RadioGroup>
      </div>

      <div className="space-y-4">
        <div>
          <Label htmlFor="threshold" className="text-base font-medium">
            {t('settings.confidenceThreshold')}
          </Label>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t('settings.confidenceThresholdDescription')}
          </p>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600 dark:text-gray-400">0%</span>
            <span className="text-sm font-medium">
              {Math.round(confidenceThreshold * 100)}%
            </span>
            <span className="text-sm text-gray-600 dark:text-gray-400">
              100%
            </span>
          </div>

          <Slider
            id="threshold"
            min={0}
            max={100}
            step={1}
            value={[confidenceThreshold * 100]}
            onValueChange={handleThresholdChange}
            onValueCommit={handleThresholdCommit}
            className="w-full"
          />

          <div className="text-xs text-gray-500 dark:text-gray-400 text-center">
            {t('settings.currentThreshold')}:{' '}
            {Math.round(confidenceThreshold * 100)}%
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModelSettingsSection;
