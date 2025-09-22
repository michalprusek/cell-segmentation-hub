import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ProcessingSlots, { ProcessingSlot } from '../ProcessingSlots';
import { useLanguage } from '@/contexts/useLanguage';

// Mock the useLanguage hook
vi.mock('@/contexts/useLanguage', () => ({
  useLanguage: vi.fn(),
}));

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
}));

const mockT = vi.fn((key: string, params?: Record<string, any>) => {
  const translations: Record<string, string> = {
    'queue.processingSlots': 'Processing Slots',
    'queue.active': 'active',
    'queue.you': 'You',
    'queue.yourSlot': 'Your slot: #{{slot}}',
    'queue.concurrentUsers': 'Also processing: {{users}}',
    'queue.availableSlots': '{{count}} slot available',
    'queue.availableSlots_other': '{{count}} slots available',
  };

  let result = translations[key] || key;

  if (params) {
    Object.entries(params).forEach(([param, value]) => {
      result = result.replace(new RegExp(`{{${param}}}`, 'g'), String(value));
    });
  }

  // Handle pluralization for availableSlots
  if (key === 'queue.availableSlots' && params?.count && params.count !== 1) {
    result = translations['queue.availableSlots_other'] || result;
    if (params) {
      Object.entries(params).forEach(([param, value]) => {
        result = result.replace(new RegExp(`{{${param}}}`, 'g'), String(value));
      });
    }
  }

  return result;
});

describe('ProcessingSlots', () => {
  beforeEach(() => {
    vi.mocked(useLanguage).mockReturnValue({ t: mockT });
  });

  it('renders empty slots when no active processing', () => {
    render(
      <ProcessingSlots totalSlots={4} activeSlots={[]} currentUserId="user1" />
    );

    expect(screen.getByText('Processing Slots')).toBeInTheDocument();
    expect(screen.getByText('0/4 active')).toBeInTheDocument();
    expect(screen.getByText('4 slots available')).toBeInTheDocument();
  });

  it('renders active slots with user information', () => {
    const activeSlots: ProcessingSlot[] = [
      {
        id: 0,
        isActive: true,
        userId: 'user1',
        userName: 'Alice',
        imageId: 'img1',
        progress: 50,
        estimatedCompletion: 120,
      },
      {
        id: 1,
        isActive: true,
        userId: 'user2',
        userName: 'Bob',
        imageId: 'img2',
        progress: 25,
        estimatedCompletion: 180,
      },
    ];

    render(
      <ProcessingSlots
        totalSlots={4}
        activeSlots={activeSlots}
        currentUserId="user1"
      />
    );

    expect(screen.getByText('2/4 active')).toBeInTheDocument();
    expect(screen.getByText('Your slot: #1')).toBeInTheDocument();
    expect(screen.getByText('Also processing: Bob')).toBeInTheDocument();
    expect(screen.getByText('2 slots available')).toBeInTheDocument();
  });

  it('highlights current user slot differently', () => {
    const activeSlots: ProcessingSlot[] = [
      {
        id: 0,
        isActive: true,
        userId: 'user1',
        userName: 'Alice',
        imageId: 'img1',
        progress: 50,
      },
      {
        id: 1,
        isActive: true,
        userId: 'user2',
        userName: 'Bob',
        imageId: 'img2',
        progress: 25,
      },
    ];

    render(
      <ProcessingSlots
        totalSlots={4}
        activeSlots={activeSlots}
        currentUserId="user1"
      />
    );

    // Check for current user indication - will show "You" for current user
    expect(screen.getByText('You')).toBeInTheDocument();
    // Check for other user's name
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('shows progress bars for active slots', () => {
    const activeSlots: ProcessingSlot[] = [
      {
        id: 0,
        isActive: true,
        userId: 'user1',
        progress: 75,
      },
    ];

    const { container } = render(
      <ProcessingSlots
        totalSlots={4}
        activeSlots={activeSlots}
        currentUserId="user1"
      />
    );

    // Check that progress bars container exists (the outer progress bar div)
    const progressContainers = container.querySelectorAll('.bg-gray-200');
    expect(progressContainers.length).toBeGreaterThan(0);
  });

  it('displays estimated completion time when available', () => {
    const activeSlots: ProcessingSlot[] = [
      {
        id: 0,
        isActive: true,
        userId: 'user1',
        estimatedCompletion: 180, // 3 minutes
      },
    ];

    render(
      <ProcessingSlots
        totalSlots={4}
        activeSlots={activeSlots}
        currentUserId="user1"
      />
    );

    expect(screen.getByText('~3m')).toBeInTheDocument();
  });

  it('handles multiple concurrent users correctly', () => {
    const activeSlots: ProcessingSlot[] = [
      {
        id: 0,
        isActive: true,
        userId: 'user1',
        userName: 'Alice',
      },
      {
        id: 1,
        isActive: true,
        userId: 'user2',
        userName: 'Bob',
      },
      {
        id: 2,
        isActive: true,
        userId: 'user3',
        userName: 'Charlie',
      },
    ];

    render(
      <ProcessingSlots
        totalSlots={4}
        activeSlots={activeSlots}
        currentUserId="user1"
      />
    );

    expect(screen.getByText('3/4 active')).toBeInTheDocument();
    expect(
      screen.getByText('Also processing: Bob, Charlie')
    ).toBeInTheDocument();
    expect(screen.getByText('1 slot available')).toBeInTheDocument();
  });

  it('renders correctly when all slots are full', () => {
    const activeSlots: ProcessingSlot[] = Array.from({ length: 4 }, (_, i) => ({
      id: i,
      isActive: true,
      userId: `user${i + 1}`,
      userName: `User${i + 1}`,
    }));

    render(
      <ProcessingSlots
        totalSlots={4}
        activeSlots={activeSlots}
        currentUserId="user1"
      />
    );

    expect(screen.getByText('4/4 active')).toBeInTheDocument();
    expect(screen.queryByText('slots available')).not.toBeInTheDocument();
  });
});
