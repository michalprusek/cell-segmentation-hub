# Cell Segmentation Hub - API Documentation

## Overview

The Cell Segmentation Hub provides a RESTful API for image segmentation, project management, and data export. All API endpoints require authentication unless specified otherwise.

## Base URLs

- **Development**: `http://localhost:3001`
- **Production Blue**: `https://spherosegapp.utia.cas.cz:4001`
- **Production Green**: `https://spherosegapp.utia.cas.cz:5001`

## Authentication

### JWT Token Authentication

All authenticated endpoints require a Bearer token in the Authorization header:

```http
Authorization: Bearer <jwt_token>
```

### Login
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}

Response: 200 OK
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "John Doe"
  }
}
```

### Register
```http
POST /api/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123",
  "name": "John Doe"
}

Response: 201 Created
{
  "message": "User created successfully",
  "userId": "uuid"
}
```

### Refresh Token
```http
POST /api/auth/refresh
Content-Type: application/json

{
  "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
}

Response: 200 OK
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

## Projects

### Create Project
```http
POST /api/projects
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "My Research Project",
  "description": "Cell segmentation for research",
  "pixelSize": 0.25,
  "unit": "µm"
}

Response: 201 Created
{
  "id": "uuid",
  "name": "My Research Project",
  "description": "Cell segmentation for research",
  "pixelSize": 0.25,
  "unit": "µm",
  "createdAt": "2024-01-01T00:00:00Z"
}
```

### List Projects
```http
GET /api/projects
Authorization: Bearer <token>

Query Parameters:
- page (optional): Page number (default: 1)
- limit (optional): Items per page (default: 10)
- search (optional): Search term

Response: 200 OK
{
  "projects": [
    {
      "id": "uuid",
      "name": "Project Name",
      "imageCount": 42,
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ],
  "total": 100,
  "page": 1,
  "totalPages": 10
}
```

### Get Project Details
```http
GET /api/projects/:projectId
Authorization: Bearer <token>

Response: 200 OK
{
  "id": "uuid",
  "name": "Project Name",
  "description": "Description",
  "pixelSize": 0.25,
  "unit": "µm",
  "imageCount": 42,
  "images": [
    {
      "id": "uuid",
      "name": "image.jpg",
      "status": "completed",
      "thumbnailUrl": "/api/images/uuid/thumbnail",
      "segmentationResults": {...}
    }
  ]
}
```

## Images

### Upload Images
```http
POST /api/projects/:projectId/images/upload
Authorization: Bearer <token>
Content-Type: multipart/form-data

FormData:
- images: File[] (multiple image files)
- batchId: string (optional batch identifier)

Response: 200 OK
{
  "uploadedImages": [
    {
      "id": "uuid",
      "name": "image1.jpg",
      "size": 2048576,
      "status": "pending"
    }
  ],
  "batchId": "batch-uuid",
  "totalCount": 10
}
```

### Get Image
```http
GET /api/images/:imageId
Authorization: Bearer <token>

Response: 200 OK
{
  "id": "uuid",
  "name": "image.jpg",
  "projectId": "project-uuid",
  "status": "completed",
  "width": 1920,
  "height": 1080,
  "segmentationResults": {
    "polygons": [...],
    "modelUsed": "HRNet",
    "processingTime": 2.5
  }
}
```

### Delete Image
```http
DELETE /api/images/:imageId
Authorization: Bearer <token>

Response: 204 No Content
```

## Segmentation

### Start Segmentation
```http
POST /api/segmentation/start
Authorization: Bearer <token>
Content-Type: application/json

{
  "imageIds": ["uuid1", "uuid2"],
  "model": "HRNet",
  "parameters": {
    "threshold": 0.5,
    "minArea": 100
  }
}

Response: 200 OK
{
  "queueItems": [
    {
      "imageId": "uuid1",
      "position": 1,
      "status": "queued"
    },
    {
      "imageId": "uuid2",
      "position": 2,
      "status": "queued"
    }
  ],
  "estimatedTime": 60
}
```

### Get Segmentation Status
```http
GET /api/segmentation/status/:imageId
Authorization: Bearer <token>

Response: 200 OK
{
  "imageId": "uuid",
  "status": "processing",
  "progress": 75,
  "position": 3,
  "totalInQueue": 10
}
```

### Cancel Segmentation
```http
POST /api/segmentation/cancel/:imageId
Authorization: Bearer <token>

Response: 200 OK
{
  "message": "Segmentation cancelled",
  "imageId": "uuid"
}
```

