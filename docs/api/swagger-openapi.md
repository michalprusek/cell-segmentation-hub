# Swagger/OpenAPI Documentation System

This document describes the comprehensive API documentation system implemented in the Cell Segmentation Hub using Swagger UI and OpenAPI 3.0 specification.

## Overview

The API documentation system provides multiple formats and interfaces for exploring and testing the Cell Segmentation Hub REST API:

- **Interactive Swagger UI**: Web interface for exploring and testing API endpoints
- **OpenAPI 3.0 Specification**: Machine-readable API specification in JSON format
- **Postman Collection**: Auto-generated collection for Postman import
- **Endpoint Registry**: Real-time endpoint tracking and health monitoring

## Access Points

### Development Environment
- **Swagger UI**: http://localhost:3001/api-docs
- **OpenAPI JSON**: http://localhost:3001/api-docs/openapi.json
- **Postman Collection**: http://localhost:3001/api-docs/postman.json

### Production Environment
- **Swagger UI**: https://api.yourdomain.com/api-docs
- **OpenAPI JSON**: https://api.yourdomain.com/api-docs/openapi.json
- **Postman Collection**: https://api.yourdomain.com/api-docs/postman.json

## Implementation Architecture

### Core Components

#### 1. Swagger Middleware (`src/middleware/swagger.ts`)

The Swagger middleware handles the setup and configuration of the documentation system:

```typescript
export function setupSwagger(app: Express) {
  // Generate specifications from JSDoc comments
  const specs = swaggerJsdoc(swaggerOptions);

  // Mount Swagger UI with custom configuration
  app.use('/api-docs', swaggerUi.serve);
  app.get('/api-docs', swaggerUi.setup(specs, swaggerUiOptions));

  // Raw OpenAPI JSON endpoint
  app.get('/api-docs/openapi.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(specs);
  });

  // Auto-generated Postman collection
  app.get('/api-docs/postman.json', (req, res) => {
    const postmanCollection = convertToPostman(specs);
    res.send(postmanCollection);
  });
}
```

**Key Features**:
- **JSDoc Integration**: Automatically generates documentation from code comments
- **OpenAPI YAML Support**: Loads additional specifications from YAML files
- **Custom Styling**: Branded UI with custom CSS
- **CORS Support**: Enables "Try it out" functionality across origins

#### 2. OpenAPI Configuration

```typescript
const swaggerOptions: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Cell Segmentation Hub API',
      version: '1.0.0',
      description: 'API pro platformu segmentace buněčných struktur',
      contact: {
        name: 'API Support',
        url: 'https://github.com/michalprusek/cell-segmentation-hub',
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT',
      },
    },
    servers: [
      {
        url: process.env.API_BASE_URL || 'http://localhost:3001/api',
        description: 'Development server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
  },
  apis: [
    path.join(__dirname, '../api/routes/*.ts'),
    path.join(__dirname, '../api/controllers/*.ts'),
    path.join(__dirname, '../api/openapi.yaml'),
  ],
};
```

#### 3. Postman Collection Generator

The system automatically converts OpenAPI specifications to Postman collections:

```typescript
function convertToPostman(openApiSpec: any) {
  const collection = {
    info: {
      name: openApiSpec.info?.title || 'API Collection',
      description: openApiSpec.info?.description || '',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    auth: {
      type: 'bearer',
      bearer: [{
        key: 'token',
        value: '{{accessToken}}',
        type: 'string',
      }],
    },
    variable: [
      {
        key: 'baseUrl',
        value: openApiSpec.servers?.[0]?.url || 'http://localhost:3001/api',
        type: 'string',
      },
      {
        key: 'accessToken',
        value: '',
        type: 'string',
      },
    ],
    item: [],
  };
  
  // Auto-generates folders by API tags
  // Creates requests with proper authentication
  // Handles path parameters and request bodies
}
```

## OpenAPI YAML Specification

### Base Configuration (`src/api/openapi.yaml`)

```yaml
openapi: 3.0.0
info:
  title: Cell Segmentation Hub API
  description: API pro platformu segmentace buněčných struktur
  version: 1.0.0
  contact:
    name: API Support
    url: https://github.com/michalprusek/cell-segmentation-hub
  license:
    name: MIT
    url: https://opensource.org/licenses/MIT

servers:
  - url: http://localhost:3001/api
    description: Development server
  - url: http://localhost:3001/api
    description: Production server

paths:
  /health:
    get:
      tags:
        - Health
      summary: Kontrola zdraví serveru
      description: Vrací stav serveru a databáze
      operationId: getHealth
      responses:
        '200':
          description: Server je v pořádku
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/HealthResponse'
```

### Schema Components

The YAML specification includes comprehensive schema definitions for:

