# Database Schema Documentation

The Cell Segmentation Hub uses a relational database with the following schema structure. The schema is managed using Prisma ORM with SQLite for development and supports PostgreSQL for production.

## Overview

The database consists of 6 main tables that manage users, projects, images, segmentation results, and system data:

- `users` - User accounts and authentication
- `profiles` - Extended user profile information
- `projects` - User projects for organizing work
- `images` - Uploaded images and metadata
- `segmentations` - ML segmentation results
- `sessions` - User session management

## Entity Relationship Diagram

```
┌─────────────┐    ┌──────────────┐    ┌─────────────┐
│    users    │────│   profiles   │    │  sessions   │
│             │ 1:1│              │    │             │
│ - id        │    │ - userId (FK)│    │ - userId    │
│ - email     │    │ - username   │    │ - token     │
│ - password  │    │ - settings   │    │ - expires   │
└─────┬───────┘    └──────────────┘    └─────────────┘
      │ 1:N
      ▼
┌─────────────┐    ┌─────────────┐    ┌───────────────┐
│  projects   │────│   images    │────│ segmentations │
│             │ 1:N│             │ 1:1│               │
│ - id        │    │ - projectId │    │ - imageId (FK)│
│ - title     │    │ - file_path │    │ - polygons    │
│ - userId(FK)│    │ - status    │    │ - model       │
└─────────────┘    └─────────────┘    └───────────────┘
```

## Table Definitions

### users

Core user authentication and account data.

```sql
CREATE TABLE users (
    id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    email         TEXT NOT NULL UNIQUE,
    password      TEXT NOT NULL,
    emailVerified BOOLEAN NOT NULL DEFAULT false,
    verificationToken TEXT,
    resetToken    TEXT,
    resetTokenExpiry DATETIME,
    createdAt     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

**Columns:**

- `id` - UUID primary key
- `email` - User's email address (unique)
- `password` - bcrypt hashed password (salt rounds: 12)
- `emailVerified` - Email verification status
- `verificationToken` - Token for email verification
- `resetToken` - Token for password reset
- `resetTokenExpiry` - Expiration time for reset token
- `createdAt` - Account creation timestamp
- `updatedAt` - Last update timestamp

**Indexes:**

```sql
CREATE UNIQUE INDEX users_email_idx ON users(email);
CREATE INDEX users_verification_token_idx ON users(verificationToken);
CREATE INDEX users_reset_token_idx ON users(resetToken);
```

### profiles

Extended user profile and preferences.

```sql
CREATE TABLE profiles (
    id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    userId          TEXT NOT NULL UNIQUE,
    username        TEXT UNIQUE,
    avatarUrl       TEXT,
    bio             TEXT,
    preferredModel  TEXT NOT NULL DEFAULT 'hrnet',
    modelThreshold  REAL NOT NULL DEFAULT 0.5,
    preferredLang   TEXT NOT NULL DEFAULT 'cs',
    preferredTheme  TEXT NOT NULL DEFAULT 'light',
    emailNotifications BOOLEAN NOT NULL DEFAULT true,
    createdAt       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
);
```

**Columns:**

- `id` - UUID primary key
- `userId` - Reference to users table (unique, 1:1 relationship)
- `username` - Display username (unique, optional)
- `avatarUrl` - Profile picture URL
- `bio` - User biography/description
- `preferredModel` - Default segmentation model (`hrnet`, `resunet_advanced`, `resunet_small`)
- `modelThreshold` - Default threshold for segmentation (0.0-1.0, CHECK constraint enforced)
- `preferredLang` - UI language preference (`cs`, `en`)
- `preferredTheme` - UI theme preference (`light`, `dark`)
- `emailNotifications` - Email notification preference

**Indexes:**

```sql
CREATE UNIQUE INDEX profiles_userId_idx ON profiles(userId);
CREATE UNIQUE INDEX profiles_username_idx ON profiles(username);
```

**Constraints:**

```sql
CHECK (modelThreshold >= 0.0 AND modelThreshold <= 1.0);
CHECK (preferredModel IN ('hrnet', 'resunet_advanced', 'resunet_small'));
CHECK (preferredLang IN ('cs', 'en'));
CHECK (preferredTheme IN ('light', 'dark'));
```

**Note:** SQLite enforces CHECK constraints at runtime by default since version 3.37.0 (2021-11-27). Both SQLite and PostgreSQL will enforce these constraints when inserting or updating data.

### projects

User projects for organizing images and analysis.

```sql
CREATE TABLE projects (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    title       TEXT NOT NULL,
    description TEXT,
    userId      TEXT NOT NULL,
    createdAt   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
);
```

**Columns:**

- `id` - UUID primary key
- `title` - Project name/title
- `description` - Project description (optional)
- `userId` - Project owner (foreign key to users)
- `createdAt` - Project creation timestamp
- `updatedAt` - Last modification timestamp

**Indexes:**

```sql
CREATE INDEX projects_userId_idx ON projects(userId);
CREATE INDEX projects_updatedAt_idx ON projects(updatedAt DESC);
```

### images

Uploaded images and their metadata.

```sql
CREATE TABLE images (
    id                 TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name               TEXT NOT NULL,
    originalPath       TEXT NOT NULL,
    thumbnailPath      TEXT,
    projectId          TEXT NOT NULL,
    segmentationStatus TEXT NOT NULL DEFAULT 'pending',
    fileSize           INTEGER,
    width              INTEGER,
    height             INTEGER,
    mimeType           TEXT,
    createdAt          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE
);
```

**Columns:**

- `id` - UUID primary key
- `name` - Original filename
- `originalPath` - Path to original image file
- `thumbnailPath` - Path to thumbnail image (optional)
- `projectId` - Parent project (foreign key)
- `segmentationStatus` - Processing status (`pending`, `processing`, `completed`, `failed`)
- `fileSize` - File size in bytes
- `width` - Image width in pixels
- `height` - Image height in pixels
- `mimeType` - MIME type (e.g., `image/jpeg`)

**Indexes:**

```sql
CREATE INDEX images_projectId_idx ON images(projectId);
CREATE INDEX images_status_idx ON images(segmentationStatus);
CREATE INDEX images_createdAt_idx ON images(createdAt DESC);
```

**Constraints:**

```sql
CHECK (segmentationStatus IN ('pending', 'processing', 'completed', 'failed'));
CHECK (fileSize > 0);
CHECK (width > 0 AND height > 0);
```

### segmentations

ML segmentation results and polygon data.

```sql
CREATE TABLE segmentations (
    id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    imageId        TEXT NOT NULL UNIQUE,
    polygons       TEXT NOT NULL,
    model          TEXT NOT NULL,
    threshold      REAL NOT NULL,
    confidence     REAL,
    processingTime INTEGER,
    createdAt      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (imageId) REFERENCES images(id) ON DELETE CASCADE
);
```

**Columns:**

- `id` - UUID primary key
- `imageId` - Reference to images table (unique, 1:1 relationship)
- `polygons` - JSON string containing polygon data
- `model` - Model used for segmentation
- `threshold` - Threshold value used (0.0-1.0, CHECK constraint enforced)
- `confidence` - Overall confidence score (0.0-1.0, nullable, CHECK constraint enforced when not NULL)
- `processingTime` - Processing time in milliseconds

**JSON Structure for polygons:**

```json
[
  {
    "id": "polygon_1",
    "points": [
      { "x": 100.5, "y": 200.3 },
      { "x": 150.2, "y": 180.7 },
      { "x": 160.1, "y": 220.9 }
    ],
    "area": 1250.5,
    "confidence": 0.89
  }
]
```

**Indexes:**

```sql
CREATE UNIQUE INDEX segmentations_imageId_idx ON segmentations(imageId);
CREATE INDEX segmentations_model_idx ON segmentations(model);
CREATE INDEX segmentations_createdAt_idx ON segmentations(createdAt DESC);
```

**Constraints:**

```sql
CHECK (threshold >= 0.0 AND threshold <= 1.0);
CHECK (confidence IS NULL OR (confidence >= 0.0 AND confidence <= 1.0));
CHECK (processingTime IS NULL OR processingTime > 0);
```

### sessions

User session management for refresh tokens.

```sql
CREATE TABLE sessions (
    id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    userId       TEXT NOT NULL,
    refreshToken TEXT NOT NULL UNIQUE,
    userAgent    TEXT,
    ipAddress    TEXT,
    isValid      BOOLEAN NOT NULL DEFAULT true,
    expiresAt    DATETIME NOT NULL,
    createdAt    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
);
```

**Columns:**

- `id` - UUID primary key
- `userId` - Session owner
- `refreshToken` - JWT refresh token (unique)
- `userAgent` - Client user agent string
- `ipAddress` - Client IP address
- `isValid` - Session validity flag
- `expiresAt` - Session expiration time
- `createdAt` - Session creation time

**Indexes:**

```sql
CREATE UNIQUE INDEX sessions_refreshToken_idx ON sessions(refreshToken);
CREATE INDEX sessions_userId_idx ON sessions(userId);
CREATE INDEX sessions_expiresAt_idx ON sessions(expiresAt);
```

## Relationships

### One-to-One Relationships

- `users` ↔ `profiles` (user profile data)
- `images` ↔ `segmentations` (segmentation results)

### One-to-Many Relationships

- `users` → `projects` (user's projects)
- `users` → `sessions` (user's active sessions)
- `projects` → `images` (project's images)

### Foreign Key Constraints

All foreign keys use `ON DELETE CASCADE` to maintain referential integrity:

- Deleting a user removes their profile, projects, and sessions
- Deleting a project removes all its images
- Deleting an image removes its segmentation data

## Data Access Patterns

### Common Queries

#### User Authentication

```sql
-- Login verification
SELECT u.id, u.email, u.password, p.*
FROM users u
LEFT JOIN profiles p ON u.id = p.userId
WHERE u.email = ?;

-- Session validation
SELECT s.userId, s.isValid, s.expiresAt
FROM sessions s
WHERE s.refreshToken = ? AND s.isValid = true;
```

#### Project Management

```sql
-- User's projects with image counts
SELECT p.*, COUNT(i.id) as imageCount
FROM projects p
LEFT JOIN images i ON p.id = i.projectId
WHERE p.userId = ?
GROUP BY p.id
ORDER BY p.updatedAt DESC;

-- Project details with images
SELECT p.*, i.*, s.confidence, s.model
FROM projects p
LEFT JOIN images i ON p.id = i.projectId
LEFT JOIN segmentations s ON i.id = s.imageId
WHERE p.id = ? AND p.userId = ?;
```

#### Image Processing

```sql
-- Pending segmentation images
SELECT i.id, i.name, i.originalPath, p.userId
FROM images i
JOIN projects p ON i.projectId = p.id
WHERE i.segmentationStatus = 'pending'
ORDER BY i.createdAt ASC;

-- Completed segmentations
SELECT i.*, s.polygons, s.confidence, s.processingTime
FROM images i
JOIN segmentations s ON i.id = s.imageId
WHERE i.projectId = ?;
```

## Performance Considerations

### Indexing Strategy

- **Primary Keys**: All tables use UUID primary keys for scalability
- **Foreign Keys**: All foreign key columns are indexed
- **Queries**: Common query patterns have supporting indexes
- **Timestamps**: Creation and update timestamps are indexed for sorting

### Query Optimization

- **Selective Queries**: Use specific column selection instead of `SELECT *`
- **JOIN Optimization**: Use appropriate JOIN types based on data relationships
- **Pagination**: Implement cursor-based pagination for large result sets
- **Connection Pooling**: Use connection pooling for high-concurrency scenarios

### Data Growth Management

- **Archiving**: Old segmentation data can be archived to separate tables
- **Cleanup**: Regular cleanup of expired sessions and tokens
- **Monitoring**: Track table sizes and query performance

## Migration History

### Initial Schema (v1.0)

- Basic user authentication
- Project and image management
- Simple segmentation storage

### Schema Updates

- v1.1: Added user profiles and preferences
- v1.2: Enhanced session management
- v1.3: Added access request system
- v1.4: Improved indexing and constraints

## Environment Configurations

### Development (SQLite)

```
DATABASE_URL="file:./dev.db"
```

### Testing (In-Memory SQLite)

```
DATABASE_URL="file::memory:?cache=shared"
```

### Production (PostgreSQL)

```
DATABASE_URL="postgresql://user:password@localhost:5432/cellseg?schema=public"
```

## Backup and Maintenance

### Backup Strategy

- **Development**: Manual database file backup
- **Production**: Automated daily backups with point-in-time recovery
- **Testing**: No backup needed (ephemeral data)

### Maintenance Tasks

```sql
BEGIN TRANSACTION;

-- Clean expired sessions
DELETE FROM sessions WHERE expiresAt < datetime('now');

-- Clean expired reset tokens
UPDATE users SET resetToken = NULL, resetTokenExpiry = NULL
WHERE resetTokenExpiry < datetime('now');

-- Archive old segmentation data (optional)
-- Move segmentations older than 1 year to archive table

COMMIT;
```

## Security Considerations

### Data Protection

- **Password Hashing**: bcrypt with high salt rounds
- **Token Security**: JWT tokens with appropriate expiration
- **Data Encryption**: Sensitive fields encrypted at application level
- **Access Control**: Row-level security for multi-tenant scenarios

### Audit Trail

- **Timestamps**: All tables include creation and update timestamps
- **User Tracking**: Actions tied to specific user accounts
- **Session Logging**: User session activity tracking
- **Data Changes**: Consider implementing audit log tables for sensitive operations

For implementation details, see the [Prisma Schema File](../../backend/prisma/schema.prisma) and [Backend Architecture](../architecture/backend.md).
