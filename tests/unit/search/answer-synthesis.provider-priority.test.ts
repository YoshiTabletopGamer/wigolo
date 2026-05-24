import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as runLlmModule from '../../../src/integrations/cloud/llm/run.js';
import { runSynthesis } from '../../../src/search/answer-synthesis.js';
import type { SearchResultItem } from '../../../src/types.js';

function makeResult(overrides: Partial<SearchResultItem> = {}): SearchResultItem {
  return {
    title: overrides.title ?? 'PostgreSQL 18 Release',
    url: overrides.url ?? 'https://www.postgresql.org/docs/18/release-18.html',
    snippet: overrides.snippet ?? 'PG 18 introduces async I/O and UUIDv7',
    relevance_score: overrides.relevance_score ?? 0.9,
    markdown_content: overrides.markdown_content ?? 'PostgreSQL 18 ships asynchronous I/O for the storage manager and built-in UUIDv7 generation.',
  };
}

function makeSamplingServer(opts: { responseText?: string } = {}) {
  return {
    getClientCapabilities: vi.fn().mockReturnValue({ sampling: {} }),
    createMessage: vi.fn().mockResolvedValue({
      model: 'sampling-host-model',
      content: { type: 'text', text: opts.responseText ?? 'sampling-host-answer [1]' },
    }),
  };
}

describe('runSynthesis provider priority', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });
  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('prefers WIGOLO_LLM_PROVIDER (Gemini) over MCP sampling when both are available', async () => {
    // Same shape as research + agent: explicit env config wins over host capability.
    process.env.WIGOLO_LLM_PROVIDER = 'gemini';
    process.env.GOOGLE_API_KEY = 'test-key';

    const runLlmSpy = vi.spyOn(runLlmModule, 'runLlmText').mockResolvedValue({
      text: 'Real Gemini synthesis: PG 18 async I/O + UUIDv7 [1].',
      provider: 'gemini',
      model: 'gemini-flash',
      latencyMs: 100,
    });

    const samplingServer = makeSamplingServer({ responseText: 'sampling-host-answer [1]' });

    const r = await runSynthesis({
      query: 'PG 18 features async I/O UUIDv7',
      results: [makeResult()],
      samplingServer: samplingServer as unknown as Parameters<typeof runSynthesis>[0]['samplingServer'],
      maxTotalChars: 9000,
    });

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.answer).toContain('Real Gemini synthesis');
      expect(r.data.answer).not.toContain('sampling-host-answer');
      expect(r.data.fallback_level).toBe(1);
    }
    expect(runLlmSpy).toHaveBeenCalledTimes(1);
    expect(samplingServer.createMessage).not.toHaveBeenCalled();
  });

  it('falls back to MCP sampling when WIGOLO_LLM_PROVIDER is not configured', async () => {
    delete process.env.WIGOLO_LLM_PROVIDER;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GROQ_API_KEY;

    const samplingServer = makeSamplingServer({ responseText: 'sampling answer [1]' });

    const r = await runSynthesis({
      query: 'q',
      results: [makeResult()],
      samplingServer: samplingServer as unknown as Parameters<typeof runSynthesis>[0]['samplingServer'],
      maxTotalChars: 9000,
    });

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.answer).toContain('sampling answer');
      expect(r.data.fallback_level).toBe(1);
    }
    expect(samplingServer.createMessage).toHaveBeenCalledTimes(1);
  });

  it('falls back to MCP sampling when LLM provider call throws', async () => {
    process.env.WIGOLO_LLM_PROVIDER = 'gemini';
    process.env.GOOGLE_API_KEY = 'test-key';

    vi.spyOn(runLlmModule, 'runLlmText').mockRejectedValue(new Error('gemini upstream 503'));

    const samplingServer = makeSamplingServer({ responseText: 'sampling rescue [1]' });

    const r = await runSynthesis({
      query: 'q',
      results: [makeResult()],
      samplingServer: samplingServer as unknown as Parameters<typeof runSynthesis>[0]['samplingServer'],
      maxTotalChars: 9000,
    });

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.answer).toContain('sampling rescue');
      expect(r.data.fallback_level).toBe(1);
    }
  });
});
