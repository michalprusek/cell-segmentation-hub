const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Checking for completed segmentations...');
  
  const images = await prisma.image.findMany({
    where: { segmentationStatus: 'completed' },
    include: { 
      segmentation: true,
      project: true
    },
    take: 5
  });
  
  console.log(`Found ${images.length} images with completed segmentation`);
  
  images.forEach(img => {
    console.log(`\nImage: ${img.id}`);
    console.log(`Name: ${img.name}`);
    console.log(`Project: ${img.project.title} (${img.projectId})`);
    console.log(`Status: ${img.segmentationStatus}`);
    if (img.segmentation) {
      console.log(`Segmentation ID: ${img.segmentation.id}`);
      console.log(`Model: ${img.segmentation.model}`);
      console.log(`Polygons data length: ${img.segmentation.polygons?.length || 0} chars`);
      // Parse the polygons JSON string
      try {
        const polygons = JSON.parse(img.segmentation.polygons);
        console.log(`Number of polygons: ${polygons.length}`);
        if (polygons.length > 0) {
          console.log('First polygon has', polygons[0].points?.length || 0, 'points');
        }
      } catch (e) {
        console.log('Could not parse polygons JSON');
      }
    }
  });
  
  // Also check for any image with the specific IDs from the URL
  console.log('\n--- Checking specific image from URL ---');
  const specificImage = await prisma.image.findUnique({
    where: { id: 'c7c5f1b0-1722-4fc4-9f56-c21cf34831f6' },
    include: { 
      segmentation: true,
      project: true
    }
  });
  
  if (specificImage) {
    console.log('Found image:', specificImage.name);
    console.log('Project ID:', specificImage.projectId);
    console.log('Segmentation status:', specificImage.segmentationStatus);
    console.log('Has segmentation:', !!specificImage.segmentation);
  } else {
    console.log('Image with ID c7c5f1b0-1722-4fc4-9f56-c21cf34831f6 not found');
  }
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });