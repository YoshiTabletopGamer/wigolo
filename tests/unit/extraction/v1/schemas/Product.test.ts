import { describe, it, expect } from 'vitest';
import { extractProductSchema } from '../../../../../src/extraction/v1/schemas/Product.js';

function htmlWithJsonLd(obj: unknown): string {
  return `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify(obj)}</script></head><body></body></html>`;
}

const PRODUCT = {
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: 'Acme Widget Pro',
  description: 'Premium widget.',
  brand: { '@type': 'Brand', name: 'Acme' },
  sku: 'AWP-001',
  image: 'https://example.com/img/widget.jpg',
  offers: { '@type': 'Offer', price: '129.99', priceCurrency: 'USD' },
  aggregateRating: { '@type': 'AggregateRating', ratingValue: '4.5', reviewCount: '321' },
};

describe('extractProductSchema', () => {
  it('extracts a full Product JSON-LD block', async () => {
    const html = htmlWithJsonLd(PRODUCT);
    const result = await extractProductSchema(html, 'https://example.com/p');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('Acme Widget Pro');
    expect(result!.description).toBe('Premium widget.');
    expect(result!.brand).toBe('Acme');
    expect(result!.sku).toBe('AWP-001');
    expect(result!.image).toBe('https://example.com/img/widget.jpg');
    expect(result!.price).toEqual({ amount: 129.99, currency: 'USD' });
    expect(result!.rating).toEqual({ value: 4.5, count: 321 });
  });

  it('handles offers as an array', async () => {
    const html = htmlWithJsonLd({
      ...PRODUCT,
      offers: [
        { '@type': 'Offer', price: '49.50', priceCurrency: 'EUR' },
        { '@type': 'Offer', price: '60', priceCurrency: 'USD' },
      ],
    });
    const result = await extractProductSchema(html, 'https://example.com/p');
    expect(result!.price).toEqual({ amount: 49.5, currency: 'EUR' });
  });

  it('falls back to OG meta when no JSON-LD', async () => {
    const html = `<!doctype html><html><head>
      <meta property="og:title" content="OG Widget">
      <meta property="og:description" content="OG description">
      <meta property="og:image" content="https://example.com/og.jpg">
      <meta property="product:price:amount" content="19.99">
      <meta property="product:price:currency" content="USD">
    </head><body></body></html>`;
    const result = await extractProductSchema(html, 'https://example.com/p');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('OG Widget');
    expect(result!.price).toEqual({ amount: 19.99, currency: 'USD' });
    expect(result!.image).toBe('https://example.com/og.jpg');
  });

  it('returns null when no signals are present', async () => {
    expect(await extractProductSchema('<!doctype html><html><body></body></html>', 'https://example.com/p')).toBeNull();
  });

  it('returns null when @type is wrong and no OG', async () => {
    const html = htmlWithJsonLd({ ...PRODUCT, '@type': 'Article' });
    expect(await extractProductSchema(html, 'https://example.com/p')).toBeNull();
  });

  it('returns null on empty input', async () => {
    expect(await extractProductSchema('', 'https://example.com/p')).toBeNull();
  });
});
