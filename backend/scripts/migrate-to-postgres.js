#!/usr/bin/env node

/**
 * SQLite to PostgreSQL Data Migration Script
 * 
 * This script migrates data from SQLite to PostgreSQL database
 * Usage: node scripts/migrate-to-postgres.js
 */

const { PrismaClient: SqliteClient } = require('@prisma/client');
const { PrismaClient: PostgresClient } = require('@prisma/client');
const fs = require('fs').promises;
const path = require('path');

// Configuration
const SQLITE_URL = process.env.SQLITE_URL || 'file:./data/dev.db';
const POSTGRES_URL = process.env.DATABASE_URL || 'postgresql://spheroseg:spheroseg_dev@localhost:5432/spheroseg';
const BATCH_SIZE = 100;

// Initialize Prisma clients
const sqliteClient = new SqliteClient({
  datasources: {
    db: {
      url: SQLITE_URL
    }
  }
});

const postgresClient = new PostgresClient({
  datasources: {
    db: {
      url: POSTGRES_URL
    }
  }
});

async function migrateUsers() {
  console.log('Migrating users...');
  const users = await sqliteClient.user.findMany({
    include: {
      profile: true,
      projects: false,
      sessions: false
    }
  });

  for (const user of users) {
    const { profile, ...userData } = user;
    
    // Create user
    await postgresClient.user.create({
      data: userData
    });

    // Create profile if exists
    if (profile) {
      await postgresClient.profile.create({
        data: profile
      });
    }
  }
  
  console.log(`✓ Migrated ${users.length} users`);
}

async function migrateProjects() {
  console.log('Migrating projects...');
  const projects = await sqliteClient.project.findMany();
  
  for (let i = 0; i < projects.length; i += BATCH_SIZE) {
    const batch = projects.slice(i, i + BATCH_SIZE);
    await postgresClient.project.createMany({
      data: batch,
      skipDuplicates: true
    });
  }
  
  console.log(`✓ Migrated ${projects.length} projects`);
}

async function migrateProjectImages() {
  console.log('Migrating project images...');
  const images = await sqliteClient.projectImage.findMany();
  
  for (let i = 0; i < images.length; i += BATCH_SIZE) {
    const batch = images.slice(i, i + BATCH_SIZE);
    await postgresClient.projectImage.createMany({
      data: batch,
      skipDuplicates: true
    });
  }
  
  console.log(`✓ Migrated ${images.length} project images`);
}

async function migrateSegmentationResults() {
  console.log('Migrating segmentation results...');
  const results = await sqliteClient.segmentationResult.findMany();
  
  for (let i = 0; i < results.length; i += BATCH_SIZE) {
    const batch = results.slice(i, i + BATCH_SIZE);
    await postgresClient.segmentationResult.createMany({
      data: batch,
      skipDuplicates: true
    });
  }
  
  console.log(`✓ Migrated ${results.length} segmentation results`);
}

async function migrateQueueItems() {
  console.log('Migrating queue items...');
  const items = await sqliteClient.queueItem.findMany({
    where: {
      status: {
        in: ['pending', 'processing']
      }
    }
  });
  
  for (const item of items) {
    await postgresClient.queueItem.create({
      data: item
    });
  }
  
  console.log(`✓ Migrated ${items.length} queue items`);
}

async function migrateSessions() {
  console.log('Migrating active sessions...');
  const sessions = await sqliteClient.session.findMany({
    where: {
      isValid: true,
      expiresAt: {
        gt: new Date()
      }
    }
  });
  
  for (const session of sessions) {
    await postgresClient.session.create({
      data: session
    });
  }
  
  console.log(`✓ Migrated ${sessions.length} active sessions`);
}

async function verifyMigration() {
  console.log('\nVerifying migration...');
  
  const sqliteCounts = {
    users: await sqliteClient.user.count(),
    projects: await sqliteClient.project.count(),
    images: await sqliteClient.projectImage.count(),
    results: await sqliteClient.segmentationResult.count()
  };
  
  const postgresCounts = {
    users: await postgresClient.user.count(),
    projects: await postgresClient.project.count(),
    images: await postgresClient.projectImage.count(),
    results: await postgresClient.segmentationResult.count()
  };
  
  console.log('\nSQLite counts:', sqliteCounts);
  console.log('PostgreSQL counts:', postgresCounts);
  
  const allMatch = Object.keys(sqliteCounts).every(
    key => sqliteCounts[key] === postgresCounts[key]
  );
  
  if (allMatch) {
    console.log('✓ Migration verified successfully!');
  } else {
    console.log('⚠ Warning: Record counts do not match');
  }
  
  return allMatch;
}

async function main() {
  console.log('Starting SQLite to PostgreSQL migration...');
  console.log(`SQLite: ${SQLITE_URL}`);
  console.log(`PostgreSQL: ${POSTGRES_URL}`);
  console.log('');
  
  try {
    // Check if SQLite database exists
    const sqliteDbPath = SQLITE_URL.replace('file:', '');
    try {
      await fs.access(sqliteDbPath);
    } catch {
      console.error('SQLite database not found at:', sqliteDbPath);
      process.exit(1);
    }
    
    // Test connections
    await sqliteClient.$connect();
    console.log('✓ Connected to SQLite');
    
    await postgresClient.$connect();
    console.log('✓ Connected to PostgreSQL');
    
    // Migrate data in order (respecting foreign keys)
    await migrateUsers();
    await migrateProjects();
    await migrateProjectImages();
    await migrateSegmentationResults();
    await migrateQueueItems();
    await migrateSessions();
    
    // Verify migration
    const success = await verifyMigration();
    
    if (success) {
      console.log('\n✅ Migration completed successfully!');
      
      // Create backup of SQLite database
      const backupPath = sqliteDbPath + '.backup-' + Date.now();
      await fs.copyFile(sqliteDbPath, backupPath);
      console.log(`✓ SQLite backup created: ${backupPath}`);
    } else {
      console.log('\n⚠ Migration completed with warnings');
    }
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await sqliteClient.$disconnect();
    await postgresClient.$disconnect();
  }
}

// Run migration
main().catch(console.error);