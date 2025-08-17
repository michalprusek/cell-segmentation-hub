-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "verificationToken" TEXT,
    "resetToken" TEXT,
    "resetTokenExpiry" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "profiles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "username" TEXT,
    "avatarUrl" TEXT,
    "bio" TEXT,
    "organization" TEXT,
    "location" TEXT,
    "title" TEXT,
    "publicProfile" BOOLEAN NOT NULL DEFAULT false,
    "preferredModel" TEXT NOT NULL DEFAULT 'hrnet',
    "modelThreshold" REAL NOT NULL DEFAULT 0.5,
    "preferredLang" TEXT NOT NULL DEFAULT 'cs',
    "preferredTheme" TEXT NOT NULL DEFAULT 'light',
    "emailNotifications" BOOLEAN NOT NULL DEFAULT true,
    "consentToMLTraining" BOOLEAN NOT NULL DEFAULT true,
    "consentToAlgorithmImprovement" BOOLEAN NOT NULL DEFAULT true,
    "consentToFeatureDevelopment" BOOLEAN NOT NULL DEFAULT true,
    "consentUpdatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "projects_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "images" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "originalPath" TEXT NOT NULL,
    "thumbnailPath" TEXT,
    "projectId" TEXT NOT NULL,
    "segmentationStatus" TEXT NOT NULL DEFAULT 'no_segmentation',
    "fileSize" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "mimeType" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "images_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "segmentations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "imageId" TEXT NOT NULL,
    "polygons" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "threshold" REAL NOT NULL,
    "confidence" REAL,
    "processingTime" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "imageHeight" INTEGER,
    "imageWidth" INTEGER,
    CONSTRAINT "segmentations_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "images" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "segmentation_thumbnails" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "segmentationId" TEXT NOT NULL,
    "levelOfDetail" TEXT NOT NULL,
    "simplifiedData" TEXT NOT NULL,
    "polygonCount" INTEGER NOT NULL,
    "pointCount" INTEGER NOT NULL,
    "compressionRatio" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "segmentation_thumbnails_segmentationId_fkey" FOREIGN KEY ("segmentationId") REFERENCES "segmentations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "segmentation_queue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "imageId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT 'hrnet',
    "threshold" REAL NOT NULL DEFAULT 0.5,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "error" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "batchId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    CONSTRAINT "segmentation_queue_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "segmentation_queue_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "segmentation_queue_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "images" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "isValid" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_userId_key" ON "profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_username_key" ON "profiles"("username");

-- CreateIndex
CREATE INDEX "idx_project_user_updated" ON "projects"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "idx_image_project_status" ON "images"("projectId", "segmentationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "segmentations_imageId_key" ON "segmentations"("imageId");

-- CreateIndex
CREATE INDEX "idx_thumbnail_segmentation_lod" ON "segmentation_thumbnails"("segmentationId", "levelOfDetail");

-- CreateIndex
CREATE UNIQUE INDEX "segmentation_thumbnails_segmentationId_levelOfDetail_key" ON "segmentation_thumbnails"("segmentationId", "levelOfDetail");

-- CreateIndex
CREATE INDEX "idx_queue_status_priority" ON "segmentation_queue"("status", "priority", "createdAt");

-- CreateIndex
CREATE INDEX "idx_project_status" ON "segmentation_queue"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refreshToken_key" ON "sessions"("refreshToken");

-- CreateIndex
CREATE INDEX "idx_session_user_valid" ON "sessions"("userId", "isValid", "expiresAt");

