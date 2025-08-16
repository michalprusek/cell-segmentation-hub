const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const testUser = await prisma.user.findUnique({
    where: { email: 'test@example.com' }
  });
  
  if (!testUser) {
    console.log('Test user not found');
    return;
  }
  
  console.log('Test user ID:', testUser.id);
  
  // Get the first project of the test user
  const project = await prisma.project.findFirst({
    where: { userId: testUser.id },
    include: { images: true }
  });
  
  if (!project) {
    console.log('No project found for test user');
    return;
  }
  
  console.log('Project ID:', project.id);
  console.log('Images in project:', project.images.length);
  
  if (project.images.length === 0) {
    console.log('No images found in project');
    return;
  }
  
  // Take the first image and create segmentation data
  const image = project.images[0];
  console.log('Using image:', image.name, '(' + image.id + ')');
  
  // Create test polygon data
  const testPolygons = [
    {
      id: 'test_polygon_1',
      points: [
        [100, 100], [200, 100], [200, 200], [150, 250], [100, 200]
      ],
      type: 'external',
      class: 'spheroid'
    },
    {
      id: 'test_polygon_2', 
      points: [
        [300, 150], [400, 150], [400, 250], [300, 250]
      ],
      type: 'external',
      class: 'spheroid'
    }
  ];
  
  // Check if segmentation already exists
  const existingSegmentation = await prisma.segmentation.findUnique({
    where: { imageId: image.id }
  });
  
  if (existingSegmentation) {
    console.log('Updating existing segmentation...');
    await prisma.segmentation.update({
      where: { imageId: image.id },
      data: {
        polygons: JSON.stringify(testPolygons),
        imageWidth: 800,
        imageHeight: 600,
        model: 'test',
        threshold: 0.5
      }
    });
  } else {
    console.log('Creating new segmentation...');
    await prisma.segmentation.create({
      data: {
        imageId: image.id,
        polygons: JSON.stringify(testPolygons),
        imageWidth: 800,
        imageHeight: 600,
        model: 'test',
        threshold: 0.5
      }
    });
  }
  
  // Update image status to segmented
  await prisma.image.update({
    where: { id: image.id },
    data: { 
      segmentationStatus: 'segmented',
      width: 800,
      height: 600
    }
  });
  
  console.log('✅ Test segmentation created successfully!');
  console.log('Project ID:', project.id);
  console.log('Image ID:', image.id);
  console.log('URL: http://localhost:3000/segmentation/' + project.id + '/' + image.id);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });