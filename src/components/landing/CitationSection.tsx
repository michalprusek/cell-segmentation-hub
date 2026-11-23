import { useState } from 'react';
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import { Check } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/useLanguage';
import {
  CITATION_CHOICES,
  citationBibtex,
  doiUrl,
  referenceAuthors,
  type Citation,
  type CitationChoiceId,
} from '@/lib/citation';

const DOI_LINK_CLASS =
  'break-words font-medium text-blue-600 underline-offset-4 hover:underline dark:text-blue-400';
const REFERENCE_CLASS =
  'border-l-2 border-blue-600 pl-4 leading-relaxed text-gray-800 dark:border-blue-400 dark:text-gray-200';
const CAPTION_CLASS =
  'font-mono text-[11px] uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400';
const CHOICE_CLASS =
  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ' +
  'border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800 ' +
  'data-[state=checked]:border-blue-600 data-[state=checked]:bg-blue-600 data-[state=checked]:text-white data-[state=checked]:hover:bg-blue-700 ' +
  'dark:data-[state=checked]:border-blue-400 dark:data-[state=checked]:bg-blue-400 dark:data-[state=checked]:text-gray-950 dark:data-[state=checked]:hover:bg-blue-300';

const DoiLink = ({ doi }: { doi: string }) => (
  <a
    href={doiUrl(doi)}
    target="_blank"
    rel="noopener noreferrer"
    className={DOI_LINK_CLASS}
  >
    doi:{doi}
  </a>
);

/**
 * A work in the paper's reference style. "Version" is not translated, like a
 * journal name: a reference is text a reader copies into a manuscript, in the
 * language of the citation (DataCite's own rendering of a Zenodo record reads
 * "(Version 1.0.0)"), not of the UI.
 */
const CitationReference = ({ citation: c }: { citation: Citation }) => (
  <>
    {referenceAuthors(c.creators).join(', ')} {c.title}.{' '}
    {c.kind === 'article' && (
      <>
        <i>{c.journal}</i> {c.volume} ({c.year}) {c.articleNumber}.
      </>
    )}
    {c.kind === 'inproceedings' && (
      <>
        <i>{c.booktitle}</i>, {c.address} ({c.year}).
      </>
    )}
    {c.kind === 'zenodo' && (
      <>
        Version {c.version}. <i>Zenodo</i> ({c.year}).
      </>
    )}
    {c.doi && (
      <>
        {' '}
        <DoiLink doi={c.doi} />
      </>
    )}
  </>
);

/**
 * "How to cite" on the welcome page. The reader picks the ONE module they
 * used, and sees the ONE work that cites it (CITATION_CHOICES); nothing is
 * picked by default, so nothing is cited until they choose.
 */
const CitationSection = () => {
  const { t } = useLanguage();
  const [choiceId, setChoiceId] = useState<CitationChoiceId | ''>('');
  const choice = CITATION_CHOICES.find(c => c.id === choiceId);
  // One derivation for both: what is shown is exactly what is copied.
  const bibtex = choice ? citationBibtex(choice.citation) : '';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(bibtex);
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
            <p
              id="citation-intro"
              className="leading-relaxed text-gray-600 dark:text-gray-300"
            >
              {t('landing.citation.intro')}
            </p>

            <div>
              <span id="citation-modules-label" className={CAPTION_CLASS}>
                {t('landing.citation.modulesLabel')}
              </span>
              <RadioGroupPrimitive.Root
                value={choiceId}
                onValueChange={value => setChoiceId(value as CitationChoiceId)}
                aria-labelledby="citation-modules-label"
                aria-describedby="citation-intro"
                orientation="horizontal"
                className="mt-2 flex flex-wrap gap-2"
              >
                {CITATION_CHOICES.map(c => (
                  <RadioGroupPrimitive.Item
                    key={c.id}
                    value={c.id}
                    className={CHOICE_CLASS}
                  >
                    <RadioGroupPrimitive.Indicator>
                      <Check className="h-3.5 w-3.5" aria-hidden />
                    </RadioGroupPrimitive.Indicator>
                    {t(c.labelKey)}
                  </RadioGroupPrimitive.Item>
                ))}
              </RadioGroupPrimitive.Root>
            </div>

            {choice && (
              <>
                <p data-testid="citation-reference" className={REFERENCE_CLASS}>
                  <CitationReference citation={choice.citation} />
                </p>
                {choice.noteKey && (
                  <p
                    data-testid="citation-note"
                    className="pl-4 text-sm leading-relaxed text-gray-500 dark:text-gray-400"
                  >
                    {t(choice.noteKey)}
                  </p>
                )}

                <div>
                  <div className="flex items-center justify-between gap-4">
                    <span className={CAPTION_CLASS}>BibTeX</span>
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="rounded-md border border-gray-300 px-3 py-1 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
                    >
                      {t('landing.citation.copyBibtex')}
                    </button>
                  </div>
                  <pre className="mt-2 overflow-x-auto rounded-md bg-gray-100 p-4 font-mono text-xs leading-relaxed text-gray-800 ring-1 ring-inset ring-gray-200 dark:bg-white/5 dark:text-gray-200 dark:ring-white/10">
                    <code>{bibtex}</code>
                  </pre>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

export default CitationSection;
