/**
 * Database seeding script for testing
 * Creates realistic test data for development and testing
 */

import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { readFileSync } from 'fs'
import path from 'path'

const prisma = new PrismaClient()

// Load test data
const testDataPath = path.join(__dirname, 'test-data.json')
const testData = JSON.parse(readFileSync(testDataPath, 'utf-8'))

export class DatabaseSeeder {
  private prisma: PrismaClient

  constructor(prismaInstance?: PrismaClient) {
    this.prisma = prismaInstance || prisma
  }

  async clearDatabase() {
    console.log('🗑️ Clearing existing test data...')
    
    // Delete in correct order to respect foreign key constraints
    await this.prisma.segmentationResult.deleteMany()
    await this.prisma.projectImage.deleteMany()
    await this.prisma.project.deleteMany()
    await this.prisma.user.deleteMany()
    
    console.log('✅ Database cleared')
  }

  async seedUsers() {
    console.log('👥 Seeding users...')
    
    const users = []
    
    for (const userData of testData.users) {
      const hashedPassword = await bcrypt.hash(process.env.TEST_USER_PASSWORD || 'password123', 10)
      
      const user = await this.prisma.user.create({
        data: {
          id: userData.id,
          email: userData.email,
          password: hashedPassword,
          firstName: userData.firstName,
          lastName: userData.lastName,
          createdAt: new Date(userData.createdAt),
          updatedAt: new Date(userData.updatedAt)
        }
      })
      
      users.push(user)
    }
    
    console.log(`✅ Created ${users.length} users`)
    return users
  }

  async seedProjects() {
    console.log('📁 Seeding projects...')
    
    const projects = []
    
    for (const projectData of testData.projects) {
      const project = await this.prisma.project.create({
        data: {
          id: projectData.id,
          name: projectData.name,
          description: projectData.description,
          userId: projectData.userId,
          createdAt: new Date(projectData.createdAt),
          updatedAt: new Date(projectData.updatedAt),
          settings: projectData.settings as Record<string, unknown>
        }
      })
      
      projects.push(project)
    }
    
    console.log(`✅ Created ${projects.length} projects`)
    return projects
  }

  async seedProjectImages() {
    console.log('🖼️ Seeding project images...')
    
    const images = []
    
    for (const imageData of testData.projectImages) {
      const image = await this.prisma.projectImage.create({
        data: {
          id: imageData.id,
          filename: imageData.filename,
          originalName: imageData.originalName,
          mimeType: imageData.mimeType,
          size: imageData.size,
          width: imageData.width,
          height: imageData.height,
          thumbnailPath: imageData.thumbnailPath,
          projectId: imageData.projectId,
          processingStatus: imageData.processingStatus as string,
          uploadedAt: new Date(imageData.uploadedAt),
          processedAt: imageData.processedAt ? new Date(imageData.processedAt) : null,
          errorMessage: imageData.errorMessage || null,
          metadata: imageData.metadata as Record<string, unknown>
        }
      })
      
      images.push(image)
    }
    
    console.log(`✅ Created ${images.length} project images`)
    return images
  }

  async seedSegmentationResults() {
    console.log('🎯 Seeding segmentation results...')
    
    const results = []
    
    for (const resultData of testData.segmentationResults) {
      const result = await this.prisma.segmentationResult.create({
        data: {
          id: resultData.id,
          projectImageId: resultData.projectImageId,
          modelName: resultData.modelName,
          status: resultData.status as string,
          polygons: resultData.polygons as Record<string, unknown>[],
          processingTime: resultData.processingTime,
          confidence: resultData.confidence,
          totalObjects: resultData.totalObjects,
          createdAt: new Date(resultData.createdAt),
          completedAt: new Date(resultData.completedAt),
          modelVersion: resultData.modelVersion,
          postprocessingParams: resultData.postprocessingParams as Record<string, unknown>
        }
      })
      
      results.push(result)
    }
    
    console.log(`✅ Created ${results.length} segmentation results`)
    return results
  }

  async seedAll() {
    console.log('🌱 Starting database seeding...')
    
    try {
      await this.clearDatabase()
      
      await this.seedUsers()
      await this.seedProjects()
      await this.seedProjectImages()
      await this.seedSegmentationResults()
      
      console.log('🎉 Database seeding completed successfully!')
      
      // Print summary
      const counts = await this.getDatabaseCounts()
      console.log('\n📊 Database Summary:')
      console.log(`Users: ${counts.users}`)
      console.log(`Projects: ${counts.projects}`)
      console.log(`Images: ${counts.images}`)
      console.log(`Segmentation Results: ${counts.results}`)
      
    } catch (error) {
      console.error('❌ Error during database seeding:', error)
      throw error
    }
  }

