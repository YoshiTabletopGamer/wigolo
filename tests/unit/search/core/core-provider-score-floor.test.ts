import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RawSearchResult } from '../../../../src/types.js';

const runV1Search = vi.fn();
vi.mock('../../../../src/search/core/orchestrator.js', () => ({ runV1Search }));
vi.mock('../../../../src/search/content-fetch.js', () => ({ fetchContentForResults: vi.fn(async () => {}) }));

const { CoreSearchProvider } = await import('../../../../src/search/core/core-provider.js');

function res(url: string, score: number): RawSearchResult {
  return { title: url, url, snippet: 's', relevance_score: score, engine: 'e1' };
}

function dispatchOf(results: RawSearchResult[]) {
  return { results, enginesUsed: ['e1'], outcomes: [], degraded: false };
}

describe('core-provider relevance-score floor (final-ordering seam)', () => {
  beforeEach(() => {
    runV1Search.mockReset();
  });

  it('drops the A1 near-zero tail from the returned top-N (fast tier, single dispatch)', async () => {
    // Scores mirror the post-rerank A1 distribution: 3 on-topic above the
    // floor, 2 Cambridge-dictionary results in the tier-0 near-zero band.
    runV1Search.mockResolvedValue(
      dispatchOf([
        res('https://en.wikipedia.org/wiki/Reciprocal_rank_fusion', 1.0),
        res('https://safjan.com/rrf-python', 0.71),
        res('https://plg.uwaterloo.ca/cormack-rrf.pdf', 0.63),
        res('https://dictionary.cambridge.org/dictionary/english/reciprocal', 0.0097),
        res('https://dictionary.cambridge.org/dictionary/english/rank', 0.0003),
      ]),
    );
    const provider = new CoreSearchProvider();
    const out = await provider.search(
      { query: 'reciprocal rank fusion explained', search_depth: 'fast', include_content: false },
      { router: undefined } as never,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const urls = out.data.results.map((r) => r.url);
    expect(urls).not.toContain('https://dictionary.cambridge.org/dictionary/english/reciprocal');
    expect(urls).not.toContain('https://dictionary.cambridge.org/dictionary/english/rank');
    expect(urls).toContain('https://en.wikipedia.org/wiki/Reciprocal_rank_fusion');
    expect(urls).toContain('https://safjan.com/rrf-python');
    expect(urls).toContain('https://plg.uwaterloo.ca/cormack-rrf.pdf');
    expect(out.data.results).toHaveLength(3);
  });

  it('keeps all results when none fall below the floor', async () => {
    runV1Search.mockResolvedValue(
      dispatchOf([res('https://a.com', 1.0), res('https://b.com', 0.4), res('https://c.com', 0.2)]),
    );
    const provider = new CoreSearchProvider();
    const out = await provider.search(
      { query: 'some query', search_depth: 'fast', include_content: false },
      { router: undefined } as never,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.data.results).toHaveLength(3);
  });

  it('never empties the result set even if every score is below the floor', async () => {
    runV1Search.mockResolvedValue(
      dispatchOf([res('https://a.com', 0.004), res('https://b.com', 0.002)]),
    );
    const provider = new CoreSearchProvider();
    const out = await provider.search(
      { query: 'opaque', search_depth: 'fast', include_content: false },
      { router: undefined } as never,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.data.results).toHaveLength(1);
    expect(out.data.results[0].url).toBe('https://a.com');
  });
});
