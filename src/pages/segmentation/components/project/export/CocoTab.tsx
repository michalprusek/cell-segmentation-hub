import React, { useState } from 'react';
import { SegmentationResult } from '@/lib/segmentation';
import { CheckCircle, Clipboard, DownloadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { convertToCOCO } from '../../../utils/cocoConverter';
import { useLanguage } from '@/contexts/useLanguage';
import { downloadJSON } from '@/lib/downloadUtils';

interface CocoTabProps {
  segmentation: SegmentationResult;
}

const CocoTab: React.FC<CocoTabProps> = ({ segmentation }) => {
  const [copied, setCopied] = useState(false);
  const { t } = useLanguage();
  const cocoData = convertToCOCO(segmentation);

  const handleCopyToClipboard = () => {
    navigator.clipboard.writeText(cocoData).then(() => {
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    });
  };

  const handleDownload = () => {
    // Use centralized download utility for consistency
    const data = JSON.parse(cocoData);
    downloadJSON(data, 'segmentation-coco');
  };

  return (
    <div className="flex-1 overflow-auto flex flex-col">
      <div className="p-4 border-b dark:border-gray-700 flex justify-between items-center">
        <h3 className="font-medium">{t('export.cocoFormatTitle')}</h3>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={handleCopyToClipboard}
          >
            {copied ? (
              <CheckCircle className="h-4 w-4 mr-1 text-green-500" />
            ) : (
              <Clipboard className="h-4 w-4 mr-1" />
            )}
            {t('common.copy')}
          </Button>
          <Button
            variant="default"
            size="sm"
            className="h-8 text-xs"
            onClick={handleDownload}
          >
            <DownloadCloud className="h-4 w-4 mr-1" />
            {t('export.downloadJson')}
          </Button>
        </div>
      </div>
      <div className="flex-1 p-4 bg-gray-100 dark:bg-gray-900 overflow-auto">
        <pre className="text-xs font-mono whitespace-pre-wrap">{cocoData}</pre>
      </div>
    </div>
  );
};

export default CocoTab;
