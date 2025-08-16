# API Documentation

Complete reference for the Cell Segmentation Hub REST API. The API provides endpoints for user authentication, project management, image handling, and AI-powered segmentation services.

## Base URL

- **Development**: `http://localhost:3001/api`
- **Production**: `https://spherosegapp.utia.cas.cz/api`

## Authentication

All protected endpoints require JWT authentication via the `Authorization` header:

```http
Authorization: Bearer <access_token>
```

### Token Management
- **Access Token**: Short-lived (15 minutes), used for API requests
- **Refresh Token**: Long-lived (7 days), used to obtain new access tokens
- **Automatic Refresh**: Frontend handles token refresh automatically

### Token Storage Best Practices
For secure token storage in client applications:
- **Access tokens** should be kept in memory or sessionStorage (avoid localStorage)
- **Refresh tokens** should be stored in httpOnly, secure, SameSite cookies when possible
- **Never store tokens** in URL parameters, browser history, or unencrypted storage
- **Avoid localStorage** for any tokens due to XSS vulnerability exposure

## API Endpoints Overview

| Endpoint Group | Base Path | Description |
|----------------|-----------|-------------|
| **Authentication** | `/auth` | User registration, login, token management |
| **Projects** | `/projects` | Project CRUD operations |
| **Images** | `/projects/:id/images` | Image upload and management |
| **Segmentation** | `/segmentation` | ML segmentation services |

## Response Format

