/**
 * Behavioral tests for src/utils/dashboardDrag.ts
 *
 * Covered behaviors:
 *  - PROJECT_MIME / FOLDER_MIME constants
 *  - dragSourceProps: returns { draggable: true } + onDragStart handler
 *  - onDragStart: sets effectAllowed = 'move'
 *  - onDragStart for project: sets PROJECT_MIME + text/plain with correct payload
 *  - onDragStart for folder: sets FOLDER_MIME + text/plain with correct payload
 *  - dragKindFromTypes: returns 'project' when PROJECT_MIME in types
 *  - dragKindFromTypes: returns 'folder' when FOLDER_MIME in types
 *  - dragKindFromTypes: returns null for unrecognised MIME types
 *  - dragKindFromTypes: project MIME takes precedence when both present (spec: project check first)
 *  - readDragItem: returns { type:'project', id } from dataTransfer
 *  - readDragItem: returns { type:'folder', id } from dataTransfer
 *  - readDragItem: returns null when no spheroseg MIME present
 *  - shouldAcceptOnFolder: returns true when a known kind is being dragged
 *  - shouldAcceptOnFolder: returns false for non-spheroseg drags
 *  - shouldAcceptOnBreadcrumb: mirrors shouldAcceptOnFolder logic
 */

import { describe, it, expect, vi } from 'vitest';
import {
  PROJECT_MIME,
  FOLDER_MIME,
  dragSourceProps,
  dragKindFromTypes,
  readDragItem,
  shouldAcceptOnFolder,
  shouldAcceptOnBreadcrumb,
} from '../dashboardDrag';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simpler builder that returns a plain object matching the call surface. */
function buildDT(data: Record<string, string> = {}): {
  effectAllowed: string;
  types: string[];
  getData: (mime: string) => string;
  setData: ReturnType<typeof vi.fn>;
} {
  const store = { ...data };
  const types = Object.keys(data);
  return {
    effectAllowed: 'none',
    types,
    getData: (mime: string) => store[mime] ?? '',
    setData: vi.fn((mime: string, value: string) => {
      store[mime] = value;
      if (!types.includes(mime)) types.push(mime);
    }),
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('MIME constants', () => {
  it('PROJECT_MIME has the x-spheroseg-project prefix', () => {
    expect(PROJECT_MIME).toBe('application/x-spheroseg-project');
  });

  it('FOLDER_MIME has the x-spheroseg-folder prefix', () => {
    expect(FOLDER_MIME).toBe('application/x-spheroseg-folder');
  });
});

// ---------------------------------------------------------------------------
// dragSourceProps
// ---------------------------------------------------------------------------

describe('dragSourceProps', () => {
  it('always sets draggable to true', () => {
    const props = dragSourceProps({ type: 'project', id: 'p1' });
    expect(props.draggable).toBe(true);
  });

  it('returns an onDragStart function', () => {
    const props = dragSourceProps({ type: 'folder', id: 'f1' });
    expect(typeof props.onDragStart).toBe('function');
  });

  it('onDragStart sets effectAllowed to move for a project', () => {
    const props = dragSourceProps({ type: 'project', id: 'proj-uuid' });
    const dt = buildDT();
    props.onDragStart({ dataTransfer: dt } as unknown as React.DragEvent);
    expect(dt.effectAllowed).toBe('move');
  });

  it('onDragStart sets PROJECT_MIME with the project id', () => {
    const props = dragSourceProps({ type: 'project', id: 'proj-abc' });
    const dt = buildDT();
    props.onDragStart({ dataTransfer: dt } as unknown as React.DragEvent);
    expect(dt.setData).toHaveBeenCalledWith(PROJECT_MIME, 'proj-abc');
  });

  it('onDragStart sets text/plain as type:id for a project', () => {
    const props = dragSourceProps({ type: 'project', id: 'proj-abc' });
    const dt = buildDT();
    props.onDragStart({ dataTransfer: dt } as unknown as React.DragEvent);
    expect(dt.setData).toHaveBeenCalledWith('text/plain', 'project:proj-abc');
  });

  it('onDragStart sets FOLDER_MIME with the folder id', () => {
    const props = dragSourceProps({ type: 'folder', id: 'folder-xyz' });
    const dt = buildDT();
    props.onDragStart({ dataTransfer: dt } as unknown as React.DragEvent);
    expect(dt.setData).toHaveBeenCalledWith(FOLDER_MIME, 'folder-xyz');
  });

  it('onDragStart sets text/plain as type:id for a folder', () => {
    const props = dragSourceProps({ type: 'folder', id: 'folder-xyz' });
    const dt = buildDT();
    props.onDragStart({ dataTransfer: dt } as unknown as React.DragEvent);
    expect(dt.setData).toHaveBeenCalledWith('text/plain', 'folder:folder-xyz');
  });
});

// ---------------------------------------------------------------------------
// dragKindFromTypes
// ---------------------------------------------------------------------------

describe('dragKindFromTypes', () => {
  it('returns "project" when PROJECT_MIME is in the types list', () => {
    expect(dragKindFromTypes([PROJECT_MIME])).toBe('project');
  });

  it('returns "folder" when FOLDER_MIME is in the types list', () => {
    expect(dragKindFromTypes([FOLDER_MIME])).toBe('folder');
  });

  it('returns null for an empty types array', () => {
    expect(dragKindFromTypes([])).toBeNull();
  });

  it('returns null for unrelated MIME types', () => {
    expect(dragKindFromTypes(['text/plain', 'Files'])).toBeNull();
  });

  it('returns "project" when both MIMEs are present (project checked first)', () => {
    // spec: if (types.includes(PROJECT_MIME)) return 'project' is evaluated first
    expect(dragKindFromTypes([FOLDER_MIME, PROJECT_MIME])).toBe('project');
  });

  it('ignores case-differently-written MIMEs (these would NOT match)', () => {
    // Mime type matching is case-sensitive per spec
    expect(dragKindFromTypes(['APPLICATION/X-SPHEROSEG-PROJECT'])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// readDragItem
// ---------------------------------------------------------------------------

describe('readDragItem', () => {
  it('returns { type:"project", id } when PROJECT_MIME has a value', () => {
    const dt = buildDT({ [PROJECT_MIME]: 'proj-123' });
    const result = readDragItem(dt as unknown as DataTransfer);
    expect(result).toEqual({ type: 'project', id: 'proj-123' });
  });

  it('returns { type:"folder", id } when only FOLDER_MIME has a value', () => {
    const dt = buildDT({ [FOLDER_MIME]: 'folder-456' });
    const result = readDragItem(dt as unknown as DataTransfer);
    expect(result).toEqual({ type: 'folder', id: 'folder-456' });
  });

  it('returns null when neither MIME type has a value', () => {
    const dt = buildDT({ 'text/plain': 'some text' });
    const result = readDragItem(dt as unknown as DataTransfer);
    expect(result).toBeNull();
  });

  it('returns null for an empty dataTransfer', () => {
    const dt = buildDT({});
    const result = readDragItem(dt as unknown as DataTransfer);
    expect(result).toBeNull();
  });

  it('project takes precedence when both MIMEs have values', () => {
    const dt = buildDT({
      [PROJECT_MIME]: 'p-99',
      [FOLDER_MIME]: 'f-88',
    });
    const result = readDragItem(dt as unknown as DataTransfer);
    expect(result).toEqual({ type: 'project', id: 'p-99' });
  });
});

// ---------------------------------------------------------------------------
// shouldAcceptOnFolder
// ---------------------------------------------------------------------------

describe('shouldAcceptOnFolder', () => {
  it('returns true when a project is being dragged', () => {
    const dt = buildDT();
    dt.types.push(PROJECT_MIME);
    expect(
      shouldAcceptOnFolder('target-folder-id', dt as unknown as DataTransfer)
    ).toBe(true);
  });

  it('returns true when a folder is being dragged', () => {
    const dt = buildDT();
    dt.types.push(FOLDER_MIME);
    expect(
      shouldAcceptOnFolder('target-folder-id', dt as unknown as DataTransfer)
    ).toBe(true);
  });

  it('returns false when non-spheroseg content is being dragged', () => {
    const dt = buildDT();
    dt.types.push('text/plain');
    expect(
      shouldAcceptOnFolder('target-folder-id', dt as unknown as DataTransfer)
    ).toBe(false);
  });

  it('returns false when types list is empty', () => {
    const dt = buildDT();
    expect(
      shouldAcceptOnFolder('target-folder-id', dt as unknown as DataTransfer)
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// shouldAcceptOnBreadcrumb
// ---------------------------------------------------------------------------

describe('shouldAcceptOnBreadcrumb', () => {
  it('returns true when a project is being dragged', () => {
    const dt = buildDT();
    dt.types.push(PROJECT_MIME);
    expect(shouldAcceptOnBreadcrumb(dt as unknown as DataTransfer)).toBe(true);
  });

  it('returns true when a folder is being dragged', () => {
    const dt = buildDT();
    dt.types.push(FOLDER_MIME);
    expect(shouldAcceptOnBreadcrumb(dt as unknown as DataTransfer)).toBe(true);
  });

  it('returns false when no spheroseg MIME is present', () => {
    const dt = buildDT();
    expect(shouldAcceptOnBreadcrumb(dt as unknown as DataTransfer)).toBe(false);
  });
});
