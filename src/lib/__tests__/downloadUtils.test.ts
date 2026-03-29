import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  downloadBlob,
  downloadFromResponse,
  downloadJSON,
  downloadExcel,
  downloadCSV,
  canDownloadLargeFiles,
  downloadUsingIframe,
} from '@/lib/downloadUtils';

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
        return { href: '', download: '', click: clickMock } as unknown as HTMLAnchorElement;
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
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/mock');
  });

  it('skips cleanup when cleanup option is false', () => {
    const blob = new Blob(['data']);
    downloadBlob(blob, { filename: 'file.txt', cleanup: false });
    vi.advanceTimersByTime(200);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });
});

describe('downloadFromResponse', () => {
  beforeEach(() => {
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

  afterEach(() => vi.restoreAllMocks());

  it('uses response.data directly when it is already a Blob', async () => {
    const blob = new Blob(['content'], { type: 'application/octet-stream' });
    await downloadFromResponse({ data: blob }, 'output.bin');
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
  });

  it('wraps non-Blob response.data in a Blob', async () => {
    await downloadFromResponse({ data: 'plain text' }, 'output.txt');
    const blobArg = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    expect(blobArg).toBeInstanceOf(Blob);
  });
});

describe('downloadJSON', () => {
  beforeEach(() => {
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

  afterEach(() => vi.restoreAllMocks());

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

  afterEach(() => vi.restoreAllMocks());

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

describe('downloadCSV', () => {
  beforeEach(() => {
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

  afterEach(() => vi.restoreAllMocks());

  it('appends .csv extension when missing', () => {
    let capturedLink: any;
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') {
        capturedLink = { href: '', download: '', click: vi.fn() };
        return capturedLink as unknown as HTMLAnchorElement;
      }
      return document.createElement.call(document, tag) as any;
    });

    downloadCSV('a,b,c\n1,2,3', 'data');
    expect(capturedLink.download).toBe('data.csv');
  });
});

describe('canDownloadLargeFiles', () => {
  it('returns true for a modern Chrome user agent', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      configurable: true,
    });
    expect(canDownloadLargeFiles()).toBe(true);
  });

  it('returns true for a modern Firefox user agent', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Windows NT 10.0; rv:109.0) Gecko/20100101 Firefox/109.0',
      configurable: true,
    });
    expect(canDownloadLargeFiles()).toBe(true);
  });

  it('returns false for old Safari (version < 14)', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.5 Safari/605.1.15',
      configurable: true,
    });
    expect(canDownloadLargeFiles()).toBe(false);
  });

  it('returns true for Safari version >= 14', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Safari/605.1.15',
      configurable: true,
    });
    expect(canDownloadLargeFiles()).toBe(true);
  });
});

describe('downloadUsingIframe', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('creates a hidden iframe and appends it to the body', () => {
    const appendChildMock = vi.spyOn(document.body, 'appendChild').mockImplementation(vi.fn());
    const iframeSrc: string[] = [];
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'iframe') {
        const iframe = { style: { display: '' }, src: '' } as unknown as HTMLIFrameElement;
        Object.defineProperty(iframe, 'src', {
          set(val) { iframeSrc.push(val); },
          get() { return iframeSrc.at(-1) ?? ''; },
        });
        return iframe;
      }
      return document.createElement.call(document, tag) as any;
    });

    downloadUsingIframe('https://example.com/download/file.zip');
    expect(appendChildMock).toHaveBeenCalled();
    expect(iframeSrc).toContain('https://example.com/download/file.zip');
  });

  it('removes the iframe from the body after 5 seconds', () => {
    const removeChildMock = vi
      .spyOn(document.body, 'removeChild')
      .mockImplementation(vi.fn());
    vi.spyOn(document.body, 'appendChild').mockImplementation(vi.fn());
    vi.spyOn(document, 'createElement').mockReturnValue({
      style: { display: '' },
      src: '',
    } as unknown as HTMLElement);

    downloadUsingIframe('https://example.com/file.zip');
    expect(removeChildMock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5000);
    expect(removeChildMock).toHaveBeenCalled();
  });
});
