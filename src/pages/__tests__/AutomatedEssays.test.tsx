/**
 * AutomatedEssays page — the run-error surface.
 *
 * Reported 2026-08-12: "web už zobrazuje že některé jamky nebyly přečteny
 * nicméně vidím jen první větu hlášení ale nemůžu ji nahlédnout celou a buď
 * nevím kde nebo není možné ji otevřít."
 *
 * The message was rendered in a `truncate` span — one line, ellipsis — so a
 * partial run's explanation was clipped after roughly its first sentence. The
 * remainder existed only as a native `title` tooltip on the completed branch,
 * and on the `failed` branch not even that: that span carried no title at all,
 * making a failed run's reason unreadable by any means.
 *
 * These tests assert what the user can actually read, not which class names the
 * component happens to use, except where the class IS the behaviour (`truncate`
 * clamps in a real browser but not in jsdom, so it has to be asserted directly —
 * jsdom does no layout, and a text assertion alone would pass on the bug).
 *
 * NOT tested here: upload/dropzone, download token flow, delete — unrelated to
 * the report.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import type { EssayJob } from '@/types/essays';

const { mockListEssayJobs } = vi.hoisted(() => ({
  mockListEssayJobs: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  default: {
    listEssayJobs: mockListEssayJobs,
    uploadEssays: vi.fn(),
    deleteEssayJob: vi.fn(),
    getEssayDownloadToken: vi.fn(),
    buildEssayDownloadUrl: vi.fn(),
  },
}));

vi.mock('@/components/DashboardHeader', () => ({
  default: () => <div data-testid="dashboard-header" />,
}));
vi.mock('@/components/essays/EssaysDropzone', () => ({
  default: () => <div data-testid="essays-dropzone" />,
}));
vi.mock('@/contexts/useLanguage', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

import AutomatedEssays from '../AutomatedEssays';

// The exact string the worker now puts on a partial run (essays_api.py). Two
// sentences: the bug was that only the first one survived the clamp.
const PARTIAL_ERROR =
  '68 well/position failure(s) — these wells are missing from results.csv. ' +
  'failures.csv in the download names each one and why it failed.';

const job = (over: Partial<EssayJob> = {}): EssayJob => ({
  id: 'job-1',
  name: '20260601_201313_389',
  status: 'completed',
  progress: 100,
  fileCount: 180,
  mtCount: 182333,
  device: 'cuda',
  resultZipKey: 'essays-results/job-1.zip',
  error: null,
  createdAt: '2026-08-10T13:49:31.176Z',
  updatedAt: '2026-08-11T10:15:32.089Z',
  completedAt: '2026-08-11T10:15:32.089Z',
  ...over,
});

const renderPage = async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AutomatedEssays />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return screen.findByTestId('essay-job-error');
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('AutomatedEssays run error', () => {
  it('shows a partial run’s whole message, not just its first sentence', async () => {
    mockListEssayJobs.mockResolvedValue([job({ error: PARTIAL_ERROR })]);

    const el = await renderPage();

    expect(el).toHaveTextContent(PARTIAL_ERROR);
    // The sentence that names failures.csv is the one the clamp used to eat,
    // and it is the only pointer the user has to the per-well reasons.
    expect(el.textContent).toContain('failures.csv in the download');
  });

  it('does not clamp the message to a single line', async () => {
    mockListEssayJobs.mockResolvedValue([job({ error: PARTIAL_ERROR })]);

    const text = (await renderPage()).querySelector('span');

    expect(text).not.toBeNull();
    // `truncate` is white-space:nowrap + ellipsis — the reported bug itself.
    expect(text!.className).not.toMatch(/\btruncate\b/);
    expect(text!.className).toMatch(/whitespace-pre-wrap/);
  });

  it('renders a failed run’s reason, which previously had no tooltip either', async () => {
    const failure =
      'evaluate.py exited with code 1. Last output:\n' +
      'Traceback (most recent call last):\n' +
      '  File "evaluate.py", line 199, in main\n' +
      'torch.OutOfMemoryError: CUDA out of memory.';
    mockListEssayJobs.mockResolvedValue([
      job({ status: 'failed', error: failure, resultZipKey: null }),
    ]);

    const el = await renderPage();

    expect(el.textContent).toContain('torch.OutOfMemoryError');
    expect(el.textContent).toContain('line 199');
  });

  it('keeps a long message readable by scrolling it, not by hiding it', async () => {
    mockListEssayJobs.mockResolvedValue([
      job({ status: 'failed', error: Array(60).fill('line').join('\n') }),
    ]);

    const text = (await renderPage()).querySelector('span')!;

    // Capped by height with a scrollbar: the tail stays reachable instead of
    // being dropped, and one bad run cannot push the rest of the list offscreen.
    expect(text.className).toMatch(/overflow-y-auto/);
    expect(text.className).toMatch(/max-h-/);
  });

  it('says nothing when a completed run lost no wells', async () => {
    mockListEssayJobs.mockResolvedValue([job({ error: null })]);

    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemoryRouter>
          <AutomatedEssays />
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(await screen.findByText('20260601_201313_389')).toBeInTheDocument();
    expect(screen.queryByTestId('essay-job-error')).not.toBeInTheDocument();
  });
});