  async getDatabaseCounts() {
    const [users, projects, images, results] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.project.count(),
      this.prisma.projectImage.count(),
      this.prisma.segmentationResult.count()
    ])
    
    return { users, projects, images, results }
  }

  async createTestUser(userData: {
    email: string
    password: string
    firstName: string
    lastName: string
  }) {
    const hashedPassword = await bcrypt.hash(userData.password, 10)
    
    return await this.prisma.user.create({
      data: {
        email: userData.email,
        password: hashedPassword,
        firstName: userData.firstName,
        lastName: userData.lastName
      }
    })
  }

  async createTestProject(projectData: {
    name: string
    description: string
    userId: string
  }) {
    return await this.prisma.project.create({
      data: {
        name: projectData.name,
        description: projectData.description,
        userId: projectData.userId
      }
    })
  }

  async createTestImage(imageData: {
    filename: string
    originalName: string
    mimeType: string
    size: number
    width: number
    height: number
    projectId: string
  }) {
    return await this.prisma.projectImage.create({
      data: {
        filename: imageData.filename,
        originalName: imageData.originalName,
        mimeType: imageData.mimeType,
        size: imageData.size,
        width: imageData.width,
        height: imageData.height,
        thumbnailPath: `/thumbnails/${imageData.filename}`,
        projectId: imageData.projectId,
        processingStatus: 'pending'
      }
    })
  }

  async cleanup() {
    await this.clearDatabase()
    console.log('🧹 Test data cleanup completed')
  }
}

// Utility functions for testing
export const testHelpers = {
  async createAuthenticatedUser() {
    const seeder = new DatabaseSeeder()
    const userData = {
      email: `test-${Date.now()}@example.com`,
      password: 'testpassword123',
      firstName: 'Test',
      lastName: 'User'
    }
    
    return await seeder.createTestUser(userData)
  },

  async createTestProject(userId: string) {
    const seeder = new DatabaseSeeder()
    const projectData = {
      name: `Test Project ${Date.now()}`,
      description: 'A project created for testing',
      userId
    }
    
    return await seeder.createTestProject(projectData)
  },

  async createTestImageWithSegmentation(projectId: string) {
    const seeder = new DatabaseSeeder()
    
    // Create test image
    const imageData = {
      filename: `test-image-${Date.now()}.jpg`,
      originalName: 'test-image.jpg',
      mimeType: 'image/jpeg',
      size: 1024000,
      width: 512,
      height: 512,
      projectId
    }
    
    const image = await seeder.createTestImage(imageData)
    
    // Create test segmentation result
    const segmentationResult = await prisma.segmentationResult.create({
      data: {
        projectImageId: image.id,
        modelName: 'hrnet',
        status: 'completed',
        polygons: testData.samplePolygons.simple,
        processingTime: 1500,
        confidence: 0.95,
        totalObjects: 1,
        modelVersion: '2.1.0'
      }
    })
    
    return { image, segmentationResult }
  },

  getTestPolygons() {
    return testData.samplePolygons
  },

  getMockResponses() {
    return testData.mockResponses
  },

  getTestScenarios() {
    return testData.testScenarios
  }
}

// CLI interface
if (require.main === module) {
  const command = process.argv[2]
  const seeder = new DatabaseSeeder()
  
  switch (command) {
    case 'seed':
      seeder.seedAll()
        .then(() => process.exit(0))
        .catch(err => {
          console.error(err)
          process.exit(1)
        })
      break
      
    case 'clear':
      seeder.clearDatabase()
        .then(() => {
          console.log('✅ Database cleared')
          process.exit(0)
        })
        .catch(err => {
          console.error(err)
          process.exit(1)
        })
      break
      
    case 'status':
      seeder.getDatabaseCounts()
        .then(counts => {
          console.log('📊 Database Status:')
          console.log(`Users: ${counts.users}`)
          console.log(`Projects: ${counts.projects}`)
          console.log(`Images: ${counts.images}`)
          console.log(`Segmentation Results: ${counts.results}`)
          process.exit(0)
        })
        .catch(err => {
          console.error(err)
          process.exit(1)
        })
      break
      
    default:
      console.log('Usage: tsx database-seed.ts [seed|clear|status]')
      console.log('  seed   - Seed database with test data')
      console.log('  clear  - Clear all test data')
      console.log('  status - Show current database counts')
      process.exit(1)
  }
}