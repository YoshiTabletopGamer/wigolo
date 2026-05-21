import { describe, it, expect } from 'vitest';
import { extractPaper } from '../../../../../src/extraction/v1/schemas/Paper.js';

function htmlWithJsonLd(obj: unknown): string {
  return `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify(obj)}</script></head><body></body></html>`;
}

describe('extractPaper — JSON-LD path', () => {
  it('extracts a ScholarlyArticle', async () => {
    const html = htmlWithJsonLd({
      '@context': 'https://schema.org',
      '@type': 'ScholarlyArticle',
      headline: 'A Study of Distributed Consensus',
      author: [
        { '@type': 'Person', name: 'Alice' },
        { '@type': 'Person', name: 'Bob' },
      ],
      abstract: 'We study consensus.',
      datePublished: '2024-03-01',
      identifier: 'doi:10.1234/abcd.5678',
    });
    const result = await extractPaper(html, 'https://journal.example.com/p');
    expect(result).not.toBeNull();
    expect(result!.title).toBe('A Study of Distributed Consensus');
    expect(result!.authors).toEqual(['Alice', 'Bob']);
    expect(result!.abstract).toBe('We study consensus.');
    expect(result!.publishedDate).toBe('2024-03-01');
    expect(result!.doi).toBe('10.1234/abcd.5678');
  });
});

describe('extractPaper — meta fallback', () => {
  it('extracts citation_* meta tags', async () => {
    const html = `<!doctype html><html><head>
      <meta name="citation_title" content="Meta Paper">
      <meta name="citation_author" content="Carol">
      <meta name="citation_author" content="Dan">
      <meta name="citation_abstract" content="Abstract content.">
      <meta name="citation_publication_date" content="2023-01-02">
      <meta name="citation_doi" content="10.5555/zz.1">
      <meta name="citation_arxiv_id" content="2301.00001">
    </head><body></body></html>`;
    const result = await extractPaper(html, 'https://example.com/x');
    expect(result).not.toBeNull();
    expect(result!.title).toBe('Meta Paper');
    expect(result!.authors).toEqual(['Carol', 'Dan']);
    expect(result!.abstract).toBe('Abstract content.');
    expect(result!.publishedDate).toBe('2023-01-02');
    expect(result!.doi).toBe('10.5555/zz.1');
    expect(result!.arxivId).toBe('2301.00001');
  });

  it('detects arxiv id from URL', async () => {
    const html = `<!doctype html><html><head>
      <meta name="citation_title" content="From arxiv">
    </head><body></body></html>`;
    const result = await extractPaper(html, 'https://arxiv.org/abs/2401.12345');
    expect(result!.arxivId).toBe('2401.12345');
  });

  it('falls back to h1 + abstract block when no meta', async () => {
    const html = `<!doctype html><html><body>
      <h1>DOM Fallback Title</h1>
      <p class="abstract">DOM-derived abstract goes here and is sufficiently long.</p>
    </body></html>`;
    const result = await extractPaper(html, 'https://example.com/p');
    expect(result).not.toBeNull();
    expect(result!.title).toBe('DOM Fallback Title');
    expect(result!.abstract).toContain('DOM-derived abstract');
  });

  it('returns null when both title and abstract are missing', async () => {
    expect(await extractPaper('<!doctype html><html><body></body></html>', 'https://e.com')).toBeNull();
  });

  it('returns null on empty input', async () => {
    expect(await extractPaper('', 'https://e.com')).toBeNull();
  });
});
