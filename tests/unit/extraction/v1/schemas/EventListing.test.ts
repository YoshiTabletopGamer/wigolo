import { describe, it, expect } from 'vitest';
import { extractEventListing } from '../../../../../src/extraction/v1/schemas/EventListing.js';

function htmlWithJsonLd(obj: unknown): string {
  return `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify(obj)}</script></head><body></body></html>`;
}

describe('extractEventListing — JSON-LD path', () => {
  it('extracts an Event with nested location', async () => {
    const html = htmlWithJsonLd({
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: 'TechConf 2025',
      startDate: '2025-09-12T09:00:00-07:00',
      endDate: '2025-09-14T17:00:00-07:00',
      description: 'Annual tech conference.',
      location: {
        '@type': 'Place',
        name: 'Convention Center',
        address: {
          '@type': 'PostalAddress',
          streetAddress: '123 Main',
          addressLocality: 'San Francisco',
          addressRegion: 'CA',
          addressCountry: 'US',
        },
      },
    });
    const result = await extractEventListing(html, 'https://example.com/e');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('TechConf 2025');
    expect(result!.startDate).toBe('2025-09-12T09:00:00-07:00');
    expect(result!.endDate).toBe('2025-09-14T17:00:00-07:00');
    expect(result!.location).toBe('Convention Center');
    expect(result!.description).toBe('Annual tech conference.');
    expect(result!.url).toBe('https://example.com/e');
  });
});

describe('extractEventListing — meta fallback', () => {
  it('uses event:* meta + h1 for name', async () => {
    const html = `<!doctype html><html><head>
      <meta property="event:start_time" content="2025-09-12">
      <meta property="event:end_time" content="2025-09-14">
      <meta property="event:location" content="SF Convention Center">
      <meta property="og:description" content="Annual gathering">
    </head><body><h1>TechConf 2025</h1></body></html>`;
    const result = await extractEventListing(html, 'https://example.com/e');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('TechConf 2025');
    expect(result!.startDate).toBe('2025-09-12');
    expect(result!.endDate).toBe('2025-09-14');
    expect(result!.location).toBe('SF Convention Center');
  });

  it('uses time[itemprop="startDate"] when no meta', async () => {
    const html = `<!doctype html><html><body>
      <h1>Meetup</h1>
      <time itemprop="startDate" datetime="2025-10-01T18:00:00Z">Oct 1</time>
    </body></html>`;
    const result = await extractEventListing(html, 'https://example.com/e');
    expect(result!.startDate).toBe('2025-10-01T18:00:00Z');
  });

  it('returns null when name and startDate are both missing', async () => {
    expect(await extractEventListing('<!doctype html><html><body></body></html>', 'https://e.com')).toBeNull();
  });

  it('returns null on empty input', async () => {
    expect(await extractEventListing('', 'https://e.com')).toBeNull();
  });
});
