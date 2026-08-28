import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { downloadBlob, downloadJSON, downloadExcel } from '@/lib/downloadUtils';

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('downloadBlob', () => {
  let clickMock: ReturnType<typeof vi.fn>;
  let appendChildMock: ReturnType<typeof vi.fn>;
  let removeChildMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    clickMock = vi.fn();
    appendChildMock = vi.fn();
    removeChildMock = vi.fn();

    // jsdom does not implement URL.createObjectURL — assign directly
    URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/mock');
    URL.revokeObjectURL = vi.fn();

    vi.spyOn(document.body, 'appendChild').mockImplementation(appendChildMock);
    vi.spyOn(document.body, 'removeChild').mockImplementation(removeChildMock);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') {
        return {
          href: '',
          download: '',
          click: clickMock,
        } as unknown as HTMLAnchorElement;
      }
      return document.createElement.call(document, tag) as any;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('creates an object URL and sets it on the anchor element', () => {
    const blob = new Blob(['data'], { type: 'text/plain' });
    downloadBlob(blob, { filename: 'file.txt' });
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
  });

  it('sets the download attribute to the provided filename', () => {
    const blob = new Blob(['data']);
    let capturedLink: any;
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') {
        capturedLink = { href: '', download: '', click: clickMock };
        return capturedLink as unknown as HTMLAnchorElement;
      }
      return document.createElement.call(document, tag) as any;
    });

    downloadBlob(blob, { filename: 'export.xlsx' });
    expect(capturedLink.download).toBe('export.xlsx');
  });

  it('appends the link to the body before clicking', () => {
    const blob = new Blob(['data']);
    downloadBlob(blob, { filename: 'file.txt' });
    expect(appendChildMock).toHaveBeenCalled();
    expect(clickMock).toHaveBeenCalled();
  });

  it('cleans up the DOM and revokes the object URL after a delay', () => {
    const blob = new Blob(['data']);
    downloadBlob(blob, { filename: 'file.txt' });

    expect(removeChildMock).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);

    expect(removeChildMock).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(
      'blob:http://localhost/mock'
    );
  });

  it('skips cleanup when cleanup option is false', () => {
    const blob = new Blob(['data']);
    downloadBlob(blob, { filename: 'file.txt', cleanup: false });
    vi.advanceTimersByTime(200);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });
});

describe('downloadJSON', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/mock');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(document.body, 'appendChild').mockImplementation(vi.fn());
    vi.spyOn(document.body, 'removeChild').mockImplementation(vi.fn());
    vi.spyOn(document, 'createElement').mockReturnValue({
      href: '',
      download: '',
      click: vi.fn(),
    } as unknown as HTMLElement);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('appends .json extension when missing', () => {
    let capturedLink: any;
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') {
        capturedLink = { href: '', download: '', click: vi.fn() };
        return capturedLink as unknown as HTMLAnchorElement;
      }
      return document.createElement.call(document, tag) as any;
    });

    downloadJSON({ key: 'val' }, 'result');
    expect(capturedLink.download).toBe('result.json');
  });

  it('does not double-add .json when extension is already present', () => {
    let capturedLink: any;
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') {
        capturedLink = { href: '', download: '', click: vi.fn() };
        return capturedLink as unknown as HTMLAnchorElement;
      }
      return document.createElement.call(document, tag) as any;
    });

    downloadJSON({ key: 'val' }, 'result.json');
    expect(capturedLink.download).toBe('result.json');
  });
});

describe('downloadExcel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/mock');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(document.body, 'appendChild').mockImplementation(vi.fn());
    vi.spyOn(document.body, 'removeChild').mockImplementation(vi.fn());
    vi.spyOn(document, 'createElement').mockReturnValue({
      href: '',
      download: '',
      click: vi.fn(),
    } as unknown as HTMLElement);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('appends .xlsx extension when missing', () => {
    let capturedLink: any;
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') {
        capturedLink = { href: '', download: '', click: vi.fn() };
        return capturedLink as unknown as HTMLAnchorElement;
      }
      return document.createElement.call(document, tag) as any;
    });

    const blob = new Blob(['binary']);
    downloadExcel(blob, 'report');
    expect(capturedLink.download).toBe('report.xlsx');
  });
});
