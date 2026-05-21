import { parseHTML } from 'linkedom';
import { extractJsonLd } from '../../jsonld.js';

export interface EventListingData {
  name: string;
  startDate: string;
  endDate?: string;
  location?: string;
  description?: string;
  url: string;
}

export async function extractEventListing(html: string, url: string): Promise<EventListingData | null> {
  if (!html) return null;

  const fromJsonLd = tryJsonLd(html, url);
  if (fromJsonLd) return fromJsonLd;

  return tryMetaFallback(html, url);
}

function tryJsonLd(html: string, url: string): EventListingData | null {
  let blocks: Record<string, unknown>[];
  try {
    blocks = extractJsonLd(html);
  } catch {
    return null;
  }

  const ev = blocks.find((block) => typeIncludes(block['@type'], 'event'));
  if (!ev) return null;

  const name = stringField(ev['name']);
  const startDate = stringField(ev['startDate']);
  if (!name && !startDate) return null;

  const data: EventListingData = {
    name: name ?? '',
    startDate: startDate ?? '',
    url,
  };
  const endDate = stringField(ev['endDate']);
  if (endDate) data.endDate = endDate;
  const description = stringField(ev['description']);
  if (description) data.description = description;
  const location = readLocation(ev['location']);
  if (location) data.location = location;
  return data;
}

function tryMetaFallback(html: string, url: string): EventListingData | null {
  let document: Document;
  try {
    ({ document } = parseHTML(html));
  } catch {
    return null;
  }

  const startMeta = metaContent(document, 'meta[property="event:start_time"]');
  const endMeta = metaContent(document, 'meta[property="event:end_time"]');
  const locationMeta = metaContent(document, 'meta[property="event:location"]');
  const description = metaContent(document, 'meta[property="og:description"]');

  let start = startMeta;
  if (!start) {
    const timeEl = document.querySelector('time[itemprop="startDate"]');
    const dt = timeEl?.getAttribute('datetime')?.trim();
    if (dt) start = dt;
  }

  let name: string | undefined;
  const h1 = document.querySelector('h1');
  const h1Text = h1?.textContent?.trim();
  if (h1Text) name = h1Text;
  if (!name) {
    name = metaContent(document, 'meta[property="og:title"]');
  }

  if (!name && !start) return null;

  const data: EventListingData = {
    name: name ?? '',
    startDate: start ?? '',
    url,
  };
  if (endMeta) data.endDate = endMeta;
  if (locationMeta) data.location = locationMeta;
  if (description) data.description = description;
  return data;
}

function metaContent(document: Document, selector: string): string | undefined {
  const el = document.querySelector(selector);
  const content = el?.getAttribute('content')?.trim();
  return content && content.length > 0 ? content : undefined;
}

function typeIncludes(raw: unknown, want: string): boolean {
  const target = want.toLowerCase();
  if (typeof raw === 'string') return normalizeType(raw) === target;
  if (Array.isArray(raw)) {
    return raw.some((entry) => typeof entry === 'string' && normalizeType(entry) === target);
  }
  return false;
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

function readLocation(value: unknown): string | undefined {
  if (typeof value === 'string') return stringField(value);
  if (Array.isArray(value)) {
    for (const entry of value) {
      const loc = readLocation(entry);
      if (loc) return loc;
    }
    return undefined;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const name = stringField(obj['name']);
    if (name) return name;
    const address = obj['address'];
    if (typeof address === 'string') return stringField(address);
    if (address && typeof address === 'object') {
      const aobj = address as Record<string, unknown>;
      const parts = [
        stringField(aobj['streetAddress']),
        stringField(aobj['addressLocality']),
        stringField(aobj['addressRegion']),
        stringField(aobj['addressCountry']),
      ].filter((s): s is string => Boolean(s));
      if (parts.length > 0) return parts.join(', ');
    }
  }
  return undefined;
}
