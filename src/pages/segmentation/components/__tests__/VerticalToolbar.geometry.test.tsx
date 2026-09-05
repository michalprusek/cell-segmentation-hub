/**
 * The toolbar offers exactly ONE create tool, chosen by project type.
 *
 * Hiding rather than disabling was the deliberate choice: a disabled button
 * still asks the user to wonder why, and would need a new explanatory string in
 * six locales to answer.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import VerticalToolbar from '../VerticalToolbar';
import { EditMode } from '../../types';

vi.mock('@/contexts/useLanguage', () => ({
  useLanguage: () => ({
    // Return the key itself, so assertions name the thing being looked for
    // rather than a translated string that could change under them.
    t: (k: string) => k,
  }),
}));

function renderToolbar(projectType?: string | null) {
  return render(
    <VerticalToolbar
      projectType={projectType}
      editMode={EditMode.View}
      selectedPolygonId={null}
      setEditMode={vi.fn()}
    />
  );
}

/** The two create buttons, found by the mode each sets. */
const polygonBtn = () =>
  screen.queryByRole('button', { name: /createPolygon/i });
const polylineBtn = () =>
  screen.queryByRole('button', { name: /createPolyline/i });

describe('VerticalToolbar — one create tool per project type', () => {
  it.each([
    'spheroid',
    'spheroid_invasive',
    'wound',
    'microcapsule',
    'neurite',
  ])('%s offers polygon only', type => {
    renderToolbar(type);
    expect(polygonBtn()).toBeTruthy();
    expect(polylineBtn()).toBeNull();
  });

  it.each(['sperm', 'microtubules'])('%s offers polyline only', type => {
    renderToolbar(type);
    expect(polylineBtn()).toBeTruthy();
    expect(polygonBtn()).toBeNull();
  });

  it('offers BOTH when the project type is not known yet', () => {
    // Pre-existing behaviour for any caller that has not threaded the type.
    // Failing open matters here: a toolbar with no create tool at all would be
    // a worse regression than one with an extra.
    renderToolbar(undefined);
    expect(polygonBtn()).toBeTruthy();
    expect(polylineBtn()).toBeTruthy();
  });

  it('leaves the shared editing tools alone', () => {
    // The gate is on CREATION only. Editing tools apply to whatever geometry
    // already exists — including the one stray spheroid polyline in production.
    renderToolbar('spheroid');
    expect(
      screen.queryByRole('button', { name: /editVertices/i })
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /addPoints/i })).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: /deletePolygon/i })
    ).toBeTruthy();
  });
});
