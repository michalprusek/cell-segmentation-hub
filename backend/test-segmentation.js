const { PrismaClient } = require('@prisma/client');

async function testSegmentationUpsert() {
  const prisma = new PrismaClient();
  
  try {
    console.log('Testing segmentation upsert...');
    
    // Test the exact same upsert structure that's failing
    const testData = {
      where: { imageId: 'test-image-id' },
      update: {
        polygons: JSON.stringify([]),
        model: 'hrnet',
        threshold: 0.5,
        confidence: 0.8,
        processingTime: 5000,
        imageWidth: 800,
        imageHeight: 600,
        updatedAt: new Date()
      },
      create: {
        id: 'test-seg-id',
        imageId: 'test-image-id', 
        polygons: JSON.stringify([]),
        model: 'hrnet',
        threshold: 0.5,
        confidence: 0.8,
        processingTime: 5000,
        imageWidth: 800,
        imageHeight: 600,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    };
    
    console.log('Upsert data:', JSON.stringify(testData, null, 2));
    
    // This should fail with the same error if there's a schema mismatch
    const result = await prisma.segmentation.upsert(testData);
    
    console.log('Upsert succeeded:', result.id);
    
    // Clean up
    await prisma.segmentation.delete({ where: { id: result.id } });
    
  } catch (error) {
    console.error('Upsert failed:', error.message);
    console.error('Full error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testSegmentationUpsert();