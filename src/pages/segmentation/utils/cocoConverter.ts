
import { SegmentationResult } from '@/lib/segmentation';
import { calculateMetrics } from './metricCalculations';

// Convert segmentation to COCO format
export const convertToCOCO = (segmentation: SegmentationResult): string => {
  const externalPolygons = segmentation.polygons.filter(p => p.type === 'external');
  
  const annotations = externalPolygons.map((polygon, index) => {
    // Find all internal polygons (holes)
    const holes = segmentation.polygons.filter(p => p.type === 'internal');
    
    // Convert points to COCO format (all x coordinates, then all y coordinates)
    const segmentationPoints = [
      polygon.points.reduce<number[]>(
        (acc, point) => [...acc, point.x, point.y],
        []
      )
    ];
    
    // Add holes to segmentation
    holes.forEach(hole => {
      segmentationPoints.push(
        hole.points.reduce<number[]>(
          (acc, point) => [...acc, point.x, point.y],
          []
        )
      );
    });
    
    // Calculate bounding box
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
      image_id: 1, // Assume one image
      category_id: 1, // Spheroid category
      segmentation: segmentationPoints,
      bbox: [x, y, width, height],
      area: area, // Area with holes subtracted
      iscrowd: 0
    };
  });
  
  // Create COCO format
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
      width: 800, // Assume fixed size
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
