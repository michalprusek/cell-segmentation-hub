const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Finding segmented images...');
  
  const images = await prisma.image.findMany({
    where: { 
      segmentationStatus: 'segmented'
    },
    include: { 
      project: true,
      segmentation: true
    }
  });
  
  images.forEach(img => {
    console.log(`\nImage: ${img.name}`);
    console.log(`Image ID: ${img.id}`);
    console.log(`Project ID: ${img.projectId}`);
    console.log(`Project Name: ${img.project.title}`);
    console.log(`Status: ${img.segmentationStatus}`);
    console.log(`Has Segmentation: ${!!img.segmentation}`);
  });
  
  if (images.length === 0) {
    console.log('No segmented images found. Looking for all images with any segmentation data...');
    
    const allImages = await prisma.image.findMany({
      include: { 
        segmentation: true,
        project: true
      }
    });
    
    const imagesWithSegmentation = allImages.filter(img => img.segmentation);
    console.log(`Found ${imagesWithSegmentation.length} images with segmentation data:`);
    
    imagesWithSegmentation.forEach(img => {
      console.log(`\nImage: ${img.name}`);
      console.log(`Image ID: ${img.id}`);
      console.log(`Project ID: ${img.projectId}`);
      console.log(`Project Name: ${img.project.title}`);
      console.log(`Status: ${img.segmentationStatus}`);
      
      // Safely parse JSON with error handling
      let polygonCount = 0;
      if (img.segmentation?.polygons) {
        try {
          const parsedPolygons = JSON.parse(img.segmentation.polygons);
          polygonCount = Array.isArray(parsedPolygons) ? parsedPolygons.length : 0;
        } catch (error) {
          console.log(`Warning: Failed to parse polygons JSON for image ${img.id}: ${error.message}`);
          polygonCount = 'Invalid JSON';
        }
      }
      console.log(`Polygons: ${polygonCount}`);
    });
  }
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });