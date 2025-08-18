#!/bin/bash
set -e

echo "Waiting for database to be ready..."
docker exec spheroseg-db pg_isready -U spheroseg -d spheroseg_prod -h localhost

echo "Creating database schema..."
docker exec spheroseg-db psql -U spheroseg -d spheroseg_prod <<EOF
-- Create basic tables if they don't exist
CREATE TABLE IF NOT EXISTS "User" (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    "emailVerified" BOOLEAN DEFAULT false,
    "verificationToken" TEXT,
    "resetToken" TEXT,
    "resetTokenExpiry" TIMESTAMP,
    "refreshToken" TEXT,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "UserProfile" (
    id TEXT PRIMARY KEY,
    "userId" TEXT UNIQUE NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    "firstName" TEXT,
    "lastName" TEXT,
    bio TEXT,
    "avatarUrl" TEXT,
    "organizationName" TEXT,
    role TEXT,
    phone TEXT,
    location TEXT,
    website TEXT,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Project" (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    "isPublic" BOOLEAN DEFAULT false,
    tags TEXT[],
    metadata JSONB,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "ProjectImage" (
    id TEXT PRIMARY KEY,
    "projectId" TEXT NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    "originalPath" TEXT NOT NULL,
    "thumbnailPath" TEXT,
    "mimeType" TEXT NOT NULL,
    size INTEGER NOT NULL,
    width INTEGER,
    height INTEGER,
    "uploadedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "segmentationStatus" TEXT DEFAULT 'pending',
    "segmentationError" TEXT,
    "segmentationStartedAt" TIMESTAMP,
    "segmentationCompletedAt" TIMESTAMP,
    metadata JSONB,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "SegmentationResult" (
    id TEXT PRIMARY KEY,
    "imageId" TEXT NOT NULL REFERENCES "ProjectImage"(id) ON DELETE CASCADE,
    "modelName" TEXT NOT NULL,
    "modelVersion" TEXT,
    result JSONB NOT NULL,
    "inferenceTime" DOUBLE PRECISION,
    "cellCount" INTEGER,
    "averageCellArea" DOUBLE PRECISION,
    "totalArea" DOUBLE PRECISION,
    confidence DOUBLE PRECISION,
    parameters JSONB,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "QueueItem" (
    id TEXT PRIMARY KEY,
    "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    "projectId" TEXT NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
    "imageId" TEXT NOT NULL REFERENCES "ProjectImage"(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'pending',
    progress INTEGER DEFAULT 0,
    "modelName" TEXT NOT NULL,
    "modelVersion" TEXT,
    priority INTEGER DEFAULT 0,
    attempts INTEGER DEFAULT 0,
    "lastError" TEXT,
    "queuedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP,
    "completedAt" TIMESTAMP,
    metadata JSONB,
    "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_user_email ON "User"(email);
CREATE INDEX IF NOT EXISTS idx_project_user ON "Project"("userId");
CREATE INDEX IF NOT EXISTS idx_image_project ON "ProjectImage"("projectId");
CREATE INDEX IF NOT EXISTS idx_result_image ON "SegmentationResult"("imageId");
CREATE INDEX IF NOT EXISTS idx_queue_status ON "QueueItem"(status);
CREATE INDEX IF NOT EXISTS idx_queue_user ON "QueueItem"("userId");

EOF

echo "Database initialized successfully!"