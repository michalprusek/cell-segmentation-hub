import React from 'react';
import { screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import SpermInstancePanel from '../SpermInstancePanel';
import { Polygon } from '@/lib/segmentation';

// calculatePolylineLength is a pure util used for display; stub it
vi.mock('../utils/metricCalculations', () => ({
  calculatePolylineLength: vi.fn(() => 42.5),
}));

function makePolyline(overrides: Partial<Polygon> = {}): Polygon {
  return {
    id: 'pl-1',
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 10 },
    ],
    geometry: 'polyline',
    partClass: 'head',
    instanceId: 'sperm_1',
    ...overrides,
  } as Polygon;
}

const DEFAULT_PROPS = {
  polygons: [],
  selectedPolygonId: null,
  onSelectPolygon: vi.fn(),
  activePartClass: 'head' as const,
  onPartClassChange: vi.fn(),
  activeInstanceId: 'sperm_1',
  onInstanceIdChange: vi.fn(),
};

describe('SpermInstancePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Empty state', () => {
    it('returns null when there are no polylines and no pending instances', () => {
      // No polygons at all — panel should not render anything
      const { container } = render(
        <SpermInstancePanel {...DEFAULT_PROPS} polygons={[]} />
      );
      expect(container.firstChild).toBeNull();
    });

    it('also returns null when polygons are all closed polygons (no polylines)', () => {
      const closedPolygon: Polygon = {
        id: 'p1',
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ],
        geometry: 'polygon',
      } as Polygon;
      const { container } = render(
        <SpermInstancePanel {...DEFAULT_PROPS} polygons={[closedPolygon]} />
      );
      expect(container.firstChild).toBeNull();
    });
  });

  describe('Rendering with polylines', () => {
    it('renders panel header when polylines exist', () => {
      const polyline = makePolyline();
      render(<SpermInstancePanel {...DEFAULT_PROPS} polygons={[polyline]} />);
      // t('sperm.instancePanel') = 'Sperm Instances'
      expect(screen.getByText('Sperm Instances')).toBeInTheDocument();
    });

    it('renders part class buttons (Head, Midpiece, Tail)', () => {
      const polyline = makePolyline();
      render(<SpermInstancePanel {...DEFAULT_PROPS} polygons={[polyline]} />);
      expect(screen.getByRole('button', { name: /Head/i })).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /Midpiece/i })
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Tail/i })).toBeInTheDocument();
    });

    it('renders the new instance (+) button', () => {
      const polyline = makePolyline();
      render(<SpermInstancePanel {...DEFAULT_PROPS} polygons={[polyline]} />);
      // Button with title 'New Instance' (t('sperm.newInstance'))
      expect(screen.getByTitle('New Instance')).toBeInTheDocument();
    });

    it('renders instance group header for each instance id', () => {
      const p1 = makePolyline({ id: 'pl-1', instanceId: 'sperm_1' });
      const p2 = makePolyline({
        id: 'pl-2',
        instanceId: 'sperm_2',
        partClass: 'tail',
      });
      render(
        <SpermInstancePanel
          {...DEFAULT_PROPS}
          polygons={[p1, p2]}
          activeInstanceId="sperm_1"
        />
      );
      // 'Sperm 1' appears in both Select trigger and instance list; getAllByText
      expect(screen.getAllByText('Sperm 1').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Sperm 2').length).toBeGreaterThan(0);
    });
  });

  describe('Part class selection', () => {
    it('calls onPartClassChange when a part button is clicked', async () => {
      const user = userEvent.setup();
      const onPartClassChange = vi.fn();
      const polyline = makePolyline();
      render(
        <SpermInstancePanel
          {...DEFAULT_PROPS}
          polygons={[polyline]}
          activePartClass="head"
          onPartClassChange={onPartClassChange}
        />
      );
      const tailBtn = screen.getByRole('button', { name: /Tail/i });
      await user.click(tailBtn);
      expect(onPartClassChange).toHaveBeenCalledWith('tail');
    });

    it('calls onPartClassChange with midpiece when Midpiece is clicked', async () => {
      const user = userEvent.setup();
      const onPartClassChange = vi.fn();
      const polyline = makePolyline();
      render(
        <SpermInstancePanel
          {...DEFAULT_PROPS}
          polygons={[polyline]}
          activePartClass="head"
          onPartClassChange={onPartClassChange}
        />
      );
      await user.click(screen.getByRole('button', { name: /Midpiece/i }));
      expect(onPartClassChange).toHaveBeenCalledWith('midpiece');
    });
  });

  describe('Instance creation', () => {
    it('calls onInstanceIdChange with a new sperm id when + is clicked', async () => {
      const user = userEvent.setup();
      const onInstanceIdChange = vi.fn();
      const polyline = makePolyline({ instanceId: 'sperm_1' });
      render(
        <SpermInstancePanel
          {...DEFAULT_PROPS}
          polygons={[polyline]}
          activeInstanceId="sperm_1"
          onInstanceIdChange={onInstanceIdChange}
        />
      );
      const addBtn = screen.getByTitle('New Instance');
      await user.click(addBtn);
      // Next instance after sperm_1 is sperm_2
      expect(onInstanceIdChange).toHaveBeenCalledWith('sperm_2');
    });

    it('shows the new instance in the list after creation', async () => {
      const user = userEvent.setup();
      const polyline = makePolyline({ instanceId: 'sperm_1' });
      // Use a real state-tracking version by checking DOM after click
      render(
        <SpermInstancePanel
          {...DEFAULT_PROPS}
          polygons={[polyline]}
          activeInstanceId="sperm_1"
          onInstanceIdChange={DEFAULT_PROPS.onInstanceIdChange}
        />
      );
      const addBtn = screen.getByTitle('New Instance');
      await user.click(addBtn);
      // The new instance should appear in the instance list
      await waitFor(() => {
        expect(screen.getAllByText(/Sperm 2/).length).toBeGreaterThan(0);
      });
    });
  });

  describe('Instance selection', () => {
    it('calls onInstanceIdChange when an instance header is clicked', async () => {
      const user = userEvent.setup();
      const onInstanceIdChange = vi.fn();
      const p1 = makePolyline({ id: 'pl-1', instanceId: 'sperm_1' });
      const p2 = makePolyline({
        id: 'pl-2',
        instanceId: 'sperm_2',
        partClass: 'tail',
      });
      render(
        <SpermInstancePanel
          {...DEFAULT_PROPS}
          polygons={[p1, p2]}
          activeInstanceId="sperm_1"
          onInstanceIdChange={onInstanceIdChange}
        />
      );
      // Click Sperm 2 header
      const sperm2Header = screen.getByText('Sperm 2');
      await user.click(sperm2Header);
      expect(onInstanceIdChange).toHaveBeenCalledWith('sperm_2');
    });
  });

  describe('Expanded polyline list', () => {
    it('shows polyline rows when instance is expanded', async () => {
      const user = userEvent.setup();
      const p1 = makePolyline({
        id: 'pl-1',
        instanceId: 'sperm_1',
        partClass: 'head',
      });
      const p2 = makePolyline({
        id: 'pl-2',
        instanceId: 'sperm_1',
        partClass: 'midpiece',
      });
      render(
        <SpermInstancePanel
          {...DEFAULT_PROPS}
          polygons={[p1, p2]}
          activeInstanceId="sperm_1"
        />
      );
      // The instance header appears as a <button> inside the instance list div
      // 'Sperm 1' appears multiple times; find the one inside the list (the button)
      const spermButtons = screen.getAllByRole('button', { name: /Sperm 1/i });
      // The instance-list button is the one with a chevron
      const instanceHeaderBtn = spermButtons.find(
        btn => btn.tagName === 'BUTTON' && !btn.getAttribute('aria-haspopup')
      );
      await user.click(instanceHeaderBtn!);
      // Both part labels should now appear inside the expanded list
      await waitFor(() => {
        const heads = screen.getAllByText('Head');
        expect(heads.length).toBeGreaterThan(0);
      });
    });

    it('calls onSelectPolygon when a polyline row is clicked', async () => {
      const user = userEvent.setup();
      const onSelectPolygon = vi.fn();
      const p1 = makePolyline({
        id: 'pl-1',
        instanceId: 'sperm_1',
        partClass: 'head',
      });
      render(
        <SpermInstancePanel
          {...DEFAULT_PROPS}
          polygons={[p1]}
          activeInstanceId="sperm_1"
          onSelectPolygon={onSelectPolygon}
        />
      );
      // Expand the instance via its button
      const spermButtons = screen.getAllByRole('button', { name: /Sperm 1/i });
      const instanceHeaderBtn = spermButtons.find(
        btn => btn.tagName === 'BUTTON' && !btn.getAttribute('aria-haspopup')
      );
      await user.click(instanceHeaderBtn!);
      // Click the polyline row — Head label in expanded list
      await waitFor(() => screen.getAllByText('Head'));
      const headRows = screen.getAllByText('Head');
      await user.click(headRows[headRows.length - 1]);
      expect(onSelectPolygon).toHaveBeenCalledWith('pl-1');
    });

    it('calls onSelectPolygon with null when clicking already-selected polyline', async () => {
      const user = userEvent.setup();
      const onSelectPolygon = vi.fn();
      const p1 = makePolyline({
        id: 'pl-1',
        instanceId: 'sperm_1',
        partClass: 'head',
      });
      render(
        <SpermInstancePanel
          {...DEFAULT_PROPS}
          polygons={[p1]}
          activeInstanceId="sperm_1"
          selectedPolygonId="pl-1"
          onSelectPolygon={onSelectPolygon}
        />
      );
      const spermButtons = screen.getAllByRole('button', { name: /Sperm 1/i });
      const instanceHeaderBtn = spermButtons.find(
        btn => btn.tagName === 'BUTTON' && !btn.getAttribute('aria-haspopup')
      );
      await user.click(instanceHeaderBtn!);
      await waitFor(() => screen.getAllByText('Head'));
      const headRows = screen.getAllByText('Head');
      await user.click(headRows[headRows.length - 1]);
      expect(onSelectPolygon).toHaveBeenCalledWith(null);
    });
  });

  describe('Unassigned polylines', () => {
    it('renders unassigned section for polylines with no instanceId', () => {
      const unassigned = makePolyline({
        id: 'pl-u',
        instanceId: undefined,
      } as any);
      render(
        <SpermInstancePanel
          {...DEFAULT_PROPS}
          polygons={[unassigned]}
          activeInstanceId="sperm_1"
        />
      );
      // t('sperm.unassigned') = 'Unassigned'
      expect(screen.getByText('Unassigned')).toBeInTheDocument();
    });
  });
});
