import { toast } from 'sonner';
import { useLanguage } from '@/contexts/useLanguage';
import {
  SPHEROSEG_BIBTEX,
  SPHEROSEG_PAPER,
  SPHEROSEG_PAPER_URL,
} from '@/lib/citation';

/** "How to cite" on the welcome page: the reference, its DOI and BibTeX. */
const CitationSection = () => {
  const { t } = useLanguage();
  const paper = SPHEROSEG_PAPER;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(SPHEROSEG_BIBTEX);
      toast.success(t('landing.citation.copied'));
    } catch {
      // No clipboard permission, or an insecure context. The BibTeX is on
      // screen as selectable text, so it can still be copied by hand.
      toast.error(t('landing.citation.copyFailed'));
    }
  };

  return (
    <section
      id="cite"
      className="border-t border-gray-200 py-16 dark:border-gray-800"
    >
      <div className="container mx-auto px-4">
        <div className="grid gap-10 lg:grid-cols-[20rem_minmax(0,1fr)] lg:gap-16">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-blue-700 dark:text-blue-300">
              {t('landing.citation.badge')}
            </p>
            <h2 className="mt-4 text-2xl font-semibold tracking-[-0.02em] text-gray-900 md:text-3xl dark:text-gray-50">
              {t('landing.citation.title')}
            </h2>
          </div>

          <div className="min-w-0 max-w-2xl space-y-5">
            <p className="leading-relaxed text-gray-600 dark:text-gray-300">
              {t('landing.citation.intro')}
            </p>

            <p
              data-testid="citation-reference"
              className="border-l-2 border-blue-600 pl-4 leading-relaxed text-gray-800 dark:border-blue-400 dark:text-gray-200"
            >
              {paper.authors.join(', ')} {paper.title}. <i>{paper.journal}</i>{' '}
              {paper.volume} ({paper.year}) {paper.articleNumber}.{' '}
              <a
                href={SPHEROSEG_PAPER_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="break-words font-medium text-blue-600 underline-offset-4 hover:underline dark:text-blue-400"
              >
                doi:{paper.doi}
              </a>
            </p>

            <div>
              <div className="flex items-center justify-between gap-4">
                <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">
                  BibTeX
                </span>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="rounded-md border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
                >
                  {t('landing.citation.copyBibtex')}
                </button>
              </div>
              <pre className="mt-2 overflow-x-auto rounded-md bg-gray-100 p-4 font-mono text-xs leading-relaxed text-gray-800 ring-1 ring-inset ring-gray-200 dark:bg-white/5 dark:text-gray-200 dark:ring-white/10">
                <code>{SPHEROSEG_BIBTEX}</code>
              </pre>
            </div>

            <a
              href={SPHEROSEG_PAPER_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-sm text-blue-600 underline-offset-4 hover:underline dark:text-blue-400"
            >
              {t('landing.citation.readPaper')} →
            </a>
          </div>
        </div>
      </div>
    </section>
  );
};

export default CitationSection;
