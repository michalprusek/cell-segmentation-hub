const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function quickFix() {
  try {
    console.log('🔧 Quick fix: Setting standard dimensions (1000x1000) for all segmentations with null dimensions');
    
    const result = await prisma.segmentation.updateMany({
      where: {
        OR: [
          { imageWidth: null },
          { imageHeight: null }
        ]
      },
      data: {
        imageWidth: 1000,
        imageHeight: 1000
      }
    });
    
    console.log(`✅ Updated ${result.count} segmentations with standard dimensions`);
    console.log('🎯 Now refresh the frontend to see polygons!');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

quickFix();