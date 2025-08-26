const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkData() {
  try {
    // Check images and their segmentation status
    const images = await prisma.image.findMany({
      select: {
        id: true,
        name: true,
        segmentationStatus: true,
      },
    });

    console.log('📊 Images in database:', images.length);

    const statusCounts = images.reduce((acc, img) => {
      acc[img.segmentationStatus] = (acc[img.segmentationStatus] || 0) + 1;
      return acc;
    }, {});

    console.log('📈 Status breakdown:', statusCounts);

    // Check for completed segmentations
    const segmentations = await prisma.segmentation.findMany({
      select: {
        id: true,
        imageId: true,
        imageWidth: true,
        imageHeight: true,
        polygons: true,
      },
    });

    console.log('🎯 Segmentations in database:', segmentations.length);

    segmentations.forEach(seg => {
      const polygonCount = seg.polygons ? JSON.parse(seg.polygons).length : 0;
      console.log(
        `  - Image ${seg.imageId?.slice(0, 8)}: ${polygonCount} polygons, ${seg.imageWidth}x${seg.imageHeight}`
      );
    });

    // Now let's check if images with 'segmented' status have corresponding segmentation data
    const segmentedImages = images.filter(
      img => img.segmentationStatus === 'segmented'
    );
    console.log('🔍 Images marked as segmented:', segmentedImages.length);

    for (const img of segmentedImages.slice(0, 3)) {
      // Check first 3 segmented images
      const segmentation = segmentations.find(seg => seg.imageId === img.id);
      console.log(
        `  📸 ${img.name?.slice(0, 30)} (${img.id.slice(0, 8)}):`,
        segmentation
          ? `${JSON.parse(segmentation.polygons).length} polygons`
          : 'NO SEGMENTATION DATA'
      );
    }
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkData();
