import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractStructured } from '../../../src/extraction/structured.js';
import { detectDivGridTables } from '../../../src/extraction/div-grid.js';

// A 3-card flex/div pricing grid — the single biggest Extract miss. Cards use
// <div>, not <table>, so extractTables returns []. The detector recognises
// >=3 structurally-parallel siblings and emits one TableData.
const THREE_CARD_GRID = `
  <html><body>
    <section class="pricing">
      <h2>Plans</h2>
      <div class="tiers">
        <div class="plan">
          <h3>Starter</h3>
          <span class="price">$9</span>
          <ul><li>10 seats</li><li>1 project</li></ul>
        </div>
        <div class="plan">
          <h3>Pro</h3>
          <span class="price">$29</span>
          <ul><li>50 seats</li><li>10 projects</li></ul>
        </div>
        <div class="plan">
          <h3>Enterprise</h3>
          <span class="price">$99</span>
          <ul><li>Unlimited seats</li><li>Unlimited projects</li></ul>
        </div>
      </div>
    </section>
  </body></html>
`;

describe('extractStructured', () => {
  it('returns tables alongside other structured data', () => {
    const html = `
      <html><body>
        <table>
          <thead><tr><th>Name</th><th>Price</th></tr></thead>
          <tbody><tr><td>Widget</td><td>$10</td></tr></tbody>
        </table>
      </body></html>
    `;
    const out = extractStructured(html);
    expect(out.tables).toHaveLength(1);
    expect(out.tables[0].rows[0]).toEqual({ Name: 'Widget', Price: '$10' });
  });

  it('extracts definition-list term/description pairs', () => {
    const html = `
      <html><body>
        <dl>
          <dt>HTTP</dt><dd>HyperText Transfer Protocol</dd>
          <dt>TLS</dt><dd>Transport Layer Security</dd>
        </dl>
      </body></html>
    `;
    const out = extractStructured(html);
    expect(out.definitions).toHaveLength(2);
    expect(out.definitions[0]).toEqual({ term: 'HTTP', description: 'HyperText Transfer Protocol' });
    expect(out.definitions[1].term).toBe('TLS');
  });

  it('joins multiple <dd> for a single <dt>', () => {
    const html = `
      <dl>
        <dt>Term</dt>
        <dd>First meaning</dd>
        <dd>Second meaning</dd>
      </dl>
    `;
    const out = extractStructured(html);
    expect(out.definitions).toHaveLength(1);
    expect(out.definitions[0].description).toContain('First meaning');
    expect(out.definitions[0].description).toContain('Second meaning');
  });

  it('extracts SVG chart hints from title, aria-label, figcaption', () => {
    const html = `
      <html><body>
        <figure>
          <svg aria-label="Revenue by quarter bar chart">
            <title>Quarterly Revenue 2024</title>
          </svg>
          <figcaption>Revenue trended up in Q4</figcaption>
        </figure>
      </body></html>
    `;
    const out = extractStructured(html);
    expect(out.chart_hints).toHaveLength(1);
    const hint = out.chart_hints[0];
    expect(hint.title).toBe('Quarterly Revenue 2024');
    expect(hint.aria_label).toContain('Revenue by quarter');
    expect(hint.figcaption).toContain('Revenue trended');
    expect(hint.type_hint).toBe('chart');
  });

  it('falls back to figure+figcaption when no SVG is present', () => {
    const html = `
      <figure>
        <img src="/chart.png" />
        <figcaption>System architecture diagram overview</figcaption>
      </figure>
    `;
    const out = extractStructured(html);
    expect(out.chart_hints).toHaveLength(1);
    expect(out.chart_hints[0].figcaption).toContain('architecture diagram');
    expect(out.chart_hints[0].type_hint).toBe('diagram');
  });

  it('infers type_hint as graph for network/tree terms', () => {
    const html = `<svg aria-label="Dependency graph visualization"><title>Deps</title></svg>`;
    const out = extractStructured(html);
    expect(out.chart_hints[0].type_hint).toBe('graph');
  });

  it('drops SVGs without any accessible label', () => {
    const html = `<svg><rect /></svg>`;
    const out = extractStructured(html);
    expect(out.chart_hints).toEqual([]);
  });

  it('extracts microdata itemprop key-value pairs', () => {
    const html = `
      <div itemscope itemtype="https://schema.org/Product">
        <span itemprop="name">Thingamajig</span>
        <meta itemprop="sku" content="TH-1234" />
      </div>
    `;
    const out = extractStructured(html);
    const microdata = out.key_value_pairs.filter((p) => p.source === 'microdata');
    expect(microdata.some((p) => p.key === 'name' && p.value === 'Thingamajig')).toBe(true);
    expect(microdata.some((p) => p.key === 'sku' && p.value === 'TH-1234')).toBe(true);
  });

  it('extracts data-label/data-value attribute pairs', () => {
    const html = `
      <div class="row" data-label="RAM" data-value="16 GB"></div>
      <div class="row" data-label="Storage" data-value="512 GB SSD"></div>
    `;
    const out = extractStructured(html);
    const attrs = out.key_value_pairs.filter((p) => p.source === 'data-attr');
    expect(attrs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'RAM', value: '16 GB' }),
        expect.objectContaining({ key: 'Storage', value: '512 GB SSD' }),
      ]),
    );
  });

  it('extracts comparison grid pairs from label/value classes', () => {
    const html = `
      <div class="spec-row">
        <div class="spec-label">Weight</div>
        <div class="spec-value">2.5 kg</div>
      </div>
    `;
    const out = extractStructured(html);
    const grid = out.key_value_pairs.filter((p) => p.source === 'comparison-grid');
    expect(grid.some((p) => p.key === 'Weight' && p.value === '2.5 kg')).toBe(true);
  });

  it('extracts "Key: Value" text patterns from list items', () => {
    const html = `
      <ul>
        <li>Status: Active</li>
        <li>Owner: platform-team</li>
        <li>Not a key-value sentence at all just prose text here.</li>
      </ul>
    `;
    const out = extractStructured(html);
    const text = out.key_value_pairs.filter((p) => p.source === 'text-pattern');
    expect(text.some((p) => p.key === 'Status' && p.value === 'Active')).toBe(true);
    expect(text.some((p) => p.key === 'Owner' && p.value === 'platform-team')).toBe(true);
  });

  it('picks up JSON-LD blocks through to the output', () => {
    const html = `
      <script type="application/ld+json">
      { "@context":"https://schema.org", "@type":"Article", "headline":"Hello" }
      </script>
    `;
    const out = extractStructured(html);
    expect(out.jsonld).toHaveLength(1);
    expect(out.jsonld[0]).toMatchObject({ '@type': 'Article', headline: 'Hello' });
  });

  it('dedupes identical key-value pairs', () => {
    const html = `
      <div itemscope>
        <span itemprop="name">Widget</span>
        <span itemprop="name">Widget</span>
      </div>
    `;
    const out = extractStructured(html);
    const names = out.key_value_pairs.filter((p) => p.key === 'name');
    expect(names).toHaveLength(1);
  });

  it('truncates extremely long values', () => {
    const html = `<dl><dt>X</dt><dd>${'y'.repeat(1000)}</dd></dl>`;
    const out = extractStructured(html);
    expect(out.definitions[0].description.length).toBeLessThanOrEqual(400);
    expect(out.definitions[0].description.endsWith('…')).toBe(true);
  });

  it('returns empty arrays for empty HTML', () => {
    const out = extractStructured('<html><body></body></html>');
    expect(out.tables).toEqual([]);
    expect(out.definitions).toEqual([]);
    expect(out.jsonld).toEqual([]);
    expect(out.chart_hints).toEqual([]);
    expect(out.key_value_pairs).toEqual([]);
  });

  it('surfaces a div/flex pricing grid in .tables while other structures are unaffected', () => {
    const out = extractStructured(THREE_CARD_GRID);
    // The grid must appear as a table.
    expect(out.tables.length).toBeGreaterThanOrEqual(1);
    const grid = out.tables.find((t) => t.rows.length === 3);
    expect(grid).toBeDefined();
    // definitions/chart_hints/jsonld unchanged (no dl/svg/jsonld on the page).
    expect(out.definitions).toEqual([]);
    expect(out.chart_hints).toEqual([]);
    expect(out.jsonld).toEqual([]);
  });
});

