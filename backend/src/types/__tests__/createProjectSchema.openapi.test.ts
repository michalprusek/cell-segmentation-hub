import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { PROJECT_TYPES } from '../validation';

/**
 * `/api-docs` serves `api/openapi.yaml`, a hand-written copy of
 * `createProjectSchema`. It had drifted completely — `description` listed as
 * required, `type` absent — so a reader of the docs would have built exactly
 * the request the server now refuses. Pin the two facts a client needs.
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
    const typeProp = block.split('\n        type:\n')[1];
    expect(typeProp, 'properties.type not found').toBeDefined();
    expect(listUnder(typeProp, 'enum', 10)).toEqual([...PROJECT_TYPES]);
  });
});
