import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { DownloadCloud, X, Clipboard, CheckCircle, FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SegmentationResult } from '@/lib/segmentation';
import { calculatePolygonArea, calculatePerimeter } from '@/lib/segmentation';
import { utils, writeFile } from 'xlsx';
import { SpheroidMetric } from '@/types';

interface ProjectImageExportProps {
  segmentation: SegmentationResult | null;
  imageName?: string;
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
const calculateMetrics = (polygon: { points: Array<{x: number, y: number}> }, holes: Array<{ points: Array<{x: number, y: number}> }> = []): PolygonMetrics => {
  // Calculate actual area (subtract hole areas)
  const mainArea = calculatePolygonArea(polygon.points);
  const holesArea = holes.reduce((sum, hole) => sum + calculatePolygonArea(hole.points), 0);
  const area = mainArea - holesArea;
  
  // Calculate perimeter
  const perimeter = calculatePerimeter(polygon.points);
  
  // Calculate circularity: 4π × area / perimeter²
  const circularity = (4 * Math.PI * area) / (perimeter * perimeter);
  
  // Other metrics based on area and perimeter
  return {
    Area: area,
    Perimeter: perimeter,
    EquivalentDiameter: Math.sqrt(4 * area / Math.PI),
    Circularity: circularity,
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
  const externalPolygons = segmentation.polygons.filter(p => p.type === 'external');
  
  const annotations = externalPolygons.map((polygon, index) => {
    // Najdi všechny interní polygony (díry)
    const holes = segmentation.polygons.filter(p => p.type === 'internal');
    
    // Převod bodů do formátu COCO (všechny x-ové souřadnice, pak všechny y-ové)
    const segmentation = [
      polygon.points.reduce<number[]>(
        (acc, point) => [...acc, point.x, point.y],
        []
      )
    ];
    
    // Add holes to segmentation
    holes.forEach(hole => {
      segmentation.push(
        hole.points.reduce<number[]>(
          (acc, point) => [...acc, point.x, point.y],
          []
        )
      );
    });
    
    // Výpočet bounding boxu
    const xs = polygon.points.map(p => p.x);
    const ys = polygon.points.map(p => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const width = Math.max(...xs) - x;
    const height = Math.max(...ys) - y;
    
    // Calculate area with holes subtracted
    const area = calculateMetrics(polygon, holes).Area;
    
    return {
      id: index + 1,
      image_id: 1, // Předpokládáme jeden obrázek
      category_id: 1, // Kategorie sféroidu
      segmentation,
      bbox: [x, y, width, height],
      area: area, // Area with holes subtracted
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
      file_name: segmentation.imageSrc?.split('/').pop() || "image.png",
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

const ProjectImageExport = ({ segmentation, imageName, onClose }: ProjectImageExportProps) => {
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
  
  const handleExportXlsx = () => {
    if (!segmentation || !segmentation.polygons) return;
    
    // Get only external polygons
    const externalPolygons = segmentation.polygons.filter(polygon => polygon.type === 'external');
    
    // Calculate metrics for each external polygon
    const metricsData: SpheroidMetric[] = externalPolygons.map((polygon, index) => {
      // Find internal polygons (holes) related to this external polygon
      const holes = segmentation.polygons.filter(p => p.type === 'internal');
      
      // Calculate metrics with holes considered
      const metrics = calculateMetrics(polygon, holes);
      
      return {
        imageId: segmentation.id || '',
        imageName: imageName || 'unnamed',
        contourNumber: index + 1,
        area: metrics.Area,
        perimeter: metrics.Perimeter,
        circularity: metrics.Circularity,
        compactness: metrics.Compactness,
        convexity: metrics.Convexity,
        equivalentDiameter: metrics.EquivalentDiameter,
        aspectRatio: metrics.FeretAspectRatio,
        feretDiameterMax: metrics.FeretDiameterMax,
        feretDiameterMaxOrthogonal: metrics.FeretDiameterMaxOrthogonalDistance,
        feretDiameterMin: metrics.FeretDiameterMin,
        lengthMajorDiameter: metrics.LengthMajorDiameterThroughCentroid,
        lengthMinorDiameter: metrics.LengthMinorDiameterThroughCentroid,
        solidity: metrics.Solidity,
        sphericity: metrics.Sphericity
      };
    });
    
    // Create worksheet
    const worksheet = utils.json_to_sheet(metricsData.map(metric => ({
      'Image Name': metric.imageName,
      'Contour': metric.contourNumber,
      'Area': metric.area,
      'Circularity': metric.circularity,
      'Compactness': metric.compactness,
      'Convexity': metric.convexity,
      'Equivalent Diameter': metric.equivalentDiameter,
      'Aspect Ratio': metric.aspectRatio,
      'Feret Diameter Max': metric.feretDiameterMax,
      'Feret Diameter Max Orthogonal': metric.feretDiameterMaxOrthogonal,
      'Feret Diameter Min': metric.feretDiameterMin,
      'Length Major Diameter': metric.lengthMajorDiameter,
      'Length Minor Diameter': metric.lengthMinorDiameter,
      'Perimeter': metric.perimeter,
      'Solidity': metric.solidity,
      'Sphericity': metric.sphericity
    })));
    
    // Set column widths
    const colWidths = [
      { wch: 15 }, // Image Name
      { wch: 8 },  // Contour
      { wch: 10 }, // Area
      { wch: 10 }, // Circularity
      { wch: 10 }, // Compactness
      { wch: 10 }, // Convexity
      { wch: 18 }, // Equivalent Diameter
      { wch: 10 }, // Aspect Ratio
      { wch: 16 }, // Feret Diameter Max
      { wch: 25 }, // Feret Diameter Max Orthogonal
      { wch: 16 }, // Feret Diameter Min
      { wch: 20 }, // Length Major Diameter
      { wch: 20 }, // Length Minor Diameter
      { wch: 10 }, // Perimeter
      { wch: 10 }, // Solidity
      { wch: 10 }  // Sphericity
    ];
    
    worksheet['!cols'] = colWidths;
    
    // Create workbook
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, worksheet, 'Spheroid Metrics');
    
    // Download
    const filename = `${imageName || 'spheroid'}_metrics.xlsx`;
    writeFile(workbook, filename);
  };
  
  const cocoData = convertToCOCO(segmentation);
  
  // Get external polygons for metrics
  const externalPolygons = segmentation.polygons.filter(polygon => polygon.type === 'external');

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
            <div className="mb-4 flex justify-end">
              <Button 
                variant="default" 
                size="sm" 
                onClick={handleExportXlsx}
                className="text-xs"
              >
                <FileSpreadsheet className="h-4 w-4 mr-1" />
                Exportovat všechny metriky jako XLSX
              </Button>
            </div>
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
