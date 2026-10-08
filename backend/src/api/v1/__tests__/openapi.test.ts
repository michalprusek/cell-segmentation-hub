/**
 * The published contract against the code it describes. Enums in the
 * document are generated from the code's own constants; what is checked here
 * is everything written by hand, and that the document and the router agree
 * on which paths exist.
 */
import { describe, it, expect } from 'vitest';
import { MODEL_REGISTRY, SEGMENTATION_MODELS } from '../../../constants/modelRegistry';
import { OUTPUT_FORMATS, V1_MODELS, describeModel, outputFormatsFor } from '../models';
import { JOB_PROBLEMS, SEGMENT_PROBLEMS, buildOpenApi } from '../openapi';
import { PROBLEM_TYPES } from '../problem';
import {
  JOB_MAX_ITEMS,
  JOB_MAX_PIXELS,
  JOB_STATUSES,
  MAX_ACTIVE_JOBS_PER_USER,
} from '../jobs/limits';

const doc = buildOpenApi() as any;
const schemas = doc.components.schemas;

describe('models', () => {
  it('describes exactly the models in the registry — all thirteen', () => {
    expect(Object.keys(V1_MODELS).sort()).toEqual([...SEGMENTATION_MODELS].sort());
    expect(Object.keys(V1_MODELS)).toHaveLength(13);
    expect(schemas.ModelId.enum).toEqual(Object.keys(MODEL_REGISTRY));
  });

  it('every model description satisfies the Model schema it is published under', () => {
    const { required, properties } = schemas.Model;
    for (const id of SEGMENTATION_MODELS) {
      const model = describeModel(id) as Record<string, any>;
      for (const key of required) {
        expect(model, `${id}.${key}`).toHaveProperty(key);
      }
      for (const key of Object.keys(model)) {
        expect(Object.keys(properties), `${id}.${key}`).toContain(key);
      }
      expect(schemas.Model.properties.geometry.enum).toContain(model.geometry);
      expect(model.project_types).toEqual(MODEL_REGISTRY[id].compatibleProjectTypes);
      expect(model.classes.length).toBeGreaterThan(0);
      expect(model.name.length).toBeGreaterThan(2);
      expect(model.description.length).toBeGreaterThan(20);
    }
  });

  it('offers yolo only where there are polygons to write', () => {
    for (const id of SEGMENTATION_MODELS) {
      const model = V1_MODELS[id];
      expect(outputFormatsFor(model).includes('yolo')).toBe(model.geometry === 'polygon');
      expect(outputFormatsFor(model)).toEqual(
        OUTPUT_FORMATS.filter(f => f !== 'yolo' || model.geometry === 'polygon')
      );
    }
  });

  it('records which parameters each model reads — the dispatch in routes.py', () => {
    const reads = (key: 'threshold' | 'detectHoles') =>
      SEGMENTATION_MODELS.filter(id => Boolean(V1_MODELS[id][key])).sort();
    expect(reads('threshold')).toEqual([
      'cbam_resunet',
      'hrnet',
      'mamba_unet',
      'microcapsule',
      'segformer',
      'unet_spherohq',
      'wound',
    ]);
    expect(reads('detectHoles')).toEqual([
      'cbam_resunet',
      'hrnet',
      'mamba_unet',
      'neurite_soma_classical',
      'segformer',
      'unet_spherohq',
      'wound',
    ]);
    // Mirrors NATIVE_DEPTH_MODELS in backend/segmentation/api/input_depth.py.
    expect(
      SEGMENTATION_MODELS.filter(id => V1_MODELS[id].inputDepth === 'native').sort()
    ).toEqual(['microtubule', 'neurite_soma', 'neurite_soma_classical']);
  });
});

describe('the document', () => {
  it('is OpenAPI 3.1 with bearer authentication by default', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.security).toEqual([{ apiKey: [] }]);
    expect(doc.components.securitySchemes.apiKey).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
  });

  it('marks only the meta endpoints as public', () => {
    const open = Object.entries(doc.paths)
      .flatMap(([path, item]: [string, any]) =>
        Object.values(item).map((op: any) => [path, op.security])
      )
      .filter(([, security]) => Array.isArray(security) && security.length === 0)
      .map(([path]) => path);
    expect(open.sort()).toEqual(['/openapi.json', '/problems/{code}']);
  });

  it('resolves every $ref', () => {
    const refs = JSON.stringify(doc).match(/"#\/components\/schemas\/[A-Za-z]+"/g) ?? [];
    expect(refs.length).toBeGreaterThan(10);
    for (const ref of new Set(refs)) {
      expect(Object.keys(schemas)).toContain(ref.slice(22, -1));
    }
  });

  it('lists every output format, and documents each in prose', () => {
    expect(schemas.OutputFormat.enum).toEqual([...OUTPUT_FORMATS]);
    for (const format of OUTPUT_FORMATS) {
      expect(schemas.OutputFormat.description).toContain(`\`${format}\``);
    }
  });

  it('lists every problem type the segment endpoint can return, under its real status', () => {
    const responses = doc.paths['/segment'].post.responses;
    for (const code of SEGMENT_PROBLEMS) {
      const status = String(PROBLEM_TYPES[code].status);
      expect(responses[status].description, code).toContain(`\`${code}\``);
      expect(Object.keys(responses[status].content)).toEqual(['application/problem+json']);
    }
    // Every problem type is documented on some endpoint.
    const documented = new Set<string>([...SEGMENT_PROBLEMS, ...JOB_PROBLEMS]);
    expect(Object.keys(PROBLEM_TYPES).filter(c => !documented.has(c))).toEqual(
      []
    );
    expect(schemas.Problem.properties.code.enum).toEqual(Object.keys(PROBLEM_TYPES));
  });

  it('declares the media types the segment endpoint actually produces', () => {
    expect(Object.keys(doc.paths['/segment'].post.responses['200'].content).sort()).toEqual(
      ['application/json', 'application/zip', 'image/png', 'image/tiff']
    );
  });

  it('describes the upload as multipart with model and image required', () => {
    const body = doc.paths['/segment'].post.requestBody.content['multipart/form-data'];
    expect(body.schema.required).toEqual(['image', 'model']);
    expect(Object.keys(body.schema.properties).sort()).toEqual([
      'detect_holes',
      'image',
      'model',
      'output_format',
      'page',
      'threshold',
    ]);
  });

  it('documents every job problem under its real status on some job endpoint', () => {
    const jobOperations = Object.entries(doc.paths)
      .filter(([path]) => path.startsWith('/jobs'))
      .flatMap(([, item]: [string, any]) => Object.values(item) as any[]);
    expect(jobOperations).toHaveLength(6);
    for (const code of JOB_PROBLEMS) {
      const status = String(PROBLEM_TYPES[code].status);
      const found = jobOperations.some(op =>
        op.responses[status]?.description?.includes(`\`${code}\``)
      );
      expect(found, code).toBe(true);
    }
  });

  it('publishes the job states and limits the code uses', () => {
    expect(schemas.Job.properties.status.enum).toEqual([...JOB_STATUSES]);
    for (const state of JOB_STATUSES) {
      expect(schemas.Job.properties.status.description).toContain(
        `\`${state}\``
      );
    }
    const create = doc.paths['/jobs'].post;
    const form = create.requestBody.content['multipart/form-data'].schema;
    expect(form.properties.images.maxItems).toBe(JOB_MAX_ITEMS);
    expect(create.description).toContain(`${JOB_MAX_PIXELS} pixels`);
    expect(create.description).toContain(
      `${MAX_ACTIVE_JOBS_PER_USER} active jobs`
    );
    // output_format belongs to fetching a result, not to creating a job.
    expect(Object.keys(form.properties)).not.toContain('output_format');
  });

  it('gives every problem type a description', () => {
    for (const [code, type] of Object.entries(PROBLEM_TYPES)) {
      expect(type.description.length, code).toBeGreaterThan(20);
    }
  });
});
