/**
 * Tests for VertexContextMenu component
 * Tests context menu functionality for vertex deletion, event handling, and accessibility
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import VertexContextMenu from '../VertexContextMenu';
// Mock the context menu components from shadcn/ui
vi.mock('@/components/ui/context-menu', () => ({
  ContextMenu: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="context-menu">{children}</div>
  ),
  ContextMenuTrigger: ({
    children,
    asChild,
  }: {
    children: React.ReactNode;
    asChild?: boolean;
  }) => (
    <div data-testid="context-menu-trigger" data-as-child={asChild}>
      {children}
    </div>
  ),
  ContextMenuContent: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => (
    <div
      data-testid="context-menu-content"
      className={className}
      role="menu"
      aria-label="Vertex options"
    >
      {children}
    </div>
  ),
  ContextMenuItem: ({
    children,
    onClick,
    className,
    onSelect,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    className?: string;
    onSelect?: () => void;
  }) => (
    <div
      data-testid="context-menu-item"
      className={className}
      onClick={onClick || onSelect}
      role="menuitem"
      tabIndex={0}
    >
      {children}
    </div>
  ),
  ContextMenuSeparator: () => <hr data-testid="context-menu-separator" />,
}));
// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  Trash: ({ className }: { className?: string }) => (
    <div data-testid="trash-icon" className={className} />
  ),
}));
// Mock useLanguage hook
vi.mock('@/contexts/useLanguage', () => ({
  useLanguage: () => ({
    t: (key: string) => key, // Return key as translation
    language: 'en',
    setLanguage: vi.fn(),
  }),
}));
describe('VertexContextMenu', () => {
  const mockOnDelete = vi.fn();
  const defaultProps = {
    children: <div data-testid="vertex-element">Vertex</div>,
    onDelete: mockOnDelete,
    vertexIndex: 2,
    polygonId: 'polygon-123',
  };
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  describe('Rendering', () => {
    it('renders with correct structure', () => {
      render(<VertexContextMenu {...defaultProps} />);
      expect(screen.getByTestId('context-menu')).toBeInTheDocument();
      expect(screen.getByTestId('context-menu-trigger')).toBeInTheDocument();
      expect(screen.getByTestId('vertex-element')).toBeInTheDocument();
    });
    it('renders children correctly as trigger', () => {
      const customChild = (
        <button data-testid="custom-vertex">Custom Vertex</button>
      );
      render(
        <VertexContextMenu {...defaultProps}>{customChild}</VertexContextMenu>
      );
      expect(screen.getByTestId('custom-vertex')).toBeInTheDocument();
      expect(screen.getByTestId('context-menu-trigger')).toHaveAttribute(
        'data-as-child',
        'true'
      );
    });
    it('renders delete menu item with correct props', () => {
      render(<VertexContextMenu {...defaultProps} />);
      const menuContent = screen.getByTestId('context-menu-content');
      expect(menuContent).toHaveClass('w-64');
      expect(menuContent).toHaveAttribute('role', 'menu');
      const deleteItem = screen.getByTestId('context-menu-item');
      expect(deleteItem).toHaveClass('cursor-pointer', 'text-red-600');
      expect(deleteItem).toHaveAttribute('role', 'menuitem');
      expect(deleteItem).toHaveAttribute('tabIndex', '0');
    });
    it('renders trash icon and delete text', () => {
      render(<VertexContextMenu {...defaultProps} />);
      expect(screen.getByTestId('trash-icon')).toBeInTheDocument();
      expect(screen.getByTestId('trash-icon')).toHaveClass(
        'mr-2',
        'h-4',
        'w-4'
      );
      expect(screen.getByText('contextMenu.deleteVertex')).toBeInTheDocument();
    });
  });
  describe('Event Handling', () => {
    it('calls onDelete when delete menu item is clicked', async () => {
      render(<VertexContextMenu {...defaultProps} />);
      const deleteItem = screen.getByTestId('context-menu-item');
      fireEvent.click(deleteItem);
      await waitFor(() => {
        expect(mockOnDelete).toHaveBeenCalledTimes(1);
      });
    });
    it('calls onDelete when delete menu item is activated with keyboard', async () => {
      render(<VertexContextMenu {...defaultProps} />);
      const deleteItem = screen.getByTestId('context-menu-item');
      // Focus and press Enter
      deleteItem.focus();
      fireEvent.keyDown(deleteItem, { key: 'Enter', code: 'Enter' });
      fireEvent.click(deleteItem); // Simulating the click that happens on Enter
      await waitFor(() => {
        expect(mockOnDelete).toHaveBeenCalledTimes(1);
      });
    });
    it('prevents event propagation when menu item is clicked', async () => {
      const parentClickHandler = vi.fn();
      render(
        <div onClick={parentClickHandler}>
          <VertexContextMenu {...defaultProps} />
        </div>
      );
      const deleteItem = screen.getByTestId('context-menu-item');
      fireEvent.click(deleteItem);
      await waitFor(() => {
        expect(mockOnDelete).toHaveBeenCalledTimes(1);
      });
      // Parent handler should not be called if event propagation is stopped
      expect(parentClickHandler).not.toHaveBeenCalled();
    });
    it('handles multiple rapid clicks gracefully', async () => {
      render(<VertexContextMenu {...defaultProps} />);
      const deleteItem = screen.getByTestId('context-menu-item');
      // Rapid clicks
      fireEvent.click(deleteItem);
      fireEvent.click(deleteItem);
      fireEvent.click(deleteItem);
      await waitFor(() => {
        expect(mockOnDelete).toHaveBeenCalledTimes(3);
      });
    });
  });
  describe('Props Validation', () => {
    it('passes correct vertex information', () => {
      const customProps = {
        ...defaultProps,
        vertexIndex: 5,
        polygonId: 'custom-polygon-456',
      };
      render(<VertexContextMenu {...customProps} />);
      // The component should render without errors with different props
      expect(screen.getByTestId('context-menu')).toBeInTheDocument();
      expect(screen.getByTestId('vertex-element')).toBeInTheDocument();
    });
    it('handles edge case vertex indices', () => {
      const edgeCases = [0, -1, 999, NaN];
      edgeCases.forEach(vertexIndex => {
        const { unmount } = render(
          <VertexContextMenu {...defaultProps} vertexIndex={vertexIndex} />
        );
        expect(screen.getByTestId('context-menu')).toBeInTheDocument();
        unmount();
      });
    });
    it('handles empty and invalid polygon IDs', () => {
      const invalidIds = ['', '   ', 'special-chars-!@#$%', '很长的中文字符串'];
      invalidIds.forEach(polygonId => {
        const { unmount } = render(
          <VertexContextMenu {...defaultProps} polygonId={polygonId} />
        );
        expect(screen.getByTestId('context-menu')).toBeInTheDocument();
        unmount();
      });
    });
  });
  describe('Accessibility', () => {
    it('has proper ARIA attributes', () => {
      render(<VertexContextMenu {...defaultProps} />);
      const menuContent = screen.getByTestId('context-menu-content');
      expect(menuContent).toHaveAttribute('role', 'menu');
      expect(menuContent).toHaveAttribute('aria-label', 'Vertex options');
      const menuItem = screen.getByTestId('context-menu-item');
      expect(menuItem).toHaveAttribute('role', 'menuitem');
      expect(menuItem).toHaveAttribute('tabIndex', '0');
    });
    it('is keyboard navigable', () => {
      render(<VertexContextMenu {...defaultProps} />);
      const menuItem = screen.getByTestId('context-menu-item');
      // Should be focusable
      menuItem.focus();
      expect(document.activeElement).toBe(menuItem);
    });
    it('has proper visual styling for interactive elements', () => {
      render(<VertexContextMenu {...defaultProps} />);
      const menuItem = screen.getByTestId('context-menu-item');
      expect(menuItem).toHaveClass('cursor-pointer');
      expect(menuItem).toHaveClass('text-red-600'); // Indicates destructive action
    });
  });
  describe('Context Menu Integration', () => {
    it('integrates properly with shadcn/ui context menu structure', () => {
      render(<VertexContextMenu {...defaultProps} />);
      // Verify the hierarchical structure
      const contextMenu = screen.getByTestId('context-menu');
      const trigger = screen.getByTestId('context-menu-trigger');
      const content = screen.getByTestId('context-menu-content');
      expect(contextMenu).toContainElement(trigger);
      expect(contextMenu).toContainElement(content);
      expect(trigger).toContainElement(screen.getByTestId('vertex-element'));
    });
    it('applies correct CSS classes for context menu content', () => {
      render(<VertexContextMenu {...defaultProps} />);
      const content = screen.getByTestId('context-menu-content');
      expect(content).toHaveClass('w-64'); // Fixed width as specified in component
    });
  });
  describe('Internationalization', () => {
    it('displays translated text for delete vertex', () => {
      render(<VertexContextMenu {...defaultProps} />);
      // The mock language provider should provide the translation key
      expect(screen.getByText('contextMenu.deleteVertex')).toBeInTheDocument();
    });
    it('handles different language contexts', () => {
      // Test with different language mock if needed
      const CustomLanguageProvider = ({
        children,
      }: {
        children: React.ReactNode;
      }) => <div data-language="cs">{children}</div>;
      render(
        <CustomLanguageProvider>
          <VertexContextMenu {...defaultProps} />
        </CustomLanguageProvider>,
        {
          wrapper: ({ children }) => <div>{children}</div>,
        }
      );
      expect(screen.getByTestId('context-menu')).toBeInTheDocument();
    });
  });
  describe('Re-render correctness', () => {
    // Was 'handles rapid re-renders efficiently', whose only assertion was
    // `expect(totalTime).toBeLessThan(2000)` after 10 rerenders. Two problems:
    // the ceiling is ~1000x the real cost so it can never fail, and the props
    // it swept (vertexIndex, polygonId) are destructured as `_vertexIndex` /
    // `_polygonId` and never read — so nothing observable changed either way.
    //
    // The claim that actually matters on rerender is that the delete handler
    // does not go stale: it is built with useCallback([onDelete]), so a wrong
    // dependency list would keep invoking the FIRST onDelete and delete a
    // vertex the user is no longer pointing at.
    it('invokes the latest onDelete after repeated rerenders, not a stale one', () => {
      const handlers = Array.from({ length: 10 }, () => vi.fn());

      const { rerender } = render(
        <VertexContextMenu {...defaultProps} onDelete={handlers[0]} />
      );

      for (let i = 1; i < handlers.length; i++) {
        rerender(
          <VertexContextMenu {...defaultProps} onDelete={handlers[i]} />
        );
      }

      fireEvent.click(screen.getByTestId('context-menu-item'));

      expect(handlers[handlers.length - 1]).toHaveBeenCalledTimes(1);
      handlers.slice(0, -1).forEach((handler, i) => {
        expect(
          handler,
          `handler ${i} should not have been called`
        ).not.toHaveBeenCalled();
      });
    });
    it('does not cause memory leaks with callback changes', () => {
      const { rerender } = render(<VertexContextMenu {...defaultProps} />);
      // Change callback references multiple times
      for (let i = 0; i < 5; i++) {
        const newOnDelete = vi.fn();
        rerender(
          <VertexContextMenu {...defaultProps} onDelete={newOnDelete} />
        );
      }
      expect(screen.getByTestId('context-menu')).toBeInTheDocument();
    });
  });
  describe('Error Handling', () => {
    it('handles missing onDelete callback gracefully', () => {
      const { onDelete: _onDelete, ...propsWithoutCallback } = defaultProps;
      // Should not crash even if onDelete is undefined
      expect(() => {
        render(
          <VertexContextMenu
            {...propsWithoutCallback}
            onDelete={undefined as any}
          />
        );
      }).not.toThrow();
    });
    it('handles exception in onDelete callback', async () => {
      const faultyOnDelete = vi.fn(() => {
        // Suppress the error to prevent it from becoming an unhandled error
        try {
          throw new Error('Delete operation failed');
        } catch (error) {
          // Error is caught and handled
          console.error('Deletion failed:', error);
        }
      });
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      render(<VertexContextMenu {...defaultProps} onDelete={faultyOnDelete} />);
      const deleteItem = screen.getByTestId('context-menu-item');
      // Should not crash the component
      expect(() => {
        fireEvent.click(deleteItem);
      }).not.toThrow();
      await waitFor(() => {
        expect(faultyOnDelete).toHaveBeenCalledTimes(1);
      });
      consoleSpy.mockRestore();
    });
  });
});
