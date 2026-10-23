import { describe, it, expect } from 'vitest';
import { matchesAllTerms, toSearchTerms } from '../textSearch';

describe('textSearch', () => {
  it('splits a query into normalized terms', () => {
    expect(toSearchTerms('  Kančí   SPERMIE ')).toEqual(['kanci', 'spermie']);
    expect(toSearchTerms('   ')).toEqual([]);
  });

  it('ignores case and accents on both sides', () => {
    expect(matchesAllTerms('vlastovka_dvě', toSearchTerms('DVE'))).toBe(true);
    expect(matchesAllTerms('vlastovka_dve', toSearchTerms('dvě'))).toBe(true);
  });

  it('needs every term, in any order', () => {
    const terms = toSearchTerms('test cos26');
    expect(matchesAllTerms('COS26-662-test', terms)).toBe(true);
    expect(matchesAllTerms('COS26-700', terms)).toBe(false);
  });
});
