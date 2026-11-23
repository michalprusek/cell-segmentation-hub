import { useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/contexts/useLanguage';
import {
  MODULE_CITATIONS,
  SPHEROSEG_PAPER,
  SPHEROSEG_PAPER_URL,
  citationBibtex,
  doiUrl,
  referenceAuthors,
  selectedModules,
  type CitedWork,
} from '@/lib/citation';
import type { ProjectType } from '@/types';

const DOI_LINK_CLASS =
  'break-words font-medium text-blue-600 underline-offset-4 hover:underline dark:text-blue-400';
const REFERENCE_CLASS =
  'border-l-2 border-blue-600 pl-4 leading-relaxed text-gray-800 dark:border-blue-400 dark:text-gray-200';
const CAPTION_CLASS =
  'font-mono text-[11px] uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400';

const ToggleChip = ({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) => (
  <button
    type="button"
    aria-pressed={on}
    onClick={onClick}
    className={
      'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ' +
      (on
        ? 'border-blue-600 bg-blue-600 text-white hover:bg-blue-700 dark:border-blue-400 dark:bg-blue-400 dark:text-gray-950 dark:hover:bg-blue-300'
        : 'border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800')
    }
  >
    {on && <Check className="h-3.5 w-3.5" aria-hidden />}
    {children}
  </button>
);

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

/** A work in the paper's reference style; a conference paper has no DOI until published. */
const WorkReference = ({ work: w }: { work: CitedWork }) => (
  <>
    {referenceAuthors(w.creators).join(', ')} {w.title}.{' '}
    {w.kind === 'article' ? (
      <>
        <i>{w.journal}</i> {w.volume} ({w.year}) {w.articleNumber}.
      </>
    ) : (
      <>
        <i>{w.booktitle}</i>, {w.address} ({w.year}).
      </>
    )}
    {w.doi && (
      <>
        {' '}
        <DoiLink doi={w.doi} />
      </>
    )}
  </>
);

/**
 * "How to cite" on the welcome page: the platform paper, always, plus any
 * module the reader selects — each module's models have their own Zenodo
 * record. Nothing is selected by default; the reader decides what to cite.
 */
const CitationSection = () => {
  const { t } = useLanguage();
  const paper = SPHEROSEG_PAPER;
  const [selected, setSelected] = useState<readonly ProjectType[]>([]);
  // A module with no record of its own is cited through the paper, which is
  // always cited: this toggle explains that and adds NOTHING to the BibTeX.
  const [otherModule, setOtherModule] = useState(false);
  // One derivation for both: what is shown is exactly what is copied.
  const chosen = selectedModules(selected);
  const bibtex = citationBibtex(chosen);

  const toggle = (type: ProjectType) =>
    setSelected(prev =>
      prev.includes(type) ? prev.filter(x => x !== type) : [...prev, type]
    );

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
            <p className="leading-relaxed text-gray-600 dark:text-gray-300">
              {t('landing.citation.intro')}
            </p>

            <p data-testid="citation-reference" className={REFERENCE_CLASS}>
              {paper.authors.join(', ')} {paper.title}. <i>{paper.journal}</i>{' '}
              {paper.volume} ({paper.year}) {paper.articleNumber}.{' '}
              <DoiLink doi={paper.doi} />
            </p>

            {MODULE_CITATIONS.length > 0 && (
              <div>
                <span id="citation-modules-label" className={CAPTION_CLASS}>
                  {t('landing.citation.modulesLabel')}
                </span>
                <p
                  id="citation-modules-intro"
                  className="mt-2 text-sm leading-relaxed text-gray-600 dark:text-gray-300"
                >
                  {t('landing.citation.modulesIntro')}
                </p>
                <div
                  role="group"
                  aria-labelledby="citation-modules-label"
                  aria-describedby="citation-modules-intro"
                  className="mt-3 flex flex-wrap gap-2"
                >
                  {MODULE_CITATIONS.map(({ projectType }) => (
                    <ToggleChip
                      key={projectType}
                      on={selected.includes(projectType)}
                      onClick={() => toggle(projectType)}
                    >
                      {t(`projects.types.${projectType}`)}
                    </ToggleChip>
                  ))}
                  <ToggleChip
                    on={otherModule}
                    onClick={() => setOtherModule(on => !on)}
                  >
                    {t('landing.citation.otherModule')}
                  </ToggleChip>
                </div>
              </div>
            )}

            {chosen.map(m => (
              <div
                key={m.projectType}
                data-testid={`citation-module-${m.projectType}`}
                className="space-y-2"
              >
                {/* "Version" is not translated, like the journal name above:
                    a reference is text a reader copies into a manuscript, in
                    the language of the citation (DataCite's own rendering of
                    this record reads "(Version 1.0.0)"), not of the UI. */}
                <p
                  data-testid={`citation-module-reference-${m.projectType}`}
                  className={REFERENCE_CLASS}
                >
                  {referenceAuthors(m.creators).join(', ')} {m.title}. Version{' '}
                  {m.version}. <i>Zenodo</i> ({m.year}). <DoiLink doi={m.doi} />
                </p>
                {m.alsoCite && m.alsoCite.length > 0 && (
                  <div className="space-y-2 pl-4">
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                      {t('landing.citation.alsoCite')}
                    </p>
                    <ul className="space-y-2">
                      {m.alsoCite.map(w => (
                        <li
                          key={w.bibtexKey}
                          data-testid={`citation-work-${w.bibtexKey}`}
                          className={`text-sm ${REFERENCE_CLASS}`}
                        >
                          <WorkReference work={w} />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {m.noteKey && (
                  <p className="pl-4 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
                    {t(m.noteKey)}
                  </p>
                )}
              </div>
            ))}

            {otherModule && (
              <p
                data-testid="citation-other-module"
                className={`text-sm ${REFERENCE_CLASS}`}
              >
                {t('landing.citation.otherModuleNote')}
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
