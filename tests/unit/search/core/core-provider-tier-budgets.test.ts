import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RawSearchResult } from '../../../../src/types.js';

// fetchContentForResults mock — hoisted (vi.mock is statically hoisted)
const mockFetchContent = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../../../../src/search/content-fetch.js', () => ({
  fetchContentForResults: mockFetchContent,
}));

const runV1Search = vi.fn();
vi.mock('../../../../src/search/core/orchestrator.js', () => ({ runV1Search }));

const { CoreSearchProvider } = await import('../../../../src/search/core/core-provider.js');

function dispatch(url: string): { results: RawSearchResult[]; enginesUsed: string[]; outcomes: []; degraded: boolean } {
  return {
    results: [{ title: url, url, snippet: 's', relevance_score: 1, engine: 'e1' }],
    enginesUsed: ['e1'], outcomes: [], degraded: false,
  };
}

// A minimal router stub so include_content runs (core-provider gates on ctx.router)
const stubRouter = { fetch: vi.fn() } as never;

describe('core-provider tier budget wiring', () => {
  beforeEach(() => {
    runV1Search.mockReset();
    mockFetchContent.mockReset();
    mockFetchContent.mockResolvedValue(undefined);
  });

  it('balanced depth passes fetchTimeoutMs=3000 and stageBudgetMs=4000 to fetchContentForResults', async () => {
    runV1Search.mockResolvedValue(dispatch('https://a.com'));
    const provider = new CoreSearchProvider();
    await provider.search(
      { query: 'hello world', search_depth: 'balanced', include_content: true },
      { router: stubRouter } as never,
    );
    expect(mockFetchContent).toHaveBeenCalledOnce();
    const ctx = mockFetchContent.mock.calls[0][2] as Record<string, unknown>;
    expect(ctx.fetchTimeoutMs).toBe(3000);
    expect(ctx.stageBudgetMs).toBe(4000);
  });

  it('deep depth passes fetchTimeoutMs=8000 and stageBudgetMs=10000 to fetchContentForResults', async () => {
    runV1Search.mockResolvedValue(dispatch('https://b.com'));
    const provider = new CoreSearchProvider();
    await provider.search(
      { query: 'hello world', search_depth: 'deep', include_content: true },
      { router: stubRouter } as never,
    );
    expect(mockFetchContent).toHaveBeenCalledOnce();
    const ctx = mockFetchContent.mock.calls[0][2] as Record<string, unknown>;
    expect(ctx.fetchTimeoutMs).toBe(8000);
    expect(ctx.stageBudgetMs).toBe(10000);
  });

  it('fast depth skips fetchContentForResults entirely', async () => {
    runV1Search.mockResolvedValue(dispatch('https://c.com'));
    const provider = new CoreSearchProvider();
    await provider.search(
      { query: 'hello world', search_depth: 'fast', include_content: true },
      { router: stubRouter } as never,
    );
    expect(mockFetchContent).not.toHaveBeenCalled();
  });
});
