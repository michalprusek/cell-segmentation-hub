import { describe, it, expect } from 'vitest';
import type { ProjectImage } from '@/types';
import { projectCanBuildKymograph } from '../kymographGating';

/**
 * The project images listing returns per-frame rows (parentVideoId set), NOT the
 * video-container rows — a shape confirmed against the production wire. These
 * tests lock the gating against the original bug, where filtering on
 * `isVideoContainer` (never present in that listing) made the single-frame
 * forced-profile path unreachable.
 */

// Minimal ProjectImage factory — only the fields the gating reads.
const img = (over: Partial<ProjectImage>): ProjectImage =>
  ({
    id: Math.random().toString(36).slice(2),
    name: 'x',
    ...over,
  }) as ProjectImage;

const frames = (parentVideoId: string, count: number): ProjectImage[] =>
  Array.from({ length: count }, (_, i) =>
    img({ parentVideoId, frameIndex: i, isVideoContainer: false })
  );

describe('projectCanBuildKymograph', () => {
  it('is true when a container has ≥ 2 frames (frame rows share parentVideoId)', () => {
    expect(projectCanBuildKymograph(frames('c1', 3))).toBe(true);
  });

  it('is false for a single-frame container (one frame row)', () => {
    expect(projectCanBuildKymograph(frames('c1', 1))).toBe(false);
  });

  it('is true when ANY container is multi-frame (mixed project)', () => {
    expect(
      projectCanBuildKymograph([...frames('single', 1), ...frames('video', 5)])
    ).toBe(true);
  });

  it('is false for only standalone images (no parentVideoId)', () => {
    expect(
      projectCanBuildKymograph([
        img({ isVideoContainer: false, parentVideoId: undefined }),
        img({ isVideoContainer: false, parentVideoId: undefined }),
      ])
    ).toBe(false);
  });

  it('is false for an empty project', () => {
    expect(projectCanBuildKymograph([])).toBe(false);
  });

  it('honours a container row that carries frameCount > 1', () => {
    expect(
      projectCanBuildKymograph([
        img({ isVideoContainer: true, frameCount: 61 }),
      ])
    ).toBe(true);
  });

  it('treats a container row with frameCount 1 as single-frame', () => {
    expect(
      projectCanBuildKymograph([img({ isVideoContainer: true, frameCount: 1 })])
    ).toBe(false);
  });
});
