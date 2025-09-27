import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { logger } from '../utils/logger';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import * as path from 'path';

// ES module equivalents for __dirname and require.main
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isMainModule = import.meta.url === `file://${process.argv[1]}`;

// Load environment variables
dotenv.config();
// Segmentation models matching production configuration
const SEGMENTATION_MODELS = {
  hrnet: { id: 'hrnet', name: 'HRNetV2' },
  resunet_advanced: { id: 'resunet_advanced', name: 'ResUNet Advanced' },
  resunet_small: { id: 'resunet_small', name: 'ResUNet Small' },
};

const prisma = new PrismaClient();

async function seedDatabase(): Promise<void> {
  try {
    logger.info('Starting database seeding...', 'Seed');

    // Create admin user
    let adminEmail = process.env.ADMIN_EMAIL;
    let adminPasswordRaw = process.env.ADMIN_PASSWORD;

    // In production, abort if credentials are not provided
    if (process.env.NODE_ENV === 'production') {
      if (!adminEmail || !adminPasswordRaw) {
        logger.error(
          'ADMIN_EMAIL and ADMIN_PASSWORD must be set in production environment',
          undefined,
          'Seed'
        );
        process.exit(1);
      }
    } else {
      // In development, use secure defaults
      if (!adminEmail || !adminPasswordRaw) {
        const finalEmail = adminEmail || 'admin@example.com';
        const finalPassword =
          adminPasswordRaw || crypto.randomBytes(16).toString('hex');

        logger.info(
          'Development mode: Using temporary admin credentials',
          'Seed'
        );
        logger.info(`Admin email: ${finalEmail}`, 'Seed');
        if (!adminPasswordRaw) {
          logger.info(`Generated temporary password: ${finalPassword}`, 'Seed');
        }

        // Reassign for use below
        adminEmail = finalEmail;
        adminPasswordRaw = finalPassword;
      }
    }

    const adminPassword = await bcrypt.hash(adminPasswordRaw, 12);

    const existingAdmin = await prisma.user.findUnique({
      where: { email: adminEmail },
    });

    if (!existingAdmin) {
      await prisma.user.create({
        data: {
          email: adminEmail,
          password: adminPassword,
          emailVerified: true,
          profile: {
            create: {
              username: 'admin',
              bio: 'Administrátor systému',
              preferredModel: 'hrnet',
              modelThreshold: 0.5,
              preferredLang: 'cs',
              preferredTheme: 'light',
              emailNotifications: true,
            },
          },
        },
        include: {
          profile: true,
        },
      });
      logger.info('Admin user created', 'Seed', { email: adminEmail });
    } else {
      logger.info('Admin user already exists', 'Seed', { email: adminEmail });
    }

    // Create test user
    const testEmail = process.env.TEST_EMAIL || 'test@example.com';
    const testPasswordRaw = process.env.TEST_PASSWORD || 'test123456';
    const testPassword = await bcrypt.hash(testPasswordRaw, 12);

    const existingTest = await prisma.user.findUnique({
      where: { email: testEmail },
    });

    let testUser;
    if (!existingTest) {
      testUser = await prisma.user.create({
        data: {
          email: testEmail,
          password: testPassword,
          emailVerified: true,
          profile: {
            create: {
              username: 'testuser',
              bio: 'Testovací uživatel',
              preferredModel: 'resunet_advanced',
              modelThreshold: 0.6,
              preferredLang: 'cs',
              preferredTheme: 'dark',
              emailNotifications: false,
            },
          },
        },
        include: {
          profile: true,
        },
      });
      logger.info('Test user created', 'Seed', { email: testEmail });
    } else {
      // Ensure we have the full user with profile
      testUser = await prisma.user.findUnique({
        where: { email: testEmail },
        include: { profile: true },
      });

      // Create profile if missing
      if (!testUser?.profile) {
        await prisma.profile.create({
          data: {
            userId: existingTest.id,
            username: 'testuser',
            bio: 'Testovací uživatel',
            preferredModel: 'resunet_advanced',
            modelThreshold: 0.6,
            preferredLang: 'cs',
            preferredTheme: 'dark',
            emailNotifications: false,
          },
        });
        testUser = await prisma.user.findUnique({
          where: { email: testEmail },
          include: { profile: true },
        });
      }

      logger.info('Test user already exists', 'Seed', { email: testEmail });
    }

    // Create sample projects for test user
    if (!testUser) {
      throw new Error('Test user not found');
    }

    const existingProjects = await prisma.project.findMany({
      where: { userId: testUser.id },
    });

    if (existingProjects.length === 0) {
      const sampleProjects = [
        {
          title: 'Buněčné kultury - Experiment 1',
          description: 'Analýza růstu buněčných kultur v různých podmínkách',
          userId: testUser.id,
        },
        {
          title: 'Sféroidy - Kontrolní skupina',
          description: 'Segmentace sféroidů z kontrolní skupiny',
          userId: testUser.id,
        },
        {
          title: 'Test segmentace',
          description: 'Testovací projekt pro ověření funkčnosti segmentace',
          userId: testUser.id,
        },
      ];

      for (const projectData of sampleProjects) {
        await prisma.project.create({
          data: projectData,
        });
      }

      logger.info('Sample projects created', 'Seed', {
        count: sampleProjects.length,
      });
    } else {
      logger.info('Sample projects already exist', 'Seed', {
        count: existingProjects.length,
      });
    }

    // Create some access requests for testing
    const sampleRequests = [
      {
        email: 'researcher1@university.edu',
        name: 'Dr. Jan Novák',
        institution: 'Univerzita Karlova',
        purpose: 'Výzkum buněčných kultur pro onkologické studie',
        status: 'pending',
      },
      {
        email: 'lab@biotech.com',
        name: 'Marie Svobodová',
        institution: 'BioTech Lab s.r.o.',
        purpose: 'Analýza sféroidů pro farmaceutický výzkum',
        status: 'approved',
      },
    ];

    for (const _requestData of sampleRequests) {
      // Skipping access request seeding - table removed
      /*const existingRequest = await prisma.accessRequest.findUnique({
        where: { email: requestData.email },
      });

      // Skipping access request seeding
      */
    }

    logger.info('Database seeding completed successfully', 'Seed');

    // Print summary
    const userCount = await prisma.user.count();
    const projectCount = await prisma.project.count();
    // const requestCount = await prisma.accessRequest.count();

    logger.info('Database summary', 'Seed', {
      users: userCount,
      projects: projectCount,
      // accessRequests: requestCount,
      segmentationModels: Object.keys(SEGMENTATION_MODELS).length,
    });
  } catch (error) {
    logger.error('Database seeding failed:', error as Error, 'Seed');
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run seeding if this file is executed directly
if (isMainModule) {
  seedDatabase().catch(error => {
    logger.error('Seeding failed:', error as Error, 'Seed');
    process.exit(1);
  });
}

export default seedDatabase;
