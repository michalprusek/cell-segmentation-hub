/**
 * The toolbar offers exactly ONE create tool, chosen by project type.
 *
 * Hiding rather than disabling was the deliberate choice: a disabled button
 * still asks the user to wonder why, and would need a new explanatory string in
 * six locales to answer.
 *
 * Every case asserts the WHOLE rail as a set, not just the presence or absence
 * of the two create buttons. Two reasons, both measured:
 *  - `queryByRole(name) === null` cannot tell "not rendered" from "the query no
 *    longer matches". Renaming one i18n key made five of seven earlier gate
 *    assertions pass while asserting nothing.
 *  - Wrapping siblings in a `&&` is one misplaced `)}` away from swallowing the
 *    next button. A version that pulled Slice inside the polyline conditional —
 *    removing Slice from the rail on all five polygon project types — passed
 *    355 component tests. A set assertion fails on it.
 * Comparing a SORTED set also keeps the tests neutral to button order.
 *
 * This file must keep its own `useLanguage` mock and must NOT be converted to
 * the shared `@/test/utils/test-utils` render: the mock makes `t` return the
 * key, so the labels below are keys. Under the real provider they would be
 * "Create Polyline" and every assertion here would silently stop matching.
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

/** Every button the rail renders, by accessible name, sorted. */
const railLabels = () =>
  screen
    .getAllByRole('button')
    .map(b => b.getAttribute('aria-label'))
    .sort();

/** The buttons that are on the rail regardless of project type. */
const ALWAYS = [
  'segmentation.mode.view',
  'segmentation.mode.editVertices',
  'segmentation.mode.addPoints',
  'segmentation.mode.slice',
  'segmentation.mode.deletePolygon',
  'segmentation.toolbar.zoomIn',
  'segmentation.toolbar.zoomOut',
  'segmentation.toolbar.resetView',
];

const POLYGON = 'segmentation.mode.createPolygon';
const POLYLINE = 'segmentation.mode.createPolyline';

describe('VerticalToolbar — one create tool per project type', () => {
  it.each([
    ['spheroid', POLYGON],
    ['spheroid_invasive', POLYGON],
    ['wound', POLYGON],
    ['microcapsule', POLYGON],
    ['neurite', POLYGON],
    ['sperm', POLYLINE],
    ['microtubules', POLYLINE],
  ])('%s renders the whole rail plus exactly %s', (type, create) => {
    renderToolbar(type);
    expect(railLabels()).toEqual([...ALWAYS, create].sort());
  });

  it.each([undefined, null, 'not_a_real_type'])(
    'renders BOTH create tools when the type is %s',
    type => {
      // `useProjectData` starts undefined and fills in when the fetch resolves,
      // so this is every editor mount rather than an exotic caller. Failing
      // open matters here: a rail with no create tool at all would be a worse
      // regression than one with an extra. An unrecognised string gets the same
      // treatment — it is not evidence about geometry in either direction.
      renderToolbar(type);
      expect(railLabels()).toEqual([...ALWAYS, POLYGON, POLYLINE].sort());
    }
  );

  it('does not treat the singular model id as a project type', () => {
    // The project type is the PLURAL `microtubules`; `microtubule` is the model
    // id. Confusing the two has already shipped a bug in this repo, which is
    // why `isMicrotubuleProject` exists.
    renderToolbar('microtubule');
    expect(railLabels()).toEqual([...ALWAYS, POLYGON, POLYLINE].sort());
  });
});
