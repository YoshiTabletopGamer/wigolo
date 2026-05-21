import { parseHTML } from 'linkedom';

export interface CodeSnippetData {
  language?: string;
  code: string;
  filename?: string;
  description?: string;
  url: string;
}

const MIN_CODE_LENGTH = 30;

export async function extractCodeSnippet(html: string, url: string): Promise<CodeSnippetData | null> {
  if (!html) return null;

  let document: Document;
  try {
    ({ document } = parseHTML(html));
  } catch {
    return null;
  }

  const blocks = Array.from(document.querySelectorAll('pre > code, pre code'));
  if (blocks.length === 0) return null;

  let largest: Element | null = null;
  let largestLen = 0;
  for (const block of blocks) {
    const text = block.textContent ?? '';
    if (text.length > largestLen) {
      largestLen = text.length;
      largest = block;
    }
  }
  if (!largest || largestLen < MIN_CODE_LENGTH) return null;

  const code = (largest.textContent ?? '').trim();
  if (!code) return null;

  const data: CodeSnippetData = { code, url };

  const language = detectLanguage(largest);
  if (language) data.language = language;

  const pre = closestPre(largest);
  const filename = detectFilename(pre);
  if (filename) data.filename = filename;

  const description = detectDescription(pre);
  if (description) data.description = description;

  return data;
}

function detectLanguage(codeEl: Element): string | undefined {
  const fromCode = languageFromClass(codeEl.getAttribute('class'));
  if (fromCode) return fromCode;
  const pre = closestPre(codeEl);
  if (pre) {
    const fromPre = languageFromClass(pre.getAttribute('class'));
    if (fromPre) return fromPre;
  }
  return undefined;
}

function languageFromClass(cls: string | null | undefined): string | undefined {
  if (!cls) return undefined;
  for (const token of cls.split(/\s+/)) {
    const m = /^(?:language|lang|hljs|highlight)-(.+)$/.exec(token);
    if (m) return m[1];
  }
  return undefined;
}

function closestPre(el: Element): Element | null {
  let current: Element | null = el;
  while (current) {
    if (current.tagName === 'PRE') return current;
    current = current.parentElement;
  }
  return null;
}

function detectFilename(pre: Element | null): string | undefined {
  if (!pre) return undefined;
  const figcaption =
    pre.parentElement?.querySelector('figcaption') ?? pre.previousElementSibling;
  if (figcaption && figcaption.tagName === 'FIGCAPTION') {
    const text = (figcaption.textContent ?? '').trim();
    if (text) return text;
  }
  const header = pre.parentElement?.querySelector('header, .filename, div.filename');
  if (header) {
    const text = (header.textContent ?? '').trim();
    if (text) return text;
  }
  return undefined;
}

function detectDescription(pre: Element | null): string | undefined {
  if (!pre) return undefined;
  let sib = pre.previousElementSibling;
  // skip over figcaption/header used for filename
  while (sib && (sib.tagName === 'FIGCAPTION' || sib.tagName === 'HEADER')) {
    sib = sib.previousElementSibling;
  }
  if (sib && sib.tagName === 'P') {
    const text = (sib.textContent ?? '').trim();
    if (text) return text.slice(0, 300);
  }
  return undefined;
}
