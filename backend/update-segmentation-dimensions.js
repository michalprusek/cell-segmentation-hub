const { PrismaClient } = require('@prisma/client');
const path = require('path');
const fs = require('fs');

const prisma = new PrismaClient();

async function updateSegmentationDimensions() {
  try {
    console.log('🔄 Starting segmentation dimensions update...');

    // Get all segmentations
    const segmentations = await prisma.segmentation.findMany({
      include: {
        image: true
      }
    });

    console.log(`📊 Found ${segmentations.length} segmentations to update`);

    let updated = 0;
    let skipped = 0;

    for (const segmentation of segmentations) {
      // Check if dimensions are already set
      if (segmentation.imageWidth && segmentation.imageHeight) {
        console.log(`⏭️  Segmentation ${segmentation.id.slice(0, 8)} already has dimensions ${segmentation.imageWidth}x${segmentation.imageHeight}`);
        skipped++;
        continue;
      }

      let imageWidth = 1000;
      let imageHeight = 1000;

      // Try to get dimensions from the associated image record
      if (segmentation.image) {
        if (segmentation.image.width && segmentation.image.height) {
          imageWidth = segmentation.image.width;
          imageHeight = segmentation.image.height;
          console.log(`📏 Using image dimensions for ${segmentation.id.slice(0, 8)}: ${imageWidth}x${imageHeight}`);
        } else {
          console.log(`⚠️  Image ${segmentation.image.name} has no dimensions, using default 1000x1000`);
        }
      } else {
        console.log(`⚠️  No image found for segmentation ${segmentation.id.slice(0, 8)}, using default 1000x1000`);
      }

      // Update the segmentation record
      await prisma.segmentation.update({
        where: { id: segmentation.id },
        data: {
          imageWidth: imageWidth,
          imageHeight: imageHeight
        }
      });

      console.log(`✅ Updated segmentation ${segmentation.id.slice(0, 8)} with dimensions ${imageWidth}x${imageHeight}`);
      updated++;
    }

    console.log(`\n📈 Update complete:`);
    console.log(`   ✅ Updated: ${updated} segmentations`);
    console.log(`   ⏭️  Skipped: ${skipped} segmentations (already had dimensions)`);

    // Verify the updates
    const verifySegmentations = await prisma.segmentation.findMany({
      select: {
        id: true,
        imageWidth: true,
        imageHeight: true
      }
    });

    const withoutDimensions = verifySegmentations.filter(s => !s.imageWidth || !s.imageHeight);
    if (withoutDimensions.length === 0) {
      console.log(`✅ Verification passed: All segmentations now have dimensions`);
    } else {
      console.log(`❌ Verification failed: ${withoutDimensions.length} segmentations still missing dimensions`);
    }

  } catch (error) {
    console.error('❌ Error updating segmentation dimensions:', error);
  } finally {
    await prisma.$disconnect();
  }
}

updateSegmentationDimensions();