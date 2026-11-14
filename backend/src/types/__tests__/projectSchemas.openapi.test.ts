import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import {
  PROJECT_TYPES,
  createProjectSchema,
  updateProjectSchema,
} from '../validation';
import {
  MODEL_REGISTRY,
  SEGMENTATION_MODELS,
} from '../../constants/modelRegistry';

/**
 * `/api-docs` serves `api/openapi.yaml`, whose project request bodies are
 * hand-written copies of `createProjectSchema` and `updateProjectSchema`. Both
 * had drifted completely — create listed `description` as required and had no
 * `type`; update had neither `type`, `pixelSizeUm` nor `segmentationModel` and
 * the wrong title limits — so a reader of the docs built requests the server
 * refuses, or never learned a field existed. Pin what a client needs: which
 * fields exist, which are required, and the closed value lists.
 *
 * Parsed as text on purpose: the backend has no direct YAML dependency
 * (`js-yaml` is only an override of a transitive one), and importing it here
 * would be a phantom dependency of the test suite.
 */
const yamlText = fs.readFileSync(
  path.join(__dirname, '../../api/openapi.yaml'),
  'utf8'
);

/** The schema's body: everything indented deeper than its 4-space key. */
const schemaBlock = (name: string): string => {
  const lines = yamlText.split('\n');
  const start = lines.indexOf(`    ${name}:`);
  expect(start, `${name} not found in openapi.yaml`).toBeGreaterThan(-1);
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== '' && !line.startsWith('      ')) break;
    body.push(line);
  }
  return body.join('\n');
};

/** The property names a schema block documents (keys at 8 spaces). */
const propertyNames = (block: string): string[] =>
  block
    .split('\n')
    .map(line => line.match(/^ {8}(\w+):$/)?.[1])
    .filter((name): name is string => name !== undefined);

/** The body of one property: everything after its 8-space key. */
const propertyBlock = (block: string, name: string): string => {
  const body = block.split(`\n        ${name}:\n`)[1];
  expect(body, `properties.${name} not found`).toBeDefined();
  return body;
};

/** One property's own body: up to the next 8-space key, not past it. */
const ownPropertyBlock = (block: string, name: string): string =>
  propertyBlock(block, name).split(/\n {8}\w+:\n/)[0];

/** `- item` lines directly under `key:` at the given indent. */
const listUnder = (block: string, key: string, indent: number): string[] => {
  const lines = block.split('\n');
  const pad = ' '.repeat(indent);
  const at = lines.indexOf(`${pad}${key}:`);
  expect(at, `${key}: not found`).toBeGreaterThan(-1);
  const items: string[] = [];
  for (const line of lines.slice(at + 1)) {
    const m = line.match(new RegExp(`^${pad}  - (\\S+)$`));
    if (!m) break;
    items.push(m[1]);
  }
  return items;
};

describe('openapi.yaml CreateProjectRequest matches createProjectSchema', () => {
  const block = schemaBlock('CreateProjectRequest');

  it('lists `type` as required and `description` as optional', () => {
    const required = listUnder(block, 'required', 6);
    expect(required).toContain('title');
    expect(required).toContain('type');
    expect(required).not.toContain('description');
  });

  it('enumerates exactly the project types the server accepts', () => {
    // `type:` under `properties:` sits at 8 spaces; its `enum:` at 10.
    expect(listUnder(propertyBlock(block, 'type'), 'enum', 10)).toEqual([
      ...PROJECT_TYPES,
    ]);
  });

  it('documents exactly the fields the schema accepts', () => {
    expect(propertyNames(block).sort()).toEqual(
      Object.keys(createProjectSchema.shape).sort()
    );
  });
});

describe('openapi.yaml UpdateProjectRequest matches updateProjectSchema', () => {
  const block = schemaBlock('UpdateProjectRequest');

  it('documents exactly the fields the schema accepts', () => {
    expect(propertyNames(block).sort()).toEqual(
      Object.keys(updateProjectSchema.shape).sort()
    );
  });

  it('requires nothing — every field of an update is optional', () => {
    expect(block).not.toMatch(/^ {6}required:/m);
  });

  it('enumerates exactly the project types the server accepts', () => {
    expect(listUnder(propertyBlock(block, 'type'), 'enum', 10)).toEqual([
      ...PROJECT_TYPES,
    ]);
  });

  it('enumerates exactly the segmentation models the server accepts', () => {
    expect(
      listUnder(propertyBlock(block, 'segmentationModel'), 'enum', 10)
    ).toEqual([...SEGMENTATION_MODELS]);
  });

  it('names exactly the retired models as always refused', () => {
    // A model compatible with NO type passes zod (it is a known id) and is
    // then refused by ProjectService for every project. The enum must still
    // list it, so the description has to say so — and must not name a live
    // model as retired.
    const retired = SEGMENTATION_MODELS.filter(
      m => MODEL_REGISTRY[m].compatibleProjectTypes.length === 0
    );
    expect(retired.length).toBeGreaterThan(0);
    const named = [
      ...ownPropertyBlock(block, 'segmentationModel').matchAll(/`(\w+)`/g),
    ]
      .map(m => m[1])
      .filter(id => (SEGMENTATION_MODELS as readonly string[]).includes(id));
    expect([...new Set(named)].sort()).toEqual([...retired].sort());
  });
});

describe('openapi.yaml Project shows what an update can set', () => {
  // `Project` is the `data` of the PUT's 200 (and of create and detail). A
  // field a client can set but not see in the answer is a field it cannot
  // confirm was stored.
  const block = schemaBlock('Project');

  it('documents every field UpdateProjectRequest accepts', () => {
    const returned = propertyNames(block);
    for (const name of Object.keys(updateProjectSchema.shape)) {
      expect(returned, `Project lacks ${name}`).toContain(name);
    }
  });

  it('enumerates exactly the project types the server stores', () => {
    expect(listUnder(ownPropertyBlock(block, 'type'), 'enum', 10)).toEqual([
      ...PROJECT_TYPES,
    ]);
  });
});
