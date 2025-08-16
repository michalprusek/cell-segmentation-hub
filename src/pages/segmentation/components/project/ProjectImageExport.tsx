import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SegmentationResult } from '@/lib/segmentation';
import ExcelExporter from './export/ExcelExporter';
import MetricsDisplay from './export/MetricsDisplay';
import CocoTab from './export/CocoTab';

interface ProjectImageExportProps {
  segmentation: SegmentationResult | null;
  imageName?: string;
  onClose: () => void;
}

const ProjectImageExport: React.FC<ProjectImageExportProps> = ({
  segmentation,
  imageName,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState('metrics');

  if (!segmentation) return null;

  return (
    <motion.div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
      >
        <div className="flex justify-between items-center p-4 border-b dark:border-gray-700">
          <h2 className="text-xl font-semibold">Export segmentačních dat</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex-1 flex flex-col"
        >
          <div className="px-4 border-b dark:border-gray-700">
            <TabsList className="mt-2">
              <TabsTrigger value="metrics">Metriky sféroidů</TabsTrigger>
              <TabsTrigger value="coco">COCO formát</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="metrics" className="flex-1 overflow-auto p-4">
            <div className="mb-4 flex justify-end">
              <ExcelExporter
                segmentation={segmentation}
                imageName={imageName}
              />
            </div>
            <MetricsDisplay segmentation={segmentation} />
          </TabsContent>

          <TabsContent
            value="coco"
            className="flex-1 overflow-auto flex flex-col"
          >
            <CocoTab segmentation={segmentation} />
          </TabsContent>
        </Tabs>

        <div className="p-4 border-t dark:border-gray-700 flex justify-end">
          <Button onClick={onClose}>Zavřít</Button>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default ProjectImageExport;
