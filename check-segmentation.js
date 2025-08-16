const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const image = await prisma.image.findUnique({
    where: { id: 'c7c5f1b0-1722-4fc4-9f56-c21cf34831f6' },
    include: { 
      segmentation: true
    }
  });
  
  if (image && image.segmentation) {
    console.log('Image:', image.name);
    console.log('Segmentation ID:', image.segmentation.id);
    console.log('Model:', image.segmentation.model);
    console.log('Image dimensions:', image.segmentation.imageWidth, 'x', image.segmentation.imageHeight);
    
    // Parse and display polygons
    try {
      const polygons = JSON.parse(image.segmentation.polygons);
      console.log('\nPolygons found:', polygons.length);
      
      polygons.forEach((poly, idx) => {
        console.log(`\nPolygon ${idx + 1}:`);
        console.log('  ID:', poly.id);
        console.log('  Type:', poly.type);
        console.log('  Class:', poly.class);
        console.log('  Points:', poly.points?.length || 0);
        if (poly.points && poly.points.length > 0) {
          console.log('  First 3 points:', poly.points.slice(0, 3));
        }
      });
    } catch (e) {
      console.log('Error parsing polygons:', e.message);
    }
  }
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });