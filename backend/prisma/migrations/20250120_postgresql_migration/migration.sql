-- PostgreSQL Migration
-- Migrating from SQLite to PostgreSQL

-- CreateTable users
CREATE TABLE IF NOT EXISTS "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable profiles
CREATE TABLE IF NOT EXISTS "profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT,
    "avatarUrl" TEXT,
    "bio" TEXT,
    "organization" TEXT,
    "location" TEXT,
    "title" TEXT,
    "publicProfile" BOOLEAN NOT NULL DEFAULT false,
    "preferredModel" TEXT NOT NULL DEFAULT 'hrnet',
    "modelThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "preferredLang" TEXT NOT NULL DEFAULT 'cs',
    "preferredTheme" TEXT NOT NULL DEFAULT 'light',
    "emailNotifications" BOOLEAN NOT NULL DEFAULT true,
    "consentToMLTraining" BOOLEAN NOT NULL DEFAULT false,
    "consentToAlgorithmImprovement" BOOLEAN NOT NULL DEFAULT false,
    "consentToFeatureDevelopment" BOOLEAN NOT NULL DEFAULT false,
    "consentUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable projects
CREATE TABLE IF NOT EXISTS "projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable project_images
CREATE TABLE IF NOT EXISTS "project_images" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "thumbnailPath" TEXT,
    "size" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable segmentation_results
CREATE TABLE IF NOT EXISTS "segmentation_results" (
    "id" TEXT NOT NULL,
    "imageId" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "modelVersion" TEXT,
    "result" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION,
    "processingTime" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "segmentation_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable queue_items
CREATE TABLE IF NOT EXISTS "queue_items" (
    "id" TEXT NOT NULL,
    "imageId" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "queue_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable sessions
CREATE TABLE IF NOT EXISTS "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "isValid" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "profiles_userId_key" ON "profiles"("userId");
CREATE UNIQUE INDEX "profiles_username_key" ON "profiles"("username");
CREATE INDEX "projects_userId_idx" ON "projects"("userId");
CREATE INDEX "project_images_projectId_idx" ON "project_images"("projectId");
CREATE INDEX "segmentation_results_imageId_idx" ON "segmentation_results"("imageId");
CREATE INDEX "queue_items_status_priority_idx" ON "queue_items"("status", "priority");
CREATE INDEX "queue_items_imageId_idx" ON "queue_items"("imageId");
CREATE UNIQUE INDEX "sessions_refreshToken_key" ON "sessions"("refreshToken");
CREATE INDEX "idx_session_user_valid" ON "sessions"("userId", "isValid", "expiresAt");

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "projects" ADD CONSTRAINT "projects_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_images" ADD CONSTRAINT "project_images_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "segmentation_results" ADD CONSTRAINT "segmentation_results_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "project_images"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "queue_items" ADD CONSTRAINT "queue_items_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "project_images"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;