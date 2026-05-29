/**
 * Tests for CanvasUIElements component.
 *
 * Covers: conditional rendering of EditorModeFooter and EditorHelpTips
 * per mode combination, slice-start-point text variants, and the no-op
 * case when all modes are off.
 *
 * EditorModeFooter and EditorHelpTips are mocked to avoid their own
 * framer-motion + i18n dependencies; we only test the wiring logic
 * inside CanvasUIElements itself.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '@/test/utils/test-utils';
import CanvasUIElements from '../CanvasUIElements';

// -----------------------------------------------------------------------
// Mocks
// -----------------------------------------------------------------------

vi.mock('../EditorModeFooter', () => ({
  default: ({ mode, text }: { mode: string; text: string }) => (
    <div data-testid={`mode-footer-${mode}`}>{text}</div>
  ),
}));

vi.mock('../../EditorHelpTips', () => ({
  default: ({
    editMode,
    slicingMode,
    pointAddingMode,
  }: {
    editMode: boolean;
    slicingMode: boolean;
    pointAddingMode: boolean;
  }) => (
    <div
      data-testid="editor-help-tips"
      data-edit={String(editMode)}
      data-slice={String(slicingMode)}
      data-add={String(pointAddingMode)}
    />
  ),
}));

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

const OFF = {
  zoom: 1,
  editMode: false,
  slicingMode: false,
  pointAddingMode: false,
  isShiftPressed: false,
  sliceStartPoint: null,
};

describe('CanvasUIElements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // No active mode
  // -----------------------------------------------------------------------

  describe('All modes off', () => {
    it('renders no mode footer when all modes are false', () => {
      const { container } = render(<CanvasUIElements {...OFF} />);
      expect(
        container.querySelector('[data-testid^="mode-footer"]')
      ).toBeNull();
    });

    it('renders no help tips when all modes are false', () => {
      render(<CanvasUIElements {...OFF} />);
      expect(screen.queryByTestId('editor-help-tips')).not.toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // editMode
  // -----------------------------------------------------------------------

  describe('editMode active', () => {
    it('renders edit footer', () => {
      render(<CanvasUIElements {...OFF} editMode={true} />);
      expect(screen.getByTestId('mode-footer-edit')).toBeInTheDocument();
    });

    it('footer text contains Edit Mode', () => {
      render(<CanvasUIElements {...OFF} editMode={true} />);
      expect(screen.getByTestId('mode-footer-edit').textContent).toContain(
        'Edit Mode'
      );
    });

    it('shows shift hint when isShiftPressed is true', () => {
      render(
        <CanvasUIElements {...OFF} editMode={true} isShiftPressed={true} />
      );
      expect(screen.getByTestId('mode-footer-edit').textContent).toContain(
        'Shift'
      );
    });

    it('does not show shift hint when isShiftPressed is false', () => {
      render(
        <CanvasUIElements {...OFF} editMode={true} isShiftPressed={false} />
      );
      expect(screen.getByTestId('mode-footer-edit').textContent).not.toContain(
        'Auto-přidávání'
      );
    });

    it('renders help tips with editMode=true', () => {
      render(<CanvasUIElements {...OFF} editMode={true} />);
      const tips = screen.getByTestId('editor-help-tips');
      expect(tips).toBeInTheDocument();
      expect(tips.getAttribute('data-edit')).toBe('true');
    });

    it('does not render sliceMode footer', () => {
      render(<CanvasUIElements {...OFF} editMode={true} />);
      expect(screen.queryByTestId('mode-footer-slice')).not.toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // slicingMode
  // -----------------------------------------------------------------------

  describe('slicingMode active', () => {
    it('renders slice footer', () => {
      render(<CanvasUIElements {...OFF} slicingMode={true} />);
      expect(screen.getByTestId('mode-footer-slice')).toBeInTheDocument();
    });

    it('footer text says "Klikněte pro začátek" when no sliceStartPoint', () => {
      render(
        <CanvasUIElements {...OFF} slicingMode={true} sliceStartPoint={null} />
      );
      expect(screen.getByTestId('mode-footer-slice').textContent).toContain(
        'Klikněte pro začátek'
      );
    });

    it('footer text says "Klikněte pro dokončení" when sliceStartPoint is set', () => {
      render(
        <CanvasUIElements
          {...OFF}
          slicingMode={true}
          sliceStartPoint={{ x: 10, y: 20 }}
        />
      );
      expect(screen.getByTestId('mode-footer-slice').textContent).toContain(
        'Klikněte pro dokončení'
      );
    });

    it('renders help tips with slicingMode=true', () => {
      render(<CanvasUIElements {...OFF} slicingMode={true} />);
      const tips = screen.getByTestId('editor-help-tips');
      expect(tips.getAttribute('data-slice')).toBe('true');
    });
  });

  // -----------------------------------------------------------------------
  // pointAddingMode
  // -----------------------------------------------------------------------

  describe('pointAddingMode active', () => {
    it('renders add footer', () => {
      render(<CanvasUIElements {...OFF} pointAddingMode={true} />);
      expect(screen.getByTestId('mode-footer-add')).toBeInTheDocument();
    });

    it('footer text contains Point Adding Mode', () => {
      render(<CanvasUIElements {...OFF} pointAddingMode={true} />);
      expect(screen.getByTestId('mode-footer-add').textContent).toContain(
        'Point Adding Mode'
      );
    });

    it('renders help tips with pointAddingMode=true', () => {
      render(<CanvasUIElements {...OFF} pointAddingMode={true} />);
      const tips = screen.getByTestId('editor-help-tips');
      expect(tips.getAttribute('data-add')).toBe('true');
    });
  });

  // -----------------------------------------------------------------------
  // Help tips only shown when at least one mode is active
  // -----------------------------------------------------------------------

  describe('Help tips visibility gate', () => {
    it('shows help tips when any mode is active', () => {
      render(<CanvasUIElements {...OFF} editMode={true} />);
      expect(screen.getByTestId('editor-help-tips')).toBeInTheDocument();
    });

    it('hides help tips when no mode is active', () => {
      render(<CanvasUIElements {...OFF} />);
      expect(screen.queryByTestId('editor-help-tips')).not.toBeInTheDocument();
    });
  });
});
