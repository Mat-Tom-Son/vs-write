import { useState, useMemo } from 'react';
import { Search, X, FileText } from 'lucide-react';
import { useStoryStore, type EditorTab } from '../../lib/store';
import { SectionList } from './SectionList';
import type { Section } from '../../lib/schemas';

interface SearchResult {
  section: Section;
  titleMatch: boolean;
  contentMatches: { line: number; text: string; matchStart: number; matchEnd: number }[];
}

function highlightMatch(text: string, start: number, end: number): React.ReactNode {
  return (
    <>
      {text.slice(0, start)}
      <mark className="search-highlight">{text.slice(start, end)}</mark>
      {text.slice(end)}
    </>
  );
}

function SearchResultItem({ result }: { result: SearchResult }) {
  const openTab = useStoryStore((s) => s.openTab);

  const handleClick = () => {
    const tab: EditorTab = {
      id: `section-${result.section.id}`,
      title: result.section.title,
      path: '',
      type: 'section',
      sectionId: result.section.id,
    };
    openTab(tab);
  };

  return (
    <div className="search-result-item" onClick={handleClick}>
      <div className="search-result-header">
        <FileText size={14} />
        <span className="search-result-title">
          {result.titleMatch ? (
            <mark className="search-highlight">{result.section.title}</mark>
          ) : (
            result.section.title
          )}
        </span>
      </div>
      {result.contentMatches.length > 0 && (
        <div className="search-result-matches">
          {result.contentMatches.slice(0, 3).map((match, idx) => (
            <div key={idx} className="search-result-match">
              <span className="search-result-line">L{match.line}</span>
              <span className="search-result-text">
                {highlightMatch(match.text, match.matchStart, match.matchEnd)}
              </span>
            </div>
          ))}
          {result.contentMatches.length > 3 && (
            <div className="search-result-more">
              +{result.contentMatches.length - 3} more matches
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SectionsPanel() {
  const [query, setQuery] = useState('');
  const sections = useStoryStore((s) => s.project.sections);

  const searchResults = useMemo(() => {
    if (!query.trim()) return null;

    const q = query.toLowerCase();
    const results: SearchResult[] = [];

    for (const section of sections) {
      const titleMatch = section.title.toLowerCase().includes(q);
      const contentMatches: SearchResult['contentMatches'] = [];

      // Search content line by line
      const lines = section.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lowerLine = line.toLowerCase();
        const matchIndex = lowerLine.indexOf(q);

        if (matchIndex !== -1) {
          // Get context around the match (up to 60 chars)
          const contextStart = Math.max(0, matchIndex - 20);
          const contextEnd = Math.min(line.length, matchIndex + q.length + 40);
          let text = line.slice(contextStart, contextEnd);

          // Add ellipsis if truncated
          if (contextStart > 0) text = '...' + text;
          if (contextEnd < line.length) text = text + '...';

          // Adjust match position for the context window
          const adjustedStart = matchIndex - contextStart + (contextStart > 0 ? 3 : 0);
          const adjustedEnd = adjustedStart + q.length;

          contentMatches.push({
            line: i + 1,
            text,
            matchStart: adjustedStart,
            matchEnd: adjustedEnd,
          });
        }
      }

      if (titleMatch || contentMatches.length > 0) {
        results.push({ section, titleMatch, contentMatches });
      }
    }

    // Sort by relevance: title matches first, then by number of content matches
    return results.sort((a, b) => {
      if (a.titleMatch && !b.titleMatch) return -1;
      if (!a.titleMatch && b.titleMatch) return 1;
      return b.contentMatches.length - a.contentMatches.length;
    });
  }, [query, sections]);

  const isSearching = query.trim().length > 0;

  return (
    <div className="sections-panel">
      <div className="sections-panel-header">
        <h3>Sections</h3>
      </div>

      <div className="section-search">
        <Search size={14} className="section-search-icon" />
        <input
          type="text"
          placeholder="Search sections..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="section-search-input"
        />
        {query && (
          <button className="section-search-clear" onClick={() => setQuery('')}>
            <X size={14} />
          </button>
        )}
      </div>

      {isSearching ? (
        <div className="search-results">
          {searchResults && searchResults.length > 0 ? (
            <>
              <div className="search-results-count">
                {searchResults.length} section{searchResults.length !== 1 ? 's' : ''} found
              </div>
              {searchResults.map((result) => (
                <SearchResultItem key={result.section.id} result={result} />
              ))}
            </>
          ) : (
            <div className="search-no-results">No sections match "{query}"</div>
          )}
        </div>
      ) : (
        <SectionList />
      )}
    </div>
  );
}
