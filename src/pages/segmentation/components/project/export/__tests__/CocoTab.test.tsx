import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import CocoTab from '../CocoTab';

vi.mock('@/pages/segmentation/utils/cocoConverter', () => ({
  convertToCOCO: vi.fn(() =>
    JSON.stringify(
      { info: {}, images: [], annotations: [], categories: [] },
      null,
      2
    )
  ),
}));

vi.mock('@/lib/downloadUtils', () => ({
  downloadJSON: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockSegmentation = {
  id: 'seg-1',
  polygons: [
    {
      id: 'poly-1',
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      type: 'external' as const,
    },
  ],
  imageWidth: 800,
  imageHeight: 600,
};

describe('CocoTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the COCO format title', () => {
    render(<CocoTab segmentation={mockSegmentation} />);
    expect(screen.getByText(/coco/i)).toBeInTheDocument();
  });

  it('renders copy button', () => {
    render(<CocoTab segmentation={mockSegmentation} />);
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument();
  });

  it('renders download button', () => {
    render(<CocoTab segmentation={mockSegmentation} />);
    expect(
      screen.getByRole('button', { name: /download/i })
    ).toBeInTheDocument();
  });

  it('displays COCO JSON output in pre element', () => {
    render(<CocoTab segmentation={mockSegmentation} />);
    const pre = document.querySelector('pre');
    expect(pre).toBeInTheDocument();
    expect(pre?.textContent).toContain('info');
  });

  it('copy button is present and clickable without throwing', async () => {
    // jsdom does not support navigator.clipboard in a secure context;
    // we verify the button is rendered and the click handler does not throw
    const user = userEvent.setup();
    render(<CocoTab segmentation={mockSegmentation} />);
    const copyButton = screen.getByRole('button', { name: /copy/i });
    // Should not throw even if clipboard is unavailable
    await expect(user.click(copyButton)).resolves.toBeUndefined();
  });

  it('calls downloadJSON when download button is clicked', async () => {
    const { downloadJSON } = await import('@/lib/downloadUtils');
    const user = userEvent.setup();
    render(<CocoTab segmentation={mockSegmentation} />);
    const downloadButton = screen.getByRole('button', { name: /download/i });
    await user.click(downloadButton);
    expect(downloadJSON).toHaveBeenCalled();
  });

  it('download button calls downloadJSON with parsed JSON data', async () => {
    const { downloadJSON } = await import('@/lib/downloadUtils');
    const user = userEvent.setup();
    render(<CocoTab segmentation={mockSegmentation} />);
    await user.click(screen.getByRole('button', { name: /download/i }));
    expect(downloadJSON).toHaveBeenCalledWith(
      expect.objectContaining({ info: expect.anything() }),
      'segmentation-coco'
    );
  });
});
