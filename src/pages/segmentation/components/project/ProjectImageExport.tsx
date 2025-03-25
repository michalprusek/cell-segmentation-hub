
import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { DownloadCloud, X, Clipboard, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { SegmentationResult } from '@/lib/segmentation';

interface ProjectImageExportProps {
  segmentation: SegmentationResult | null;
  onClose: () => void;
}

// Definice metriky
interface PolygonMetrics {
  Area: number;
  Perimeter: number;
  EquivalentDiameter: number;
  Circularity: number;
  FeretDiameterMax: number;
  FeretDiameterMaxOrthogonalDistance: number;
  FeretDiameterMin: number;
  FeretAspectRatio: number;
  LengthMajorDiameterThroughCentroid: number;
  LengthMinorDiameterThroughCentroid: number;
  Compactness: number;
  Convexity: number;
  Solidity: number;
  Sphericity: number;
}

// Simulace výpočtu metrik (ve skutečnosti by byly počítány pomocí OpenCV)
const calculateMetrics = (polygon: { points: Array<{x: number, y: number}> }): PolygonMetrics => {
  // Toto je simulace, ve skutečnosti by byl použit kód pro výpočet metrik
  const area = Math.random() * 1000 + 200;
  const perimeter = Math.random() * 300 + 50;
  
  return {
    Area: area,
    Perimeter: perimeter,
    EquivalentDiameter: Math.sqrt(4 * area / Math.PI),
    Circularity: (4 * Math.PI * area) / (perimeter * perimeter),
    FeretDiameterMax: Math.random() * 100 + 20,
    FeretDiameterMaxOrthogonalDistance: Math.random() * 50 + 10,
    FeretDiameterMin: Math.random() * 40 + 10,
    FeretAspectRatio: Math.random() * 3 + 1,
    LengthMajorDiameterThroughCentroid: Math.random() * 80 + 20,
    LengthMinorDiameterThroughCentroid: Math.random() * 40 + 10,
    Compactness: Math.random() * 0.5 + 0.5,
    Convexity: Math.random() * 0.3 + 0.7,
    Solidity: Math.random() * 0.2 + 0.8,
    Sphericity: Math.random() * 0.4 + 0.6
  };
};

// Formátování čísla pro zobrazení
const formatNumber = (value: number): string => {
  return value.toFixed(4);
};

// Převod segmentace do formátu COCO
const convertToCOCO = (segmentation: SegmentationResult): string => {
  const annotations = segmentation.polygons.map((polygon, index) => {
    // Převod bodů do formátu COCO (všechny x-ové souřadnice, pak všechny y-ové)
    const segmentation = [
      polygon.points.reduce<number[]>(
        (acc, point) => [...acc, point.x, point.y],
        []
      )
    ];
    
    // Výpočet bounding boxu
    const xs = polygon.points.map(p => p.x);
    const ys = polygon.points.map(p => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const width = Math.max(...xs) - x;
    const height = Math.max(...ys) - y;
    
    return {
      id: index + 1,
      image_id: 1, // Předpokládáme jeden obrázek
      category_id: 1, // Kategorie sféroidu
      segmentation,
      bbox: [x, y, width, height],
      area: width * height, // Jednoduchá aproximace plochy
      iscrowd: 0
    };
  });
  
  // Vytvoření COCO formátu
  const coco = {
    info: {
      description: "Spheroid segmentation dataset",
      version: "1.0",
      year: new Date().getFullYear(),
      date_created: new Date().toISOString()
    },
    images: [{
      id: 1,
      file_name: segmentation.imageSrc.split('/').pop() || "image.png",
      width: 800, // Předpokládáme pevnou velikost
      height: 600,
      date_captured: new Date().toISOString()
    }],
    annotations,
    categories: [{
      id: 1,
      name: "spheroid",
      supercategory: "cell"
    }]
  };
  
  return JSON.stringify(coco, null, 2);
};

const ProjectImageExport = ({ segmentation, onClose }: ProjectImageExportProps) => {
  const [activeTab, setActiveTab] = useState('metrics');
  const [copiedStatus, setCopiedStatus] = useState<{ [key: string]: boolean }>({});

  if (!segmentation) return null;
  
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
  
  const cocoData = convertToCOCO(segmentation);

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

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
          <div className="px-4 border-b dark:border-gray-700">
            <TabsList className="mt-2">
              <TabsTrigger value="metrics">Metriky sféroidů</TabsTrigger>
              <TabsTrigger value="coco">COCO formát</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="metrics" className="flex-1 overflow-auto p-4">
            <div className="space-y-6">
              {segmentation.polygons.map((polygon, index) => {
                const metrics = calculateMetrics(polygon);
                
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
              
              {segmentation.polygons.length === 0 && (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  Nebyly nalezeny žádné polygony pro analýzu
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="coco" className="flex-1 overflow-auto flex flex-col">
            <div className="p-4 border-b dark:border-gray-700 flex justify-between items-center">
              <h3 className="font-medium">COCO formát (Common Objects in Context)</h3>
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  size="sm"
                  className="h-8 text-xs" 
                  onClick={() => handleCopyToClipboard(cocoData, 'coco')}
                >
                  {copiedStatus['coco'] ? (
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
                  onClick={() => handleDownload(cocoData, 'segmentation-coco.json')}
                >
                  <DownloadCloud className="h-4 w-4 mr-1" />
                  Stáhnout JSON
                </Button>
              </div>
            </div>
            <div className="flex-1 p-4 bg-gray-100 dark:bg-gray-900 overflow-auto">
              <pre className="text-xs font-mono whitespace-pre-wrap">{cocoData}</pre>
            </div>
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
