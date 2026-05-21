import { parseHTML } from 'linkedom';
import { extractJsonLd } from '../../jsonld.js';

export interface ProductData {
  name: string;
  description?: string;
  brand?: string;
  price?: { amount: number; currency: string };
  sku?: string;
  rating?: { value: number; count: number };
  image?: string;
}

export async function extractProductSchema(html: string, _url: string): Promise<ProductData | null> {
  if (!html) return null;

  const fromJsonLd = tryJsonLd(html);
  if (fromJsonLd) return fromJsonLd;

  return tryOpenGraph(html);
}

function tryJsonLd(html: string): ProductData | null {
  let blocks: Record<string, unknown>[];
  try {
    blocks = extractJsonLd(html);
  } catch {
    return null;
  }

  const product = blocks.find((block) => typeIncludes(block['@type'], 'product'));
  if (!product) return null;

  const name = stringField(product['name']);
  if (!name) return null;

  const data: ProductData = { name };

  const description = stringField(product['description']);
  if (description) data.description = description;

  const brand = readBrand(product['brand']);
  if (brand) data.brand = brand;

  const offer = pickOffer(product['offers']);
  if (offer) {
    const amount = readNumber(offer['price']);
    const currency = stringField(offer['priceCurrency']);
    if (amount !== undefined && currency) {
      data.price = { amount, currency };
    }
  }

  const sku = stringField(product['sku']);
  if (sku) data.sku = sku;

  const rating = readRating(product['aggregateRating']);
  if (rating) data.rating = rating;

  const image = firstImage(product['image']);
  if (image) data.image = image;

  return data;
}

function tryOpenGraph(html: string): ProductData | null {
  let document: Document;
  try {
    ({ document } = parseHTML(html));
  } catch {
    return null;
  }

  const name = metaContent(document, 'meta[property="og:title"]');
  if (!name) return null;

  const data: ProductData = { name };
  const description = metaContent(document, 'meta[property="og:description"]');
  if (description) data.description = description;

  const image = metaContent(document, 'meta[property="og:image"]');
  if (image) data.image = image;

  const priceAmt = metaContent(document, 'meta[property="product:price:amount"]');
  const priceCur = metaContent(document, 'meta[property="product:price:currency"]');
  if (priceAmt && priceCur) {
    const amount = Number.parseFloat(priceAmt);
    if (Number.isFinite(amount)) {
      data.price = { amount, currency: priceCur };
    }
  }

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
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function readBrand(value: unknown): string | undefined {
  if (typeof value === 'string') return stringField(value);
  if (Array.isArray(value)) {
    for (const entry of value) {
      const name = readBrand(entry);
      if (name) return name;
    }
    return undefined;
  }
  if (value && typeof value === 'object') {
    const name = (value as Record<string, unknown>)['name'];
    return stringField(name);
  }
  return undefined;
}

function pickOffer(value: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(value)) {
    const first = value.find((entry) => entry && typeof entry === 'object');
    return first as Record<string, unknown> | undefined;
  }
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  return undefined;
}

function readRating(value: unknown): { value: number; count: number } | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const obj = value as Record<string, unknown>;
  const ratingValue = readNumber(obj['ratingValue']);
  const reviewCount = readNumber(obj['reviewCount']) ?? readNumber(obj['ratingCount']);
  if (ratingValue === undefined) return undefined;
  return { value: ratingValue, count: reviewCount ?? 0 };
}

function firstImage(value: unknown): string | undefined {
  if (typeof value === 'string') return stringField(value);
  if (Array.isArray(value)) {
    for (const entry of value) {
      const img = firstImage(entry);
      if (img) return img;
    }
    return undefined;
  }
  if (value && typeof value === 'object') {
    const url = (value as Record<string, unknown>)['url'];
    return stringField(url);
  }
  return undefined;
}
