
import React, { useState } from 'react';
import { CheckCircle, Clipboard, DownloadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SegmentationResult } from '@/lib/segmentation';
import { calculateMetrics, formatNumber } from '../../../utils/metricCalculations';

interface MetricsDisplayProps {
  segmentation: SegmentationResult;
}

const MetricsDisplay: React.FC<MetricsDisplayProps> = ({ segmentation }) => {
  const [copiedStatus, setCopiedStatus] = useState<{ [key: string]: boolean }>({});
  
  const handleCopyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedStatus({ ...copiedStatus, [key]: true });
      setTimeout(() => {
        setCopiedStatus({ ...copiedStatus, [key]: false });
      }, 2000);
    });
  };
  
  const handleDownload = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  
  // Get external polygons for metrics
  const externalPolygons = segmentation.polygons.filter(polygon => polygon.type === 'external');
  
  return (
    <div className="space-y-6">
      {externalPolygons.map((polygon, index) => {
        // Find internal polygons (holes) for this external polygon
        const holes = segmentation.polygons.filter(p => p.type === 'internal');
        const metrics = calculateMetrics(polygon, holes);
        
        return (
          <div key={index} className="border dark:border-gray-700 rounded-lg overflow-hidden">
            <div className="bg-gray-100 dark:bg-gray-700 p-3 font-medium flex justify-between items-center">
              <span>Sféroid #{index + 1}</span>
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  size="sm"
                  className="h-8 text-xs" 
                  onClick={() => handleCopyToClipboard(JSON.stringify(metrics, null, 2), `metrics-${index}`)}
                >
                  {copiedStatus[`metrics-${index}`] ? (
                    <CheckCircle className="h-4 w-4 mr-1 text-green-500" />
                  ) : (
                    <Clipboard className="h-4 w-4 mr-1" />
                  )}
                  Kopírovat
                </Button>
                <Button 
                  variant="default" 
                  size="sm"
                  className="h-8 text-xs" 
                  onClick={() => handleDownload(
                    JSON.stringify(metrics, null, 2), 
                    `spheroid-${index + 1}-metrics.json`
                  )}
                >
                  <DownloadCloud className="h-4 w-4 mr-1" />
                  Stáhnout
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 p-4">
              <div className="border dark:border-gray-700 rounded p-2">
                <div className="text-xs text-gray-500 dark:text-gray-400">Plocha</div>
                <div className="font-mono font-medium">{formatNumber(metrics.Area)} px²</div>
              </div>
              <div className="border dark:border-gray-700 rounded p-2">
                <div className="text-xs text-gray-500 dark:text-gray-400">Obvod</div>
                <div className="font-mono font-medium">{formatNumber(metrics.Perimeter)} px</div>
              </div>
              <div className="border dark:border-gray-700 rounded p-2">
                <div className="text-xs text-gray-500 dark:text-gray-400">Ekvivalentní průměr</div>
                <div className="font-mono font-medium">{formatNumber(metrics.EquivalentDiameter)} px</div>
              </div>
              <div className="border dark:border-gray-700 rounded p-2">
                <div className="text-xs text-gray-500 dark:text-gray-400">Kruhovitost</div>
                <div className="font-mono font-medium">{formatNumber(metrics.Circularity)}</div>
              </div>
              <div className="border dark:border-gray-700 rounded p-2">
                <div className="text-xs text-gray-500 dark:text-gray-400">Feretův maximum</div>
                <div className="font-mono font-medium">{formatNumber(metrics.FeretDiameterMax)} px</div>
              </div>
              <div className="border dark:border-gray-700 rounded p-2">
                <div className="text-xs text-gray-500 dark:text-gray-400">Feretův minimální</div>
                <div className="font-mono font-medium">{formatNumber(metrics.FeretDiameterMin)} px</div>
              </div>
              <div className="border dark:border-gray-700 rounded p-2">
                <div className="text-xs text-gray-500 dark:text-gray-400">Kompaktnost</div>
                <div className="font-mono font-medium">{formatNumber(metrics.Compactness)}</div>
              </div>
              <div className="border dark:border-gray-700 rounded p-2">
                <div className="text-xs text-gray-500 dark:text-gray-400">Konvexita</div>
                <div className="font-mono font-medium">{formatNumber(metrics.Convexity)}</div>
              </div>
              <div className="border dark:border-gray-700 rounded p-2">
                <div className="text-xs text-gray-500 dark:text-gray-400">Solidita</div>
                <div className="font-mono font-medium">{formatNumber(metrics.Solidity)}</div>
              </div>
              <div className="border dark:border-gray-700 rounded p-2">
                <div className="text-xs text-gray-500 dark:text-gray-400">Sféricita</div>
                <div className="font-mono font-medium">{formatNumber(metrics.Sphericity)}</div>
              </div>
              <div className="border dark:border-gray-700 rounded p-2">
                <div className="text-xs text-gray-500 dark:text-gray-400">Feretův poměr stran</div>
                <div className="font-mono font-medium">{formatNumber(metrics.FeretAspectRatio)}</div>
              </div>
            </div>
          </div>
        );
      })}
      
      {externalPolygons.length === 0 && (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          Nebyly nalezeny žádné polygony pro analýzu
        </div>
      )}
    </div>
  );
};

export default MetricsDisplay;
