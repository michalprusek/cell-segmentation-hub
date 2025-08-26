const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const image = await prisma.image.findUnique({
    where: { id: 'c7c5f1b0-1722-4fc4-9f56-c21cf34831f6' },
    include: {
      segmentation: true,
    },
  });

  if (image) {
    console.log('Image dimensions from Image table:');
    console.log('  Width:', image.width);
    console.log('  Height:', image.height);
    console.log('  File size:', image.fileSize);
    console.log('  MIME type:', image.mimeType);

    if (image.segmentation) {
      console.log('\nSegmentation dimensions:');
      console.log('  Width:', image.segmentation.imageWidth);
      console.log('  Height:', image.segmentation.imageHeight);
    }
  }
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