### Get Segmentation Results
```http
GET /api/segmentation/results/:imageId
Authorization: Bearer <token>

Response: 200 OK
{
  "imageId": "uuid",
  "polygons": [
    {
      "id": "poly-1",
      "points": [[x1,y1], [x2,y2], ...],
      "area": 1500.5,
      "perimeter": 150.2,
      "circularity": 0.85
    }
  ],
  "metrics": {
    "totalCells": 42,
    "averageArea": 1200.3,
    "processingTime": 2.5
  }
}
```

## Export

### Create Export Job
```http
POST /api/export/create
Authorization: Bearer <token>
Content-Type: application/json

{
  "projectId": "uuid",
  "imageIds": ["uuid1", "uuid2"],
  "format": "coco",
  "options": {
    "includeImages": true,
    "includeMetrics": true,
    "scale": 1.0
  }
}

Response: 200 OK
{
  "exportId": "export-uuid",
  "status": "processing",
  "format": "coco",
  "estimatedSize": 104857600
}
```

### Get Export Status
```http
GET /api/export/status/:exportId
Authorization: Bearer <token>

Response: 200 OK
{
  "exportId": "export-uuid",
  "status": "completed",
  "progress": 100,
  "downloadUrl": "/api/export/download/export-uuid",
  "expiresAt": "2024-01-02T00:00:00Z"
}
```

### Download Export
```http
GET /api/export/download/:exportId
Authorization: Bearer <token>

Response: 200 OK
Content-Type: application/zip
Content-Disposition: attachment; filename="export.zip"

[Binary ZIP data]
```

### Cancel Export
```http
POST /api/export/cancel/:exportId
Authorization: Bearer <token>

Response: 200 OK
{
  "message": "Export cancelled",
  "exportId": "export-uuid"
}
```

## WebSocket Events

Connect to WebSocket for real-time updates:

```javascript
const socket = io('http://localhost:3001', {
  auth: {
    token: 'Bearer <jwt_token>'
  }
});
```

### Events

#### Segmentation Status
```javascript
socket.on('segmentationStatus', (data) => {
  console.log(data);
  // {
  //   imageId: "uuid",
  //   status: "processing",
  //   progress: 50,
  //   position: 2
  // }
});
```

#### Export Progress
```javascript
socket.on('exportProgress', (data) => {
  console.log(data);
  // {
  //   exportId: "uuid",
  //   progress: 75,
  //   status: "processing"
  // }
});
```

#### Queue Update
```javascript
socket.on('queueUpdate', (data) => {
  console.log(data);
  // {
  //   queueLength: 10,
  //   processing: 3,
  //   estimatedTime: 120
  // }
});
```

## Rate Limits

Different endpoints have different rate limits:

- **General API**: 10 req/s
- **API endpoints**: 30 req/s (burst: 80)
- **Segmentation**: 100 req/s (burst: 100)
- **Upload**: 5 req/s (burst: 10)
- **Download**: 10 req/s

Rate limit headers:
```http
X-RateLimit-Limit: 30
X-RateLimit-Remaining: 25
X-RateLimit-Reset: 1704067200
```

## Error Responses

### Standard Error Format
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable error message",
    "details": {
      "field": "Additional error context"
    }
  }
}
```

### Common Error Codes

- `400 Bad Request` - Invalid request parameters
- `401 Unauthorized` - Missing or invalid authentication
- `403 Forbidden` - Insufficient permissions
- `404 Not Found` - Resource not found
- `409 Conflict` - Resource already exists
- `413 Payload Too Large` - File size exceeds limit
- `429 Too Many Requests` - Rate limit exceeded
- `500 Internal Server Error` - Server error
- `503 Service Unavailable` - Service temporarily unavailable

## File Limits

- **Max file size**: 20MB per file
- **Max batch size**: 500MB total
- **Max files per batch**: 10,000 files
- **Supported formats**: JPG, PNG, BMP, TIFF/TIF

## Pagination

Standard pagination parameters for list endpoints:

```http
GET /api/resource?page=1&limit=20&sort=createdAt&order=desc

Response:
{
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5,
    "hasNext": true,
    "hasPrev": false
  }
}
```

## Filtering

Most list endpoints support filtering:

```http
GET /api/images?status=completed&model=HRNet&createdAfter=2024-01-01

Common filters:
- status: pending|processing|completed|failed
- model: HRNet|ResUNet|UNet
- createdAfter: ISO 8601 date
- createdBefore: ISO 8601 date
- search: Text search
```

## Health Check

```http
GET /api/health

Response: 200 OK
{
  "status": "healthy",
  "version": "1.0.0",
  "services": {
    "database": "connected",
    "redis": "connected",
    "mlService": "connected"
  },
  "uptime": 86400
}
```