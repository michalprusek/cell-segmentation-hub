import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { render } from '@/test/utils/test-utils';
import ProjectThumbnail from '@/components/project/ProjectThumbnail';

// apiClient is globally mocked in setup.ts.
import apiClient from '@/lib/api';

const PREVIEW = '/api/images/img-1/preview?v=0123456789abcdef';

describe('ProjectThumbnail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the project preview it is given', () => {
    render(<ProjectThumbnail src={PREVIEW} />);
    expect(screen.getByRole('img')).toHaveAttribute('src', PREVIEW);
  });

  it('makes no request of its own — the project list carries the preview', () => {
    render(<ProjectThumbnail src={PREVIEW} />);
    // It used to call GET /projects/<id>/images?limit=1 for every card.
    expect(apiClient.getProjectImages).not.toHaveBeenCalled();
    expect(apiClient.getProjectImagesWithThumbnails).not.toHaveBeenCalled();
  });

  it('shows the placeholder for a project with no image', () => {
    render(<ProjectThumbnail src={null} />);
    expect(screen.getByRole('img')).toHaveAttribute('src', '/placeholder.svg');
  });

  it('falls back to the placeholder when the preview cannot load', () => {
    render(<ProjectThumbnail src={PREVIEW} />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByRole('img')).toHaveAttribute('src', '/placeholder.svg');
  });

  it('tries a NEW preview after the previous one failed', () => {
    const { rerender } = render(<ProjectThumbnail src={PREVIEW} />);
    fireEvent.error(screen.getByRole('img'));

    const next = '/api/images/img-1/preview?v=fedcba9876543210';
    rerender(<ProjectThumbnail src={next} />);

    expect(screen.getByRole('img')).toHaveAttribute('src', next);
  });

  it('loads lazily, so a long dashboard does not fetch every card at once', () => {
    render(<ProjectThumbnail src={PREVIEW} />);
    expect(screen.getByRole('img')).toHaveAttribute('loading', 'lazy');
  });
});
