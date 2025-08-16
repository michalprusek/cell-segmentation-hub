import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { Express } from 'express';
import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger';

// Build list of YAML candidate paths and pick the first that exists
const yamlCandidates = [
  path.join(__dirname, '../api/openapi.yaml'),
  path.join(__dirname, '../api/openapi.yml'),
  path.join(__dirname, '../../api/openapi.yaml'),
  path.join(__dirname, '../../api/openapi.yml'),
];

const resolvedYamlPath = yamlCandidates.find(candidate => fs.existsSync(candidate));

// Construct apiGlobs that include both .ts and .js variants
const apiGlobs = [
  path.join(__dirname, '../api/routes/*.ts'),
  path.join(__dirname, '../api/routes/*.js'),
  path.join(__dirname, '../api/controllers/*.ts'),
  path.join(__dirname, '../api/controllers/*.js'),
];

// Include the resolved YAML path only if it exists
if (resolvedYamlPath) {
  apiGlobs.push(resolvedYamlPath);
}

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
  } as swaggerJsdoc.SwaggerDefinition,
  apis: apiGlobs,
};

export function setupSwagger(app: Express) {
  try {
    // OpenAPI YAML specification path (for future use)
    // const openApiYamlPath = path.join(__dirname, '../api/openapi.yaml');
    
    // Generování specifikací z JSDoc komentářů
    const specs = swaggerJsdoc(swaggerOptions);

    // Swagger UI konfigurace
    const swaggerUiOptions = {
      explorer: true,
      swaggerOptions: {
        docExpansion: 'none',
        filter: true,
        showRequestDuration: true,
        tryItOutEnabled: true,
        requestInterceptor: (req: any) => {
          // Note: CORS headers should be configured on server responses, not requests
          return req;
        },
      },
      customCss: `
        .swagger-ui .topbar { display: none }
        .swagger-ui .info .title { color: #2c3e50; }
        .swagger-ui .scheme-container { background: #f8f9fa; padding: 10px; border-radius: 5px; }
      `,
      customSiteTitle: 'Cell Segmentation Hub API Docs',
    };

    // Mount Swagger UI
    app.use('/api-docs', swaggerUi.serve);
    app.get('/api-docs', swaggerUi.setup(specs, swaggerUiOptions));

    // Endpoint pro raw OpenAPI JSON
    app.get('/api-docs/openapi.json', (req, res) => {
      try {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'public, max-age=300'); // Cache for 5 minutes
        res.send(specs);
      } catch (error) {
        logger.error('Failed to serve OpenAPI JSON:', error instanceof Error ? error : undefined);
        res.status(500).json({ error: 'Failed to generate OpenAPI specification' });
      }
    });

    // Endpoint pro Postman import
    app.get('/api-docs/postman.json', (req, res) => {
      try {
        const postmanCollection = convertToPostman(specs);
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'public, max-age=300'); // Cache for 5 minutes
        res.send(postmanCollection);
      } catch (error) {
        logger.error('Failed to generate Postman collection:', error instanceof Error ? error : undefined);
        res.status(500).json({ error: 'Failed to generate Postman collection' });
      }
    });

    logger.info('✅ Swagger UI configured at /api-docs');
    logger.info('📄 OpenAPI JSON available at /api-docs/openapi.json');
    logger.info('📮 Postman collection available at /api-docs/postman.json');

  } catch (error) {
    logger.error('❌ Failed to setup Swagger UI:', error as Error);
  }
}

/**
 * Převede OpenAPI spec na Postman kolekci
 */
function convertToPostman(openApiSpec: any) {
  const collection = {
    info: {
      name: openApiSpec.info?.title || 'API Collection',
      description: openApiSpec.info?.description || '',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    auth: {
      type: 'bearer',
      bearer: [
        {
          key: 'token',
          value: '{{accessToken}}',
          type: 'string',
        },
      ],
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

  // Vytvoří folders podle tags
  const folders: { [key: string]: any } = {};
  
  if (openApiSpec.paths) {
    Object.entries(openApiSpec.paths).forEach(([path, pathItem]: [string, any]) => {
      Object.entries(pathItem).forEach(([method, operation]: [string, any]) => {
        if (method === 'parameters') return;

        const tag = operation.tags?.[0] || 'Default';
        
        if (!folders[tag]) {
          folders[tag] = {
            name: tag,
            item: [],
          };
        }

        const postmanRequest = {
          name: operation.summary || `${method.toUpperCase()} ${path}`,
          request: {
            method: method.toUpperCase(),
            header: [
              {
                key: 'Content-Type',
                value: 'application/json',
                type: 'text',
              },
            ],
            url: `{{baseUrl}}${path}`,
            description: operation.description || '',
          },
        };

        // Compute effective security by merging/inheriting from operation, pathItem, and root document
        const effectiveSecurity = operation.security || pathItem.security || openApiSpec.security;
        if (effectiveSecurity && effectiveSecurity.length > 0) {
          // Check if any security requirement includes bearerAuth or similar JWT auth
          const requiresAuth = effectiveSecurity.some((secReq: any) => 
            Object.keys(secReq).some(key => 
              key === 'bearerAuth' || key.toLowerCase().includes('bearer') || key.toLowerCase().includes('jwt')
            )
          );
          
          if (requiresAuth) {
            (postmanRequest.request as any).auth = {
              type: 'bearer',
              bearer: [
                {
                  key: 'token',
                  value: '{{accessToken}}',
                  type: 'string',
                },
              ],
            };
          }
        }

        folders[tag].item.push(postmanRequest);
      });
    });
  }

  (collection as any).item = Object.values(folders);
  return collection;
}

export { swaggerOptions };