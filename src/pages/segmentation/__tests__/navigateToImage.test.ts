import { describe, it, expect } from 'vitest';

// Mirror of the navigation logic in SegmentationEditor.tsx — keeps the
// test isolated from React rendering. If the implementation changes,
// keep this mirror in sync.
function chooseNextFrame(
  projectImages: Array<{
    id: string;
    parentVideoId?: string | null;
    frameIndex?: number | null;
  }>,
  currentId: string,
  direction: 'prev' | 'next'
): string | null {
  const current = projectImages.find(img => img.id === currentId);
  if (!current) return null;

  if (current.parentVideoId) {
    const siblings = projectImages
      .filter(img => img.parentVideoId === current.parentVideoId)
      .sort((a, b) => (a.frameIndex ?? 0) - (b.frameIndex ?? 0));
    const idx = siblings.findIndex(img => img.id === currentId);
    if (idx < 0) return null;
    const target =
      direction === 'next'
        ? siblings[(idx + 1) % siblings.length]
        : siblings[(idx - 1 + siblings.length) % siblings.length];
    return target?.id ?? null;
  }

  const currentIndex = projectImages.findIndex(img => img.id === currentId);
  if (currentIndex === -1) return null;

  const nextIndex =
    direction === 'next'
      ? currentIndex < projectImages.length - 1
        ? currentIndex + 1
        : 0
      : currentIndex > 0
        ? currentIndex - 1
        : projectImages.length - 1;
  return projectImages[nextIndex]?.id ?? null;
}

describe('SegmentationEditor navigateToImage', () => {
  // The gallery defaults to updatedAt DESC, so a 3-frame video has the
  // newest frame at index 0 and the oldest at index 2. Without the
  // sibling-by-frameIndex special case, "next" from the middle frame
  // would land on the oldest frame, surprising the user.
  const galleryDescByUpdatedAt = [
    {
      id: 'frame-3',
      parentVideoId: 'video-1',
      frameIndex: 2,
    },
    {
      id: 'frame-2',
      parentVideoId: 'video-1',
      frameIndex: 1,
    },
    {
      id: 'frame-1',
      parentVideoId: 'video-1',
      frameIndex: 0,
    },
  ];

  it('next from frame 2 lands on frame 3 (frameIndex order, NOT gallery sort)', () => {
    expect(chooseNextFrame(galleryDescByUpdatedAt, 'frame-2', 'next')).toBe(
      'frame-3'
    );
  });

  it('prev from frame 2 lands on frame 1 (frameIndex order, NOT gallery sort)', () => {
    expect(chooseNextFrame(galleryDescByUpdatedAt, 'frame-2', 'prev')).toBe(
      'frame-1'
    );
  });

  it('next wraps from last frame back to first frame', () => {
    expect(chooseNextFrame(galleryDescByUpdatedAt, 'frame-3', 'next')).toBe(
      'frame-1'
    );
  });

  it('prev wraps from first frame to last frame', () => {
    expect(chooseNextFrame(galleryDescByUpdatedAt, 'frame-1', 'prev')).toBe(
      'frame-3'
    );
  });

  it('frames of different containers do not interfere', () => {
    const twoVideos = [
      { id: 'a-1', parentVideoId: 'video-A', frameIndex: 0 },
      { id: 'a-2', parentVideoId: 'video-A', frameIndex: 1 },
      { id: 'b-1', parentVideoId: 'video-B', frameIndex: 0 },
      { id: 'b-2', parentVideoId: 'video-B', frameIndex: 1 },
    ];
    expect(chooseNextFrame(twoVideos, 'a-1', 'next')).toBe('a-2');
    expect(chooseNextFrame(twoVideos, 'a-2', 'next')).toBe('a-1'); // wraps within A
    expect(chooseNextFrame(twoVideos, 'b-1', 'next')).toBe('b-2');
  });

  it('standalone images use the gallery sort order', () => {
    const standalones = [
      { id: 'newest', parentVideoId: null, frameIndex: null },
      { id: 'middle', parentVideoId: null, frameIndex: null },
      { id: 'oldest', parentVideoId: null, frameIndex: null },
    ];
    expect(chooseNextFrame(standalones, 'middle', 'next')).toBe('oldest');
    expect(chooseNextFrame(standalones, 'middle', 'prev')).toBe('newest');
    expect(chooseNextFrame(standalones, 'newest', 'prev')).toBe('oldest');
    expect(chooseNextFrame(standalones, 'oldest', 'next')).toBe('newest');
  });

  it('returns null for an unknown image id', () => {
    expect(chooseNextFrame(galleryDescByUpdatedAt, 'unknown', 'next')).toBe(
      null
    );
  });
});
