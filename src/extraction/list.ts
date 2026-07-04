import { parseHTML } from 'linkedom';
import type { TableData } from '../types.js';

// Minimum number of structurally-parallel <li> siblings required to treat a
// list as a data grid. Below this it is a stray short list or a single record,
// not a listing — the same >=3 gate the div-grid detector uses.
const MIN_ITEMS = 3;

const MAX_CELL_LEN = 200;
const MAX_META_FIELDS = 6;

// A cell carrying a bare integer count / metric ("184", "57 comments").
// Digits with optional grouping separators; the value is captured as the typed
// numeric string so an agent/schema reads the metric as a number, not prose.
const NUMERIC_RE = /\b(\d[\d,]*)\b/;

function tag(el: Element): string {
  return el.tagName.toLowerCase();
}

// Landmark ancestors whose lists are page chrome (site nav, footer link
// columns, header menus, sidebars) — never data listings. A linked nav menu
// passes the anchor signal but is not a feed; the same guard the card detector
// uses keeps it out.
const CHROME_LANDMARKS = new Set(['nav', 'footer', 'header', 'aside']);

function inChromeLandmark(el: Element): boolean {
  let cur: Element | null = el.parentElement;
  while (cur) {
    if (CHROME_LANDMARKS.has(tag(cur))) return true;
    if ((cur.getAttribute('role') ?? '').toLowerCase() === 'navigation') return true;
    cur = cur.parentElement;
  }
  return false;
}

function textOf(el: Element | null): string {
  if (!el) return '';
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function truncate(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length <= MAX_CELL_LEN ? collapsed : collapsed.slice(0, MAX_CELL_LEN - 1) + '…';
}

// Structural fingerprint of an <li>'s direct child tags — two items from the
// same repeated listing share this, so a container with mixed one-off <li>s
// (a nav menu spliced with a promo card) is not mistaken for a uniform grid.
function childShape(li: Element): string {
  return Array.from(li.children)
    .map((c) => tag(c))
    .sort()
    .join(',');
}

// An item qualifies as a listing record when it carries a genuine data signal:
// a link (the record's target) OR a numeric metric cell. A bare "Home / About"
// nav label has neither, so a nav/prose list never becomes a table.
function hasRecordSignal(li: Element): boolean {
  const anchor = li.querySelector('a[href]');
  if (anchor && textOf(anchor).length > 0) return true;
  // A short leaf node whose text is a bare metric count.
  for (const node of li.querySelectorAll('span, div, strong, em, b, small, time')) {
    if (node.children.length > 1) continue;
    const t = textOf(node);
    if (t.length > 0 && t.length <= 40 && NUMERIC_RE.test(t)) return true;
  }
  return false;
}

// Direct <li> children of a list container (never descending into a nested
// sub-list, whose items belong to their own container pass).
function ownItems(list: Element): Element[] {
  return Array.from(list.children).filter((c) => tag(c) === 'li');
}

// Collect the metric cells of an item: short leaf-ish nodes bearing a number,
// excluding the primary anchor text. Each becomes a typed numeric field so the
// row exposes counts/points as parseable values.
function metricCells(li: Element, primaryAnchor: Element | null): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const node of li.querySelectorAll('span, div, strong, em, b, small, time')) {
    if (node.children.length > 1) continue;
    if (primaryAnchor && (node === primaryAnchor || primaryAnchor.contains(node))) continue;
    const t = textOf(node);
    if (!t || t.length > 40) continue;
    if (!NUMERIC_RE.test(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_META_FIELDS) break;
  }
  return out;
}

// Derive one row per list item: the primary anchor's text + href, plus each
// metric cell surfaced BOTH as its raw label text and as a typed numeric field
// (num_1, num_2 …) so schema/agent consumers can bind either.
function itemToRow(li: Element): Record<string, string> {
  const row: Record<string, string> = {};

  const anchor = li.querySelector('a[href]');
  if (anchor) {
    const title = textOf(anchor);
    if (title) row.title = truncate(title);
    const href = anchor.getAttribute('href') ?? '';
    if (href) row.href = truncate(href);
  }

  const metrics = metricCells(li, anchor);
  metrics.forEach((m, i) => {
    row[`meta_${i + 1}`] = truncate(m);
    const num = m.match(NUMERIC_RE);
    if (num) row[`num_${i + 1}`] = num[1].replace(/,/g, '');
  });

  // Fallback title when the item carries a metric but no anchor: use the
  // longest non-metric leaf text so the record is never anonymous.
  if (!row.title) {
    const direct = textOf(li);
    const withoutMetrics = metrics.reduce((acc, m) => acc.replace(m, ''), direct).trim();
    if (withoutMetrics) row.title = truncate(withoutMetrics);
  }

  return row;
}

// Is a list container a genuine repeated-sibling listing (>=MIN_ITEMS items
// sharing an inner shape, each carrying a record signal)? Nested-list chrome,
// short lists, and bare prose/nav lists all fail this and stay prose.
function qualifies(list: Element): Element[] | null {
  const items = ownItems(list);
  if (items.length < MIN_ITEMS) return null;

  const withSignal = items.filter(hasRecordSignal);
  // A strong majority of the items must be real records — a listing with one
  // stray decorative <li> still qualifies, a nav menu with a lone linked item
  // does not.
  if (withSignal.length < MIN_ITEMS) return null;
  if (withSignal.length / items.length < 0.6) return null;

  // Structural uniformity: the record items must share a dominant child shape,
  // so a mixed container (menu + promo) is rejected.
  const shapeCounts = new Map<string, number>();
  for (const li of withSignal) {
    const s = childShape(li);
    shapeCounts.set(s, (shapeCounts.get(s) ?? 0) + 1);
  }
  const dominant = Math.max(...shapeCounts.values());
  if (dominant < MIN_ITEMS) return null;

  return withSignal;
}

/**
 * Detect generic repeated-sibling <ol>/<ul> listings — ranked feeds, result
 * lists, leaderboards rendered as bullet/numbered lists — and emit them as
 * TableData, one row per item. Each row captures the item's anchor href and
 * any typed numeric metrics (points / comments / counts). Purely structural:
 * NO site-specific class or tag is special-cased. Bare nav/prose lists (no
 * anchors + metrics, non-uniform shape, or below the >=3 gate) yield nothing.
 */
export function detectListTables(html: string): TableData[] {
  const { document: doc } = parseHTML(html);
  return detectListTablesFromDoc(doc);
}

export function detectListTablesFromDoc(doc: Document): TableData[] {
  const out: TableData[] = [];
  const seen = new Set<Element>();

  for (const list of doc.querySelectorAll('ol, ul')) {
    if (seen.has(list)) continue;
    if (inChromeLandmark(list)) continue;
    const items = qualifies(list);
    if (!items) continue;

    // A qualifying list nested inside another qualifying list is the inner
    // record; the outer pass already covers it, so skip nested containers.
    let nested = false;
    let cur: Element | null = list.parentElement;
    while (cur) {
      if ((tag(cur) === 'ol' || tag(cur) === 'ul') && seen.has(cur)) {
        nested = true;
        break;
      }
      cur = cur.parentElement;
    }
    if (nested) continue;
    seen.add(list);

    const rows = items.map(itemToRow).filter((r) => Object.keys(r).length > 0);
    if (rows.length < MIN_ITEMS) continue;

    const headerSet = new Set<string>();
    for (const r of rows) for (const k of Object.keys(r)) headerSet.add(k);
    out.push({ headers: Array.from(headerSet), rows });
  }

  return out;
}