- **HealthResponse**: Server health check response
- **AuthResponse**: Authentication response with JWT tokens
- **RegisterRequest**: User registration payload
- **LoginRequest**: Login credentials payload
- **ErrorResponse**: Standardized error response format
- **User**: User entity schema
- **Profile**: User profile schema
- **Project**: Project entity schema
- **Image**: Image entity with segmentation status

## JSDoc Integration

### Controller Documentation

API endpoints are documented using JSDoc comments in controller files:

```typescript
/**
 * @swagger
 * /auth/register:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Registrace nového uživatele
 *     description: Vytvoří nový uživatelský účet
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RegisterRequest'
 *     responses:
 *       '201':
 *         description: Uživatel úspěšně registrován
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       '400':
 *         description: Nevalidní vstupní data
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
export const register = async (req: Request, res: Response) => {
  // Implementation
};
```

### Schema Documentation

```typescript
/**
 * @swagger
 * components:
 *   schemas:
 *     RegisterRequest:
 *       type: object
 *       required:
 *         - email
 *         - password
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *           example: user@example.com
 *         password:
 *           type: string
 *           minLength: 8
 *           example: SecurePassword123!
 */
```

## Swagger UI Configuration

### Custom Styling and Features

```typescript
const swaggerUiOptions = {
  explorer: true,
  swaggerOptions: {
    docExpansion: 'none',
    filter: true,
    showRequestDuration: true,
    tryItOutEnabled: true,
    requestInterceptor: (req: any) => {
      // Note: CORS headers should be configured on the server side, not in client requests
      // The server's CORS configuration already allows cross-origin requests for Swagger UI
      return req;
    },
  },
  customCss: `
    .swagger-ui .topbar { display: none }
    .swagger-ui .info .title { color: #2c3e50; }
    .swagger-ui .scheme-container { 
      background: #f8f9fa; 
      padding: 10px; 
      border-radius: 5px; 
    }
  `,
  customSiteTitle: 'Cell Segmentation Hub API Docs',
};
```

**Features**:
- **Explorer Mode**: Easy navigation through endpoints
- **Filter Function**: Search through endpoints and schemas
- **Try It Out**: Interactive API testing directly from UI
- **Request Duration**: Shows response times for requests
- **Custom Branding**: Removes default Swagger branding, adds custom styling

## Authentication Integration

### JWT Bearer Token Support

The Swagger UI is configured to handle JWT authentication:

```yaml
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
```

**Usage in Swagger UI**:
1. Click the "Authorize" button in the top-right corner
2. Enter JWT access token (without "Bearer " prefix)
3. All subsequent "Try it out" requests will include the Authorization header

### Postman Authentication

The auto-generated Postman collection includes:

```json
{
  "auth": {
    "type": "bearer",
    "bearer": [
      {
        "key": "token",
        "value": "{{accessToken}}",
        "type": "string"
      }
    ]
  },
  "variable": [
    {
      "key": "accessToken",
      "value": "",
      "type": "string"
    }
  ]
}
```

**Setup in Postman**:
1. Import the collection from `/api-docs/postman.json`
2. Set the `accessToken` variable with your JWT token
3. All authenticated requests will automatically include the token

## API Endpoint Categories

### 1. Health Endpoints (🌐 Public)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Server health check with database status |
| `/api/endpoints` | GET | List all registered API endpoints |
| `/api/health/endpoints` | GET | Health status of individual endpoints |

### 2. Authentication Endpoints (🌐 Public)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/register` | POST | User registration |
| `/api/auth/login` | POST | User authentication |
| `/api/auth/refresh` | POST | JWT token refresh |

### 3. Protected Authentication Endpoints (🔒 Protected)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/logout` | POST | User logout |
| `/api/auth/profile` | PUT | Update user profile |
| `/api/auth/profile` | DELETE | Delete user account |

### 4. Project Management (🔒 Protected)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/projects` | GET | List user projects |
| `/api/projects` | POST | Create new project |
| `/api/projects/:projectId` | GET | Get project details |
| `/api/projects/:projectId` | PUT | Update project |
| `/api/projects/:projectId` | DELETE | Delete project |

### 5. Image Management (🔒 Protected)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/projects/:projectId/images` | POST | Upload images to project |
| `/api/projects/:projectId/images/:imageId` | GET | Get image details |
| `/api/projects/:projectId/images/:imageId` | DELETE | Delete image |
| `/api/projects/:projectId/images/:imageId/segment` | POST | Request image segmentation |

### 6. Documentation Endpoints (🌐 Public)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api-docs` | GET | Swagger UI interface |
| `/api-docs/openapi.json` | GET | OpenAPI JSON specification |
| `/api-docs/postman.json` | GET | Postman collection |

## Usage Examples

### 1. Exploring API with Swagger UI

1. **Navigate** to http://localhost:3001/api-docs
2. **Browse** endpoint categories (Authentication, Projects, Images)
3. **Expand** an endpoint to see details (parameters, responses, examples)
4. **Authorize** using JWT token for protected endpoints
5. **Try it out** directly from the interface

### 2. Importing Postman Collection

```bash
# Method 1: Direct import URL in Postman
http://localhost:3001/api-docs/postman.json

# Method 2: Download and import file
curl -o cell-segmentation-api.json http://localhost:3001/api-docs/postman.json
```

**Postman Setup**:
1. Import collection from URL or file
2. Set `baseUrl` variable: `http://localhost:3001/api`
3. Login via `/auth/login` request
4. Copy access token to `accessToken` variable
5. Test protected endpoints

### 3. Generating Client SDKs

The OpenAPI specification can be used with code generation tools:

```bash
# JavaScript/TypeScript SDK
npx @openapitools/openapi-generator-cli generate \
  -i http://localhost:3001/api-docs/openapi.json \
  -g typescript-axios \
  -o ./generated-client

# Python SDK  
npx @openapitools/openapi-generator-cli generate \
  -i http://localhost:3001/api-docs/openapi.json \
  -g python \
  -o ./python-client
```

## Development Workflow

### 1. Adding New Endpoints

When adding new API endpoints:

1. **Add JSDoc documentation** in the controller:
```typescript
/**
 * @swagger
 * /api/new-endpoint:
 *   post:
 *     tags:
 *       - New Feature
 *     summary: Brief description
 *     description: Detailed description
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/NewRequestSchema'
 */
```

2. **Register the endpoint** in `src/api/routes/index.ts`:
```typescript
registerRoute({
  path: '/api/new-endpoint',
  method: 'POST',
  description: 'Brief description',
  authenticated: true
});
```

3. **Test in Swagger UI** at http://localhost:3001/api-docs

### 2. Updating Documentation

The documentation is automatically updated when:
- JSDoc comments are modified in controllers
- OpenAPI YAML files are updated
- New routes are registered in the endpoint registry

**No build step required** - changes are reflected immediately on server restart.

## Monitoring and Analytics

### Endpoint Usage Tracking

The system automatically tracks:
- **Call count** per endpoint
- **Average response time**
- **Error rate**
- **Last called timestamp**

Access via: http://localhost:3001/api/health/endpoints

### Health Monitoring

Each endpoint's health is monitored:
- **Response time** monitoring
- **Success/failure rates**
- **Availability status**

## Security Considerations

### 1. Documentation Access

- **Swagger UI**: Publicly accessible (no sensitive data exposed)
- **OpenAPI JSON**: Publicly accessible (API structure only)
- **Try it out**: Requires valid JWT for protected endpoints

### 2. Authentication in Documentation

- **JWT tokens** are never logged or stored by Swagger UI
- **Test requests** use the same security as production API
- **CORS configuration** allows cross-origin requests for testing

### 3. Production Deployment

For production environments:
- Consider **restricting Swagger UI access** to internal networks
- Use **HTTPS** for all documentation endpoints
- **Monitor access logs** for the documentation endpoints

## Troubleshooting

### Common Issues

#### 1. Swagger UI Not Loading
```bash
# Check if the server is running
curl http://localhost:3001/health

# Check Swagger endpoint
curl http://localhost:3001/api-docs/openapi.json
```

#### 2. Try It Out Not Working
- Verify **CORS configuration** in server settings
- Check **JWT token format** (should not include "Bearer " prefix in Swagger UI)
- Ensure **server is accessible** from browser

#### 3. Postman Collection Import Issues
```bash
# Verify collection format
curl -s http://localhost:3001/api-docs/postman.json | jq '.info'

# Check collection schema version
curl -s http://localhost:3001/api-docs/postman.json | jq '.info.schema'
```

### Debug Mode

Enable detailed logging for documentation system:

```typescript
// In development
process.env.SWAGGER_DEBUG = 'true';
```

This provides detailed logs about:
- JSDoc parsing
- OpenAPI schema generation
- Endpoint registration
- Postman collection conversion

## Future Enhancements

### Planned Features

1. **API Versioning**: Support for multiple API versions in documentation
2. **WebSocket Documentation**: Documentation for real-time endpoints
3. **Code Examples**: Auto-generated code examples in multiple languages
4. **Interactive Schemas**: Enhanced schema exploration with examples
5. **API Analytics Dashboard**: Visual analytics for endpoint usage

### Integration Possibilities

- **CI/CD Integration**: Automatic documentation updates on deployment
- **API Testing**: Integration with automated testing frameworks
- **Documentation Validation**: Ensure documentation stays in sync with code
- **Performance Monitoring**: Integration with APM tools for real-time metrics

This comprehensive Swagger/OpenAPI documentation system provides a robust foundation for API exploration, testing, and integration, making the Cell Segmentation Hub API accessible to developers and easy to integrate with client applications.