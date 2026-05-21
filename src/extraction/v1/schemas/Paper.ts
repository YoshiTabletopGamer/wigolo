import { parseHTML } from 'linkedom';
import { extractJsonLd } from '../../jsonld.js';

export interface PaperData {
  title: string;
  authors: string[];
  abstract: string;
  publishedDate?: string;
  doi?: string;
  arxivId?: string;
}

const SCHOLARLY_TYPES = ['scholarlyarticle', 'article', 'creativework'];

export async function extractPaper(html: string, url: string): Promise<PaperData | null> {
  if (!html) return null;

  const fromJsonLd = tryJsonLd(html, url);
  if (fromJsonLd) return fromJsonLd;

  return tryMetaFallback(html, url);
}

function tryJsonLd(html: string, url: string): PaperData | null {
  let blocks: Record<string, unknown>[];
  try {
    blocks = extractJsonLd(html);
  } catch {
    return null;
  }

  const article = blocks.find((block) => {
    const t = block['@type'];
    if (typeof t === 'string') return SCHOLARLY_TYPES.includes(normalizeType(t));
    if (Array.isArray(t)) {
      return t.some((entry) => typeof entry === 'string' && SCHOLARLY_TYPES.includes(normalizeType(entry)));
    }
    return false;
  });
  if (!article) return null;

  const title = stringField(article['headline']) ?? stringField(article['name']);
  const abstract = stringField(article['abstract']) ?? stringField(article['description']);
  if (!title && !abstract) return null;

  const authors = readAuthors(article['author']);
  const data: PaperData = {
    title: title ?? '',
    authors,
    abstract: abstract ?? '',
  };
  const published = stringField(article['datePublished']);
  if (published) data.publishedDate = published;

  const doi = readDoi(article['identifier']) ?? readDoi(article['sameAs']);
  if (doi) data.doi = doi;

  const arxivId = extractArxivId(url);
  if (arxivId) data.arxivId = arxivId;

  return data;
}

function tryMetaFallback(html: string, url: string): PaperData | null {
  let document: Document;
  try {
    ({ document } = parseHTML(html));
  } catch {
    return null;
  }

  const title = metaContent(document, 'meta[name="citation_title"]');
  const authors = allMetaContent(document, 'meta[name="citation_author"]');
  const abstract =
    metaContent(document, 'meta[name="citation_abstract"]') ??
    metaContent(document, 'meta[name="description"]');
  const publishedDate = metaContent(document, 'meta[name="citation_publication_date"]');
  const doi = metaContent(document, 'meta[name="citation_doi"]');
  const arxivIdFromMeta = metaContent(document, 'meta[name="citation_arxiv_id"]');
  const arxivIdFromUrl = extractArxivId(url);

  let resolvedAbstract = abstract;
  let resolvedTitle = title;

  if (!resolvedTitle) {
    const h1 = document.querySelector('h1');
    const t = h1?.textContent?.trim();
    if (t) resolvedTitle = t;
  }
  if (!resolvedAbstract) {
    const absEl = document.querySelector('[class*="abstract" i] p, p[class*="abstract" i], blockquote.abstract');
    const t = absEl?.textContent?.trim();
    if (t) resolvedAbstract = t;
  }

  if (!resolvedTitle && !resolvedAbstract) return null;

  const data: PaperData = {
    title: resolvedTitle ?? '',
    authors,
    abstract: resolvedAbstract ?? '',
  };
  if (publishedDate) data.publishedDate = publishedDate;
  if (doi) data.doi = doi;
  const arxivId = arxivIdFromMeta ?? arxivIdFromUrl;
  if (arxivId) data.arxivId = arxivId;

  return data;
}

function metaContent(document: Document, selector: string): string | undefined {
  const el = document.querySelector(selector);
  const content = el?.getAttribute('content')?.trim();
  return content && content.length > 0 ? content : undefined;
}

function allMetaContent(document: Document, selector: string): string[] {
  const out: string[] = [];
  for (const el of document.querySelectorAll(selector)) {
    const content = el.getAttribute('content')?.trim();
    if (content) out.push(content);
  }
  return out;
}

function extractArxivId(url: string): string | undefined {
  if (!url) return undefined;
  const m = /arxiv\.org\/(?:abs|pdf)\/([^/?#]+)/i.exec(url);
  if (!m) return undefined;
  return m[1].replace(/\.pdf$/i, '');
}

function normalizeType(raw: string): string {
  const tail = raw.split(/[/#:]/).pop() ?? raw;
  return tail.toLowerCase();
}

function stringField(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readAuthors(value: unknown): string[] {
  if (!value) return [];
  const out: string[] = [];
  const push = (entry: unknown): void => {
    if (typeof entry === 'string') {
      const t = entry.trim();
      if (t) out.push(t);
      return;
    }
    if (entry && typeof entry === 'object') {
      const name = (entry as Record<string, unknown>)['name'];
      if (typeof name === 'string') {
        const t = name.trim();
        if (t) out.push(t);
      }
    }
  };
  if (Array.isArray(value)) {
    for (const entry of value) push(entry);
  } else {
    push(value);
  }
  return out;
}

function readDoi(value: unknown): string | undefined {
  if (typeof value === 'string' && value.toLowerCase().includes('doi')) {
    const m = /10\.\d{4,9}\/[^\s]+/.exec(value);
    if (m) return m[0];
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const doi = readDoi(entry);
      if (doi) return doi;
    }
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj['value'] === 'string') {
      const doi = readDoi(obj['value']);
      if (doi) return doi;
    }
  }
  return undefined;
}
