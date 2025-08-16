const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const testUser = await prisma.user.findUnique({
    where: { email: 'test@example.com' }
  });
  
  console.log('Test user:', testUser?.id);
  
  const image = await prisma.image.findUnique({
    where: { id: 'c7c5f1b0-1722-4fc4-9f56-c21cf34831f6' },
    include: { 
      project: {
        include: {
          user: true
        }
      }
    }
  });
  
  if (image) {
    console.log('\nImage details:');
    console.log('Image ID:', image.id);
    console.log('Project ID:', image.project.id);
    console.log('Project owner ID:', image.project.userId);
    console.log('Project owner email:', image.project.user.email);
    console.log('Can test user access this image?', image.project.userId === testUser?.id);
  } else {
    console.log('Image not found');
  }
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });