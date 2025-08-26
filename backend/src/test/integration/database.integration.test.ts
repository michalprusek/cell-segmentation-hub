import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals'
import { PrismaClient, User } from '@prisma/client'
import bcrypt from 'bcryptjs'

// Integration tests need real Prisma client - disable mocks
jest.unmock('@prisma/client')

describe('Database Integration Tests', () => {
  let prisma: PrismaClient

  beforeAll(async () => {
    // Use environment variable directly - CI/CD sets DATABASE_URL
    const databaseUrl = process.env.DATABASE_URL || process.env.TEST_DATABASE_URL || 'postgresql://postgres:testpass@localhost:5432/testdb'
    
    // For CI/CD environment, ensure we have a valid PostgreSQL URL
    if (!databaseUrl.startsWith('postgresql://') && !databaseUrl.startsWith('postgres://')) {
      console.warn('Invalid DATABASE_URL, using default PostgreSQL URL for tests')
      process.env.DATABASE_URL = 'postgresql://postgres:testpass@localhost:5432/testdb'
    } else {
      process.env.DATABASE_URL = databaseUrl
    }
    
    prisma = new PrismaClient()

    // Clean database - delete in correct order to avoid FK constraints
    try {
      await prisma.$transaction(async (tx) => {
        // Delete in order respecting foreign key constraints
        await tx.segmentationQueue.deleteMany();
        await tx.segmentation.deleteMany();
        await tx.image.deleteMany();
        await tx.session.deleteMany();
        await tx.project.deleteMany();
        await tx.profile.deleteMany();
        await tx.user.deleteMany();
      });
    } catch (error) {
      // Log full error details for debugging
      console.error('Database cleanup failed during setup:', {
        message: error.message,
        stack: error.stack,
        code: error.code
      });
      // Rethrow to fail the test setup
      throw new Error(`Failed to clean database: ${error.message}`);
    }
  })

  afterAll(async () => {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.segmentationQueue.deleteMany().catch(() => {});
        await tx.segmentation.deleteMany().catch(() => {});
        await tx.image.deleteMany().catch(() => {});
        await tx.project.deleteMany().catch(() => {});
        await tx.session.deleteMany().catch(() => {});
        await tx.profile.deleteMany().catch(() => {});
        await tx.user.deleteMany().catch(() => {});
      });
    } catch (error) {
      console.warn('Database cleanup failed in afterAll:', error)
    }
    await prisma.$disconnect()
  })

  describe('User Management', () => {
    let testUser: User

    it('should create user with hashed password', async () => {
      const userData = {
        email: 'db-test@example.com',
        password: await bcrypt.hash('password123', 10)
      }

      testUser = await prisma.user.create({ data: userData })

      expect(testUser.id).toBeDefined()
      expect(testUser.email).toBe(userData.email)
      expect(testUser.password).toBe(userData.password)
      expect(testUser.createdAt).toBeInstanceOf(Date)
      expect(testUser.updatedAt).toBeInstanceOf(Date)
    })

    it('should find user by email', async () => {
      const foundUser = await prisma.user.findUnique({
        where: { email: 'db-test@example.com' }
      })

      expect(foundUser).not.toBeNull()
      expect(foundUser?.id).toBe(testUser.id)
    })

    it('should update user information', async () => {
      const updatedUser = await prisma.user.update({
        where: { id: testUser.id },
        data: { password: await bcrypt.hash('newpassword', 10) }
      })

      expect(updatedUser.password).toBeDefined()
      expect(updatedUser.updatedAt).not.toBe(testUser.updatedAt)
    })

    it('should enforce email uniqueness', async () => {
      await expect(
        prisma.user.create({
          data: {
            email: 'db-test@example.com', // Duplicate email
            password: 'password'
          }
        })
      ).rejects.toThrow(expect.objectContaining({
        code: 'P2002' // Prisma unique constraint violation
      }))
    })
  })

  describe('Project Management', () => {
    let testProjectUser: User
    let testProject: any

    beforeAll(async () => {
      testProjectUser = await prisma.user.create({
        data: {
          email: 'project-test@example.com',
          password: await bcrypt.hash('password', 10)
        }
      })
    })

    it('should create project with user relation', async () => {
      testProject = await prisma.project.create({
        data: {
          title: 'Test Project',
          description: 'A test project',
          userId: testProjectUser.id
        },
        include: {
          user: true
        }
      })

      expect(testProject.id).toBeDefined()
      expect(testProject.title).toBe('Test Project')
      expect(testProject.userId).toBe(testProjectUser.id)
      expect(testProject.user.email).toBe(testProjectUser.email)
    })

    it('should get projects by user', async () => {
      const userProjects = await prisma.project.findMany({
        where: { userId: testProjectUser.id },
        include: { images: true }
      })

      expect(userProjects).toHaveLength(1)
      expect(userProjects[0]?.id).toBe(testProject.id)
    })

    it('should cascade delete projects when user is deleted', async () => {
      const tempUser = await prisma.user.create({
        data: {
          email: 'temp@example.com',
          password: 'password',
          // Note: firstName/lastName moved to Profile model
        }
      })

      await prisma.project.create({
        data: {
          title: 'Temp Project',
          description: 'Will be deleted',
          userId: tempUser.id
        }
      })

      await prisma.user.delete({ where: { id: tempUser.id } })

      const orphanedProjects = await prisma.project.findMany({
        where: { userId: tempUser.id }
      })

      expect(orphanedProjects).toHaveLength(0)
    })
  })

  describe('Image Management', () => {
    let testUser: any
    let testProject: any
    let testImage: any

    beforeAll(async () => {
      testUser = await prisma.user.create({
        data: {
          email: 'image-test@example.com',
          password: await bcrypt.hash('password', 10)
        }
      })

      testProject = await prisma.project.create({
        data: {
          title: 'Image Test Project',
          description: 'For testing images',
          userId: testUser.id
        }
      })
    })

    it('should create project image', async () => {
      testImage = await prisma.image.create({
        data: {
          name: 'test-image.jpg',
          originalPath: '/uploads/test-image.jpg',
          thumbnailPath: '/thumbnails/test-image-thumb.jpg',
          projectId: testProject.id,
          segmentationStatus: 'no_segmentation',
          fileSize: 1024000,
          width: 1920,
          height: 1080,
          mimeType: 'image/jpeg'
        },
        include: {
          project: true
        }
      })

      expect(testImage.id).toBeDefined()
      expect(testImage.name).toBe('test-image.jpg')
      expect(testImage.projectId).toBe(testProject.id)
      expect(testImage.project.title).toBe(testProject.title)
      expect(testImage.createdAt).toBeInstanceOf(Date)
    })

    it('should update image processing status', async () => {
      const updatedImage = await prisma.image.update({
        where: { id: testImage.id },
        data: {
          segmentationStatus: 'segmented',
          updatedAt: new Date()
        }
      })

      expect(updatedImage.segmentationStatus).toBe('segmented')
      expect(updatedImage.updatedAt).toBeInstanceOf(Date)
    })

    it('should get images by project', async () => {
      const projectImages = await prisma.image.findMany({
        where: { projectId: testProject.id },
        orderBy: { createdAt: 'desc' }
      })

      expect(projectImages).toHaveLength(1)
      expect(projectImages[0]?.id).toBe(testImage.id)
    })
  })

  describe('Segmentation Results', () => {
    let testUser: any
    let testProject: any
    let testImage: any
    let testSegmentation: any

    beforeAll(async () => {
      testUser = await prisma.user.create({
        data: {
          email: 'seg-test@example.com',
          password: await bcrypt.hash('password', 10),
          // Note: firstName/lastName moved to Profile model
        }
      })

      testProject = await prisma.project.create({
        data: {
          title: 'Segmentation Test Project',
          description: 'For testing segmentation',
          userId: testUser.id
        }
      })

      testImage = await prisma.image.create({
        data: {
          name: 'seg-test-image.jpg',
          originalPath: '/uploads/seg-test-image.jpg',
          thumbnailPath: '/thumbnails/seg-test-image-thumb.jpg',
          projectId: testProject.id,
          segmentationStatus: 'segmented',
          fileSize: 1024000,
          width: 1920,
          height: 1080,
          mimeType: 'image/jpeg'
        }
      })
    })

    it('should create segmentation result', async () => {
      const polygons = [
        {
          points: [[100, 100], [200, 100], [200, 200], [100, 200]],
          confidence: 0.95,
          area: 10000,
          centroid: [150, 150]
        }
      ]

      testSegmentation = await prisma.segmentation.create({
        data: {
          imageId: testImage.id,
          model: 'hrnet',
          threshold: 0.5,
          polygons: JSON.stringify(polygons),
          confidence: 0.95,
          processingTime: 1500
        },
        include: {
          image: {
            include: {
              project: true
            }
          }
        }
      })

      expect(testSegmentation.id).toBeDefined()
      expect(testSegmentation.model).toBe('hrnet')
      expect(JSON.parse(testSegmentation.polygons)).toEqual(polygons)
      expect(testSegmentation.image.id).toBe(testImage.id)
    })

    it('should find segmentation results by image', async () => {
      const imageSegmentations = await prisma.segmentation.findMany({
        where: { imageId: testImage.id },
        orderBy: { createdAt: 'desc' }
      })

      expect(imageSegmentations).toHaveLength(1)
      expect(imageSegmentations[0]?.id).toBe(testSegmentation.id)
    })

    it('should update segmentation confidence', async () => {
      const updatedSegmentation = await prisma.segmentation.update({
        where: { id: testSegmentation.id },
        data: {
          confidence: 0.85,
          updatedAt: new Date()
        }
      })

      expect(updatedSegmentation.confidence).toBe(0.85)
      expect(updatedSegmentation.updatedAt).toBeInstanceOf(Date)
    })
  })

  describe('Complex Queries', () => {
    let testUser: any
    let testProjects: any[]

    beforeAll(async () => {
      testUser = await prisma.user.create({
        data: {
          email: 'complex-test@example.com',
          password: await bcrypt.hash('password', 10),
          // Note: firstName/lastName moved to Profile model
        }
      })

      // Create multiple projects with images and segmentations
      testProjects = await Promise.all([
        prisma.project.create({
          data: {
            title: 'Project A',
            description: 'First project',
            userId: testUser.id,
            images: {
              create: [
                {
                  name: 'imageA1.jpg',
                  originalPath: 'imageA1.jpg',
                  mimeType: 'image/jpeg',
                  fileSize: 1000000,
                  width: 1000,
                  height: 1000,
                  segmentationStatus: 'segmented',
                  segmentation: {
                    create: {
                      model: 'hrnet',
                      threshold: 0.5,
                      polygons: JSON.stringify([{ points: [[0, 0], [10, 0], [10, 10], [0, 10]] }]),
                      processingTime: 1000
                    }
                  }
                },
                {
                  name: 'imageA2.jpg',
                  originalPath: 'imageA2.jpg',
                  mimeType: 'image/jpeg',
                  fileSize: 1000000,
                  width: 1000,
                  height: 1000,
                  segmentationStatus: 'pending'
                }
              ]
            }
          }
        }),
        prisma.project.create({
          data: {
            title: 'Project B',
            description: 'Second project',
            userId: testUser.id,
            images: {
              create: [
                {
                  name: 'imageB1.jpg',
                  originalPath: 'imageB1.jpg',
                  mimeType: 'image/jpeg',
                  fileSize: 1000000,
                  width: 1000,
                  height: 1000,
                  segmentationStatus: 'segmented'
                }
              ]
            }
          }
        })
      ])
    })

    it('should get user with all projects, images, and segmentations', async () => {
      const userWithData = await prisma.user.findUnique({
        where: { id: testUser.id },
        include: {
          projects: {
            include: {
              images: {
                include: {
                  segmentation: true
                }
              }
            }
          }
        }
      })

      expect(userWithData?.projects).toHaveLength(2)
      expect(userWithData?.projects?.[0]?.images).toBeDefined()
      // Check that at least one image has a segmentation object (not array)
      const hasSegmentation = userWithData?.projects?.[0]?.images?.some(img => 
        img.segmentation !== null && 
        typeof img.segmentation === 'object' && 
        !Array.isArray(img.segmentation)
      )
      expect(hasSegmentation).toBe(true)
    })

    it('should count images by processing status', async () => {
      const statusCounts = await prisma.image.groupBy({
        by: ['segmentationStatus'],
        where: {
          project: {
            userId: testUser.id
          }
        },
        _count: {
          segmentationStatus: true
        }
      })

      const segmentedCount = statusCounts.find(s => s.segmentationStatus === 'segmented')?._count.segmentationStatus || 0
      const pendingCount = statusCounts.find(s => s.segmentationStatus === 'pending')?._count.segmentationStatus || 0

      expect(segmentedCount).toBe(2)
      expect(pendingCount).toBe(1)
    })

    it('should find projects with completed segmentations', async () => {
      const projectsWithSegmentations = await prisma.project.findMany({
        where: {
          userId: testUser.id,
          images: {
            some: {
              segmentation: {
                model: 'hrnet'
              }
            }
          }
        },
        include: {
          images: {
            include: {
              segmentation: true
            }
          }
        }
      })

      expect(projectsWithSegmentations).toHaveLength(1)
      expect(projectsWithSegmentations[0]?.title).toBe('Project A')
    })
  })

  describe('Transactions', () => {
    let testUser: any

    beforeAll(async () => {
      testUser = await prisma.user.create({
        data: {
          email: 'transaction-test@example.com',
          password: await bcrypt.hash('password', 10),
          // Note: firstName/lastName moved to Profile model
        }
      })
    })

    it('should rollback transaction on error', async () => {
      const initialProjectCount = await prisma.project.count({
        where: { userId: testUser.id }
      })

      try {
        await prisma.$transaction(async (tx) => {
          // Create a project
          await tx.project.create({
            data: {
              title: 'Transaction Test Project',
              description: 'Should be rolled back',
              userId: testUser.id
            }
          })

          // Simulate an error
          throw new Error('Simulated transaction error')
        })
      } catch (error) {
        // Expected to fail
      }

      const finalProjectCount = await prisma.project.count({
        where: { userId: testUser.id }
      })

      expect(finalProjectCount).toBe(initialProjectCount)
    })

    it('should commit successful transaction', async () => {
      const initialProjectCount = await prisma.project.count({
        where: { userId: testUser.id }
      })

      await prisma.$transaction(async (tx) => {
        await tx.project.create({
          data: {
            title: 'Successful Transaction Project',
            description: 'Should be committed',
            userId: testUser.id
          }
        })

        await tx.project.create({
          data: {
            title: 'Another Successful Project',
            description: 'Should also be committed',
            userId: testUser.id
          }
        })
      })

      const finalProjectCount = await prisma.project.count({
        where: { userId: testUser.id }
      })

      expect(finalProjectCount).toBe(initialProjectCount + 2)
    })
  })

  describe('Performance Tests', () => {
    it('should handle bulk inserts efficiently', async () => {
      const startTime = Date.now()

      // Create user for bulk test
      const bulkUser = await prisma.user.create({
        data: {
          email: 'bulk-test@example.com',
          password: await bcrypt.hash('password', 10),
          // Note: firstName/lastName moved to Profile model
        }
      })

      // Create multiple projects
      const projectData = Array.from({ length: 10 }, (_, i) => ({
        title: `Bulk Project ${i + 1}`,
        description: `Bulk test project ${i + 1}`,
        userId: bulkUser.id
      }))

      await prisma.project.createMany({
        data: projectData
      })

      const endTime = Date.now()
      const duration = endTime - startTime

      // Should complete within reasonable time (adjust based on hardware)
      expect(duration).toBeLessThan(5000) // 5 seconds

      // Verify all projects were created
      const createdProjects = await prisma.project.count({
        where: { userId: bulkUser.id }
      })

      expect(createdProjects).toBe(10)
    })
  })
})