import { describe, it, expect } from 'vitest';
import { extractArticle } from '../../../../../src/extraction/v1/schemas/Article.js';

const BODY = `
  <p>This is a long-form article discussing distributed systems engineering,
  the trade-offs between consistency and availability, and the historical
  development of consensus algorithms.</p>
  <p>Vector clocks, Lamport timestamps, Paxos, Raft, and ZAB each address
  ordering and agreement in different ways. This piece walks through them.</p>
  <p>The reader is expected to have a working understanding of replication.</p>
`;

function buildHtml(metas = ''): string {
  return `<!doctype html><html><head><title>Distributed Systems Primer</title>${metas}</head><body><article>${BODY}</article></body></html>`;
}

describe('extractArticle', () => {
  const url = 'https://example.com/article';

  it('returns article fields when readability succeeds', async () => {
    const html = buildHtml(
      '<meta property="article:published_time" content="2024-05-01T10:00:00Z"><meta name="author" content="Alice">',
    );
    const result = await extractArticle(html, url);
    expect(result).not.toBeNull();
    expect(result!.title.length).toBeGreaterThan(0);
    expect(result!.body.length).toBeGreaterThan(0);
    expect(result!.url).toBe(url);
    expect(result!.date).toBe('2024-05-01T10:00:00Z');
  });

  it('returns null when news extractor returns null', async () => {
    const result = await extractArticle('<html><body><p>too short</p></body></html>', url);
    expect(result).toBeNull();
  });

  it('returns null on empty input', async () => {
    const result = await extractArticle('', url);
    expect(result).toBeNull();
  });
});