// WHY: div/flex pricing grids are the single biggest Extract miss — a page
// with 3-4 pricing cards in <div>s currently returns tables=[] and the agent
// gets nothing structured. The GATE is >=3 structurally-parallel repeated
// siblings; a [class*=price] token is only a ranking HINT — never sufficient
// alone, or single-product pages would manufacture phantom tables.
describe('detectDivGridTables', () => {
  it('emits exactly one table with one row per card for a 3-card grid', () => {
    const tables = detectDivGridTables(THREE_CARD_GRID);
    expect(tables).toHaveLength(1);
    expect(tables[0].rows).toHaveLength(3);
    // Row segmentation: each card's tier name and its price are co-located in
    // the SAME row (proves per-card grouping, not a flat dump).
    const first = tables[0].rows[0];
    const flat = Object.values(first).join(' ');
    expect(flat).toContain('Starter');
    expect(flat).toContain('$9');
    const last = tables[0].rows[2];
    const flatLast = Object.values(last).join(' ');
    expect(flatLast).toContain('Enterprise');
    expect(flatLast).toContain('$99');
  });

  it('LOAD-BEARING NEGATIVE: a single product block yields ZERO div-grid tables', () => {
    // product-page.html has one class="price", one class="product-rating",
    // one class="feature" — the >=3-sibling gate MUST reject it. If a future
    // change drops that gate (making a [class*=price] token sufficient), this
    // fails immediately.
    const productHtml = readFileSync(
      join(import.meta.dirname, '../../fixtures/extraction/product-page.html'),
      'utf-8',
    );
    const tables = detectDivGridTables(productHtml);
    expect(tables).toEqual([]);
  });

  it('a 2-card grid yields ZERO tables (below the >=3 repetition gate)', () => {
    const twoCard = `
      <div class="tiers">
        <div class="plan"><h3>Free</h3><span class="price">$0</span></div>
        <div class="plan"><h3>Paid</h3><span class="price">$5</span></div>
      </div>
    `;
    expect(detectDivGridTables(twoCard)).toEqual([]);
  });

  it('does not fire on 3 unrelated non-parallel siblings without a card shape', () => {
    // Three <div> siblings that are NOT structurally parallel (different tags/
    // shapes, no repeated price/name pattern) must not be treated as a grid.
    const notAGrid = `
      <div class="container">
        <div class="header">Welcome</div>
        <p>Some prose paragraph describing the product in detail.</p>
        <footer>Copyright 2026</footer>
      </div>
    `;
    expect(detectDivGridTables(notAGrid)).toEqual([]);
  });

  it('does not fire on repeated heading+prose blocks (doc sections / SERP results)', () => {
    // 4 parallel <section> siblings each with a heading but NO price and NO
    // feature list — this is documentation/search-result content, not a
    // pricing grid. Emitting it as a table was the primary overfit trap:
    // requiring price OR (heading AND feature-list) is the guard.
    const docSections = `
      <div class="content">
        <section><h2>Try it</h2><p>Some example prose here.</p></section>
        <section><h2>Syntax</h2><p>More prose describing syntax.</p></section>
        <section><h2>Parameters</h2><p>Even more descriptive prose.</p></section>
        <section><h2>Return value</h2><p>Prose about the return value.</p></section>
      </div>
    `;
    expect(detectDivGridTables(docSections)).toEqual([]);

    const serp = `
      <div class="results">
        <li class="result"><h2><a href="/a">Result One</a></h2></li>
        <li class="result"><h2><a href="/b">Result Two</a></h2></li>
        <li class="result"><h2><a href="/c">Result Three</a></h2></li>
      </div>
    `;
    expect(detectDivGridTables(serp)).toEqual([]);
  });

  it('fires on a numeric spec/comparison card grid without an explicit price', () => {
    // Comparison cards that name a model and list numeric specs (>=2 cells
    // bearing digits/currency) are a real DATA grid — heading + numeric cells
    // qualifies even with no [class*=price] element.
    const specGrid = `
      <div class="specs">
        <div class="card"><h3>Model A</h3><ul><li>16 GB RAM</li><li>512 GB SSD</li></ul></div>
        <div class="card"><h3>Model B</h3><ul><li>32 GB RAM</li><li>1024 GB SSD</li></ul></div>
        <div class="card"><h3>Model C</h3><ul><li>64 GB RAM</li><li>2048 GB SSD</li></ul></div>
      </div>
    `;
    const tables = detectDivGridTables(specGrid);
    expect(tables).toHaveLength(1);
    expect(tables[0].rows).toHaveLength(3);
    expect(tables[0].rows[0].name).toBe('Model A');
  });

  it('does NOT fire on footer link columns (heading + list, but chrome + no data)', () => {
    // The primary over-detection: footer navigation columns are heading + <li>
    // link lists with zero numeric/currency cells, inside a <footer> landmark.
    // They must yield ZERO grid tables — both the chrome-landmark guard and
    // the data-ness requirement reject them.
    const footer = `
      <footer>
        <div class="link-cols">
          <div class="col"><h3>Product</h3><ul><li>Pricing</li><li>Docs</li><li>API</li></ul></div>
          <div class="col"><h3>Company</h3><ul><li>About</li><li>Blog</li><li>Careers</li></ul></div>
          <div class="col"><h3>Resources</h3><ul><li>Guides</li><li>Support</li><li>Status</li></ul></div>
        </div>
      </footer>
    `;
    expect(detectDivGridTables(footer)).toEqual([]);
  });

  it('does NOT fire on a blog-post grid (heading + prose, no data cells)', () => {
    // Repeated <article> cards with a heading and non-numeric text are content,
    // not a data grid — zero numeric/currency cells ⇒ ZERO tables.
    const blog = `
      <div class="posts">
        <article class="post"><h2>First Post</h2><ul><li>tag: javascript</li></ul></article>
        <article class="post"><h2>Second Post</h2><ul><li>tag: typescript</li></ul></article>
        <article class="post"><h2>Third Post</h2><ul><li>tag: golang</li></ul></article>
      </div>
    `;
    expect(detectDivGridTables(blog)).toEqual([]);
  });
});