### Success Response
```json
{
  "success": true,
  "message": "Operation completed successfully",
  "data": {
    // Response data
  },
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

### Error Response
```json
{
  "success": false,
  "error": "Error message",
  "errors": {
    // Detailed validation errors (optional)
  },
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

## HTTP Status Codes

| Code | Description |
|------|-------------|
| `200` | Success |
| `201` | Created |
| `400` | Bad Request (validation error) |
| `401` | Unauthorized (invalid/missing token) |
| `403` | Forbidden (insufficient permissions) |
| `404` | Not Found |
| `409` | Conflict (resource already exists) |
| `422` | Unprocessable Entity (validation failed) |
| `429` | Too Many Requests (rate limited) |
| `500` | Internal Server Error |

## Rate Limiting

API requests are rate-limited to prevent abuse:

- **General API**: 1000 requests per 15 minutes per IP
- **Authentication**: 5 login attempts per 15 minutes per IP
- **File Upload**: 50 requests per hour per user

Rate limit headers are included in responses:
```http
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1640995200
```

## Content Types

- **Request Content-Type**: `application/json` (except file uploads)
- **File Upload Content-Type**: `multipart/form-data`
- **Response Content-Type**: `application/json`

## Error Codes

| Code | Description | HTTP Status |
|------|-------------|-------------|
| `VALIDATION_ERROR` | Request validation failed | 400 |
| `UNAUTHORIZED` | Authentication required | 401 |
| `TOKEN_EXPIRED` | Access token expired | 401 |
| `FORBIDDEN` | Insufficient permissions | 403 |
| `NOT_FOUND` | Resource not found | 404 |
| `CONFLICT` | Resource already exists | 409 |
| `RATE_LIMITED` | Too many requests | 429 |
| `INTERNAL_ERROR` | Server error | 500 |

## Data Types

### Common Types

#### User
```typescript
interface User {
  id: string;
  email: string;
  emailVerified: boolean;
  createdAt: string;
  updatedAt: string;
  profile?: Profile;
}
```

#### Profile
```typescript
interface Profile {
  id: string;
  userId: string;
  username?: string;
  avatarUrl?: string;
  bio?: string;
  preferredModel: string;
  modelThreshold: number;
  preferredLang: string;
  preferredTheme: string;
  emailNotifications: boolean;
  createdAt: string;
  updatedAt: string;
}
```

#### Project
```typescript
interface Project {
  id: string;
  title: string;
  description?: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  images?: Image[];
  _count?: {
    images: number;
  };
}
```

#### Image
```typescript
interface Image {
  id: string;
  name: string;
  originalPath: string;
  thumbnailPath?: string;
  projectId: string;
  segmentationStatus: 'pending' | 'processing' | 'completed' | 'failed';
  fileSize?: number;
  width?: number;
  height?: number;
  mimeType?: string;
  createdAt: string;
  updatedAt: string;
  url?: string;
  thumbnailUrl?: string;
  segmentation?: Segmentation;
}
```

#### Segmentation
```typescript
interface Segmentation {
  id: string;
  imageId: string;
  polygons: Polygon[];
  model: string;
  threshold: number;
  confidence?: number;
  processingTime?: number;
  createdAt: string;
  updatedAt: string;
}
```

#### Polygon
```typescript
interface Polygon {
  id: string;
  points: Point[];
  area?: number;
  confidence?: number;
}

interface Point {
  x: number;
  y: number;
}
```

## Pagination

List endpoints support pagination with the following query parameters:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | 1 | Page number (1-based) |
| `limit` | number | 20 | Items per page (max 100) |
| `sortBy` | string | 'createdAt' | Field to sort by |
| `sortOrder` | string | 'desc' | Sort order ('asc' or 'desc') |

### Pagination Response
```json
{
  "success": true,
  "data": {
    "items": [...],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 150,
      "pages": 8,
      "hasNext": true,
      "hasPrev": false
    }
  }
}
```

## File Upload Specifications

### Supported Image Formats
- **JPEG/JPG**: `.jpg`, `.jpeg`
- **PNG**: `.png`
- **Maximum File Size**: 50MB per file
- **Maximum Batch Size**: 20 files per upload

### Upload Response
```json
{
  "success": true,
  "data": {
    "uploaded": [
      {
        "id": "img_123",
        "name": "cell_image.jpg",
        "url": "/uploads/projects/proj_456/images/img_123.jpg",
        "thumbnailUrl": "/uploads/projects/proj_456/thumbnails/thumb_img_123.jpg",
        "fileSize": 2048576,
        "width": 1024,
        "height": 768
      }
    ],
    "failed": []
  }
}
```

## WebSocket Events (Future)

The API is designed to support real-time updates via WebSocket connections:

```typescript
// Connection
const ws = new WebSocket('ws://localhost:3001/ws');

// Event types
interface SegmentationProgressEvent {
  type: 'segmentation:progress';
  imageId: string;
  progress: number; // 0-100
}

interface SegmentationCompleteEvent {
  type: 'segmentation:complete';
  imageId: string;
  result: SegmentationResult;
}
```

## SDK Usage Examples

### JavaScript/TypeScript
```typescript
import { ApiClient } from './api-client';

const client = new ApiClient('http://localhost:3001/api');

// Authentication
await client.auth.login({ email: 'user@example.com', password: 'password' });

// Create project
const project = await client.projects.create({
  title: 'My Cell Analysis',
  description: 'Analyzing cell samples'
});

// Upload images
const images = await client.projects.uploadImages(project.id, fileList);

// Request segmentation
for (const image of images) {
  await client.segmentation.request(image.id, {
    model: 'hrnet',
    threshold: 0.5
  });
}
```

## Detailed Endpoint Documentation

For detailed documentation of each endpoint, see:

- **[Authentication Endpoints](./authentication.md)** - Login, registration, token management
- **[Project Endpoints](./projects.md)** - Project CRUD operations
- **[Image Endpoints](./images.md)** - Image upload and management
- **[Segmentation Endpoints](./segmentation.md)** - ML segmentation services

## Postman Collection

A Postman collection is available with all endpoints pre-configured:

```bash
# Import collection
curl -o cell-segmentation-api.postman_collection.json \
  https://raw.githubusercontent.com/your-repo/docs/postman-collection.json
```

## OpenAPI/Swagger Specification

The complete API specification is available at:
- **Development**: `http://localhost:3001/api-docs`
- **Swagger UI**: `http://localhost:3001/swagger-ui`

## API Documentation Tools

### Interactive Documentation

The API provides comprehensive interactive documentation through multiple interfaces:

#### Swagger UI
- **Development**: http://localhost:3001/api-docs
- **Features**: Interactive endpoint testing, authentication, real-time examples
- **Try It Out**: Test endpoints directly from the browser interface

#### OpenAPI 3.0 Specification
- **JSON Format**: http://localhost:3001/api-docs/openapi.json
- **Standards Compliant**: Full OpenAPI 3.0 specification
- **Code Generation**: Use with tools like `@openapitools/openapi-generator-cli`

#### Postman Collection
- **Auto-generated**: http://localhost:3001/api-docs/postman.json
- **JWT Authentication**: Pre-configured Bearer token authentication
- **Environment Variables**: `{{baseUrl}}` and `{{accessToken}}`

### Using Swagger UI

1. **Navigate** to the Swagger UI interface
2. **Explore** endpoints organized by categories (Authentication, Projects, Images)
3. **Authorize** using JWT token for protected endpoints:
   - Click "Authorize" button
   - Enter your JWT access token (without "Bearer " prefix)
4. **Test endpoints** using the "Try it out" functionality

### Importing Postman Collection

```bash
# Method 1: Import URL directly in Postman
http://localhost:3001/api-docs/postman.json

# Method 2: Download and import
curl -o cell-segmentation-api.json http://localhost:3001/api-docs/postman.json
```

**Setup in Postman**:
1. Set `baseUrl` variable to `http://localhost:3001/api`
2. Login via `/auth/login` to get JWT token
3. Set `accessToken` variable with the received token
4. All authenticated requests will automatically include authentication

### Generating Client SDKs

Use the OpenAPI specification to generate client libraries:

```bash
# TypeScript/JavaScript Client
npx @openapitools/openapi-generator-cli generate \
  -i http://localhost:3001/api-docs/openapi.json \
  -g typescript-axios \
  -o ./generated-client

# Python Client
npx @openapitools/openapi-generator-cli generate \
  -i http://localhost:3001/api-docs/openapi.json \
  -g python \
  -o ./python-client

# Other languages supported: java, csharp, go, php, ruby, etc.
```

### Endpoint Registry

The API maintains a real-time registry of all endpoints:

- **Endpoint List**: http://localhost:3001/api/endpoints
- **Health Status**: http://localhost:3001/api/health/endpoints
- **Usage Statistics**: Call counts, response times, error rates

### API Monitoring

- **Health Check**: http://localhost:3001/health
- **Metrics**: http://localhost:3001/metrics (Prometheus format)
- **Endpoint Health**: Individual endpoint status monitoring

For detailed documentation about the Swagger/OpenAPI system, see [Swagger/OpenAPI Documentation](./swagger-openapi.md).

## Client Libraries

Official client libraries are available for:
- **JavaScript/TypeScript**: `@cell-segmentation/api-client`
- **Python**: `cell-segmentation-client`

```bash
# Install JavaScript client
npm install @cell-segmentation/api-client

# Install Python client
pip install cell-segmentation-client
```