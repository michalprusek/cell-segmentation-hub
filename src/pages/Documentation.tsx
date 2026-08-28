import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Search, X } from 'lucide-react';
import { useActiveSection } from '@/hooks/useActiveSection';
import { useLanguage } from '@/contexts/useLanguage';
import { useAuth } from '@/contexts/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { buildDocsSections } from './documentation/docsContent';
import { useDocsSearch } from './documentation/useDocsSearch';
import { DocsBlockView, Highlight } from './documentation/DocsBlocks';

interface LocationState {
  from?: string;
  path?: string;
}

/**
 * The in-app user manual.
 *
 * Content lives as data in `documentation/docsContent.ts` rather than as JSX,
 * which is what makes the search box possible: the same array that renders the
 * page is the search corpus, so every section is findable in whichever of the
 * six locales the reader is using.
 */
const Documentation = () => {
  const { t } = useLanguage();
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const sections = useMemo(() => buildDocsSections(t), [t]);
  const {
    sections: visibleSections,
    isSearching,
    matchCount,
    terms,
  } = useDocsSearch(sections, query);

  // The scroll-spy tracks whatever is currently on the page, so it must follow
  // the filtered set — otherwise it keeps highlighting a section search hid.
  const sectionIds = useMemo(
    () => visibleSections.map(section => section.id),
    [visibleSections]
  );
  const { activeSection, scrollToSection } = useActiveSection(sectionIds);

  // "/" focuses the search box, Escape clears it — the convention every docs
  // site uses. Ignored while the user is typing somewhere else.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typingElsewhere =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true;

      if (event.key === '/' && !typingElsewhere) {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (event.key === 'Escape' && target === searchInputRef.current) {
        setQuery('');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const clearSearch = useCallback(() => {
    setQuery('');
    searchInputRef.current?.focus();
  }, []);

  const locationState = location.state as LocationState | null;
  const referrerPage = locationState?.from;
  const referrerPath = locationState?.path;
  const showNavbar = !isAuthenticated || !referrerPage || !referrerPath;

  const searchPlaceholder = String(t('docs.search.placeholder'));

  return (
    <div className="min-h-screen flex flex-col">
      {showNavbar && <Navbar />}
      <main className={`flex-1 ${showNavbar ? 'pt-24' : 'pt-8'} pb-16`}>
        <div className="container mx-auto px-4">
          {isAuthenticated && referrerPage && referrerPath && (
            <div className="max-w-7xl mx-auto mb-4 flex justify-end">
              <Button
                variant="outline"
                onClick={() => navigate(referrerPath)}
                className="flex items-center gap-2"
              >
                {t('docs.backTo', { page: referrerPage })}
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          )}

          {/* Header */}
          <div className="max-w-3xl mx-auto text-center mb-8 md:mb-10">
            <div className="inline-block bg-blue-100 px-4 py-2 rounded-full mb-4 dark:bg-blue-950">
              <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                {t('docs.badge')}
              </span>
            </div>
            <h1 className="text-3xl md:text-4xl font-bold mb-4">
              {t('docs.title')}
            </h1>
            <p className="text-xl text-gray-600 dark:text-gray-400">
              {t('docs.subtitle')}
            </p>
          </div>

          {/* Search */}
          <div className="max-w-2xl mx-auto mb-10">
            <label htmlFor="docs-search" className="sr-only">
              {searchPlaceholder}
            </label>
            <div className="relative">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
                aria-hidden="true"
              />
              <Input
                id="docs-search"
                ref={searchInputRef}
                type="search"
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder={searchPlaceholder}
                autoComplete="off"
                // The trailing arbitrary variant hides WebKit's built-in
                // search "clear" cross, which would otherwise sit next to our
                // own clear button — two X icons on top of each other.
                className="pl-10 pr-10 text-sm [&::-webkit-search-cancel-button]:appearance-none"
              />
              {query.length > 0 && (
                <button
                  type="button"
                  onClick={clearSearch}
                  aria-label={String(t('docs.search.clear'))}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <p
              className="mt-2 text-center text-xs text-gray-500 dark:text-gray-400"
              aria-live="polite"
            >
              {isSearching
                ? t('docs.search.results', { count: matchCount })
                : t('docs.search.hint')}
            </p>
          </div>

          {/* Main content */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 max-w-7xl mx-auto">
            {/* Sidebar */}
            <aside className="lg:col-span-1">
              <div className="sticky top-24 bg-white rounded-lg shadow-sm border border-gray-200 p-6 dark:bg-gray-900 dark:border-gray-700">
                <h2 className="font-semibold text-lg mb-4">
                  {t('docs.navigation')}
                </h2>
                <nav className="space-y-1">
                  {visibleSections.map(section => {
                    const Icon = section.icon;
                    const isActive = activeSection === section.id;
                    return (
                      <button
                        key={section.id}
                        onClick={() => scrollToSection(section.id)}
                        className={`flex items-center w-full text-left p-2 rounded-md transition-colors text-sm ${
                          isActive
                            ? 'text-blue-600 bg-blue-50 dark:bg-blue-950 dark:text-blue-300'
                            : 'text-gray-700 hover:text-blue-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800'
                        }`}
                      >
                        <Icon className="w-4 h-4 mr-2 flex-shrink-0" />
                        <span>{section.navLabel}</span>
                      </button>
                    );
                  })}
                  {visibleSections.length === 0 && (
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {t('docs.search.noResults')}
                    </p>
                  )}
                </nav>
              </div>
            </aside>

            {/* Sections */}
            <div className="lg:col-span-3 bg-white rounded-lg shadow-sm border border-gray-200 p-6 md:p-8 dark:bg-gray-900 dark:border-gray-700">
              {visibleSections.length === 0 ? (
                <div className="py-16 text-center">
                  <Search
                    className="w-10 h-10 mx-auto mb-4 text-gray-300 dark:text-gray-600"
                    aria-hidden="true"
                  />
                  <p className="text-lg font-medium mb-2">
                    {t('docs.search.noResults')}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                    {t('docs.search.noResultsHint')}
                  </p>
                  <Button variant="outline" onClick={clearSearch}>
                    {t('docs.search.clear')}
                  </Button>
                </div>
              ) : (
                visibleSections.map(section => (
                  <section key={section.id} id={section.id} className="mb-12">
                    <h2 className="text-2xl font-bold mb-4 pb-2 border-b border-gray-200 dark:border-gray-700">
                      <Highlight text={section.title} terms={terms} />
                    </h2>
                    {section.blocks.map((block, index) => (
                      <DocsBlockView
                        key={`${section.id}-${index}`}
                        block={block}
                        terms={terms}
                      />
                    ))}
                  </section>
                ))
              )}

              <div className="flex justify-between items-center mt-8 pt-4 border-t border-gray-200 dark:border-gray-700">
                <Link
                  to="/"
                  className="inline-flex items-center text-blue-600 hover:text-blue-800"
                >
                  <ArrowRight className="w-4 h-4 mr-2 transform rotate-180" />
                  {t('docs.footer.backToHome')}
                </Link>
                <button
                  onClick={() =>
                    scrollToSection(visibleSections[0]?.id ?? 'introduction')
                  }
                  className="inline-flex items-center text-blue-600 hover:text-blue-800"
                >
                  {t('docs.footer.backToTop')}
                  <ArrowRight className="w-4 h-4 ml-2 transform -rotate-90" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

Documentation.displayName = 'Documentation';

export default Documentation;
