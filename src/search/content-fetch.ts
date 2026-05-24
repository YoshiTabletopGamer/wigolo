import type { SearchResultItem } from '../types.js';
import type { SmartRouter } from '../fetch/router.js';
import { getExtractProvider } from '../providers/extract-provider.js';
import { cacheContent } from '../cache/store.js';
import { getEmbeddingService } from '../embedding/embed.js';
import { truncateSmartly } from './truncate.js';
import { createLogger } from '../logger.js';

const log = createLogger('search');

export interface FetchContentContext {
  contentMaxChars: number;
  maxContentChars?: number;
  maxTotalChars: number;
  fetchTimeoutMs: number;
  totalDeadline: number;
  forceRefresh: boolean;
  maxFetches?: number;
}

// Parallel fetch all URLs; then apply total-char budget in relevance (input)
// order. Mutates each SearchResultItem in place with markdown_content, or
// fetch_failed/content_truncated metadata when applicable.
export async function fetchContentForResults(
  results: SearchResultItem[],
  router: SmartRouter,
  ctx: FetchContentContext,
): Promise<void> {
  const fetchTargets = ctx.maxFetches !== undefined
    ? results.slice(0, ctx.maxFetches)
    : results;
  const fetches = fetchTargets.map(async (result): Promise<{ content?: string; error?: string }> => {
    if (Date.now() >= ctx.totalDeadline) {
      return { error: 'total_timeout' };
    }
    try {
      const raw = await Promise.race([
        router.fetch(result.url, {
          renderJs: 'auto',
          ...(ctx.forceRefresh && { force_refresh: true }),
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), ctx.fetchTimeoutMs),
        ),
      ]);
      const extractor = await getExtractProvider();
      const extraction = await extractor.extract(raw.html, raw.finalUrl, {
        maxChars: ctx.contentMaxChars,
        contentType: raw.contentType,
      });

      try {
        cacheContent(raw, extraction);
      } catch (err) {
        log.warn('failed to cache search result', { url: result.url, error: String(err) });
      }

      try {
        const embeddingService = getEmbeddingService();
        if (embeddingService.isAvailable()) {
          embeddingService.embedAsync(raw.finalUrl, extraction.markdown);
        }
      } catch (err) {
        log.debug('embedding hook skipped for search result', { error: String(err) });
      }

      const md = ctx.maxContentChars !== undefined
        ? truncateSmartly(extraction.markdown, ctx.maxContentChars)
        : extraction.markdown;
      return { content: md };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.debug('content fetch failed', { url: result.url, error: msg });
      return { error: msg };
    }
  });

  const fetched = await Promise.all(fetches);

  let totalCharsUsed = 0;
  for (let i = 0; i < fetchTargets.length; i++) {
    const result = fetchTargets[i];
    const { content, error } = fetched[i];

    if (error) {
      result.fetch_failed = error;
      continue;
    }
    if (content === undefined) continue;

    if (totalCharsUsed >= ctx.maxTotalChars) {
      result.content_truncated = true;
      continue;
    }

    let out = content;
    const remaining = ctx.maxTotalChars - totalCharsUsed;
    if (out.length > remaining) {
      out = out.slice(0, remaining);
      result.content_truncated = true;
    }

    totalCharsUsed += out.length;
    result.markdown_content = out;
  }
}
