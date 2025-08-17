const { PrismaClient } = require('@prisma/client');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const prisma = new PrismaClient();

async function fixDimensions() {
  try {
    // Get segmentations with null dimensions
    const segmentations = await prisma.segmentation.findMany({
      where: {
        OR: [{ imageWidth: null }, { imageHeight: null }],
      },
      include: {
        image: true,
      },
    });

    console.log(
      `🔧 Found ${segmentations.length} segmentations with missing dimensions`
    );

    for (const seg of segmentations) {
      try {
        const imagePath = `/app/uploads/${seg.image.originalPath.substring(1)}`; // Remove leading slash from originalPath
        console.log(`📏 Processing image: ${imagePath}`);

        if (fs.existsSync(imagePath)) {
          const metadata = await sharp(imagePath).metadata();
          const width = metadata.width;
          const height = metadata.height;

          console.log(`  📐 Dimensions: ${width}x${height}`);

          // Update segmentation with correct dimensions
          await prisma.segmentation.update({
            where: { id: seg.id },
            data: {
              imageWidth: width,
              imageHeight: height,
            },
          });

          console.log(
            `  ✅ Updated segmentation for image ${seg.imageId.slice(0, 8)}`
          );
        } else {
          console.log(`  ❌ Image file not found: ${imagePath}`);
        }
      } catch (error) {
        console.error(`  ❌ Error processing ${seg.imageId}:`, error.message);
      }
    }

    console.log('🎉 Dimension fix completed!');
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixDimensions();
