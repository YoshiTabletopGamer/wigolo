import { parseHTML } from 'linkedom';
import type { TableData } from '../types.js';

// Re-export the canonical metadata extractor so legacy callers keep working.
// fetch (via pipeline.mergeMetadata) and extract mode=metadata both reach the
// same implementation now; see src/extraction/metadata.ts.
export { extractMetadata } from './metadata.js';

export function extractSelector(
  html: string,
  selector: string,
  multiple: boolean,
): string | string[] {
  const { document: doc } = parseHTML(html);

  if (multiple) {
    const elements = doc.querySelectorAll(selector);
    return Array.from(elements).map((el) => (el.textContent ?? '').trim());
  }

  const el = doc.querySelector(selector);
  return el ? (el.textContent ?? '').trim() : '';
}

// Class / role tokens that mark a table as Wikipedia chrome rather than
// content. Extracting tables on Wikipedia used to return the navbox cells
// ("Cite this page | Wikidata item") instead of the real article tables —
// these patterns are page navigation / metadata, not data.
const WIKIPEDIA_CHROME_CLASS_TOKENS = [
  'navbox',
  'infobox',
  'infobox-data-row-only',
  'sidebar',
  'metadata',
  'sistersitebox',
  'mw-collapsible',
];

function isWikipediaChromeTable(table: Element): boolean {
  const role = table.getAttribute('role')?.toLowerCase() ?? '';
  if (role === 'navigation' || role === 'presentation') return true;
  const className = table.getAttribute('class')?.toLowerCase() ?? '';
  if (!className) return false;
  const classes = className.split(/\s+/).filter(Boolean);
  return classes.some((cls) => WIKIPEDIA_CHROME_CLASS_TOKENS.includes(cls));
}

// A cell/row from a run-on single-column layout table longer than this is
// treated as prose, not data — the signal that the <table> is being used for
// page layout rather than to carry a real grid.
const RUN_ON_CELL_LEN = 120;

// True when `descendant` sits inside a table nested below `table` (i.e. the
// nearest enclosing <table> is not `table` itself). linkedom's
// querySelectorAll descends through nested tables, so we filter its output to
// the cells/rows that actually belong to the table we are mapping.
function belongsToNestedTable(descendant: Element, table: Element): boolean {
  let cur: Element | null = descendant.parentElement;
  while (cur && cur !== table) {
    if (cur.tagName.toLowerCase() === 'table') return true;
    cur = cur.parentElement;
  }
  return false;
}

function ownRows(table: Element): Element[] {
  return Array.from(table.querySelectorAll('tr')).filter(
    (tr) => !belongsToNestedTable(tr, table),
  );
}

function ownHeaderCells(table: Element, selector: string): Element[] {
  return Array.from(table.querySelectorAll(selector)).filter(
    (el) => !belongsToNestedTable(el, table),
  );
}

// Direct td/th children of a row — never descends into a cell's nested table.
function directCells(row: Element): Element[] {
  return Array.from(row.children).filter((c) => {
    const tag = c.tagName.toLowerCase();
    return tag === 'td' || tag === 'th';
  });
}

// A row whose only meaningful content is a nested <table> is a layout wrapper:
// the nested table is extracted on its own pass, so the parent must not
// re-emit the nested table's flattened text as a run-on cell.
function rowOnlyWrapsTable(row: Element): boolean {
  const cells = directCells(row);
  if (cells.length === 0) return false;
  const cellWithTable = cells.filter((c) => c.querySelector('table'));
  if (cellWithTable.length === 0) return false;
  // Text outside the nested table(s) must be negligible for this to count as
  // pure layout wrapping.
  for (const cell of cellWithTable) {
    const inner = Array.from(cell.querySelectorAll('table'));
    let innerText = '';
    for (const t of inner) innerText += t.textContent ?? '';
    const cellText = (cell.textContent ?? '').replace(/\s+/g, ' ').trim();
    const outsideLen = cellText.length - innerText.replace(/\s+/g, ' ').trim().length;
    if (outsideLen > RUN_ON_CELL_LEN) return false;
  }
  return true;
}

// A single-column layout table (headers === ['col_1']) whose rows are long
// run-on blobs is a layout table, not data. Salvage it as list-style rows so
// callers still see the content, capped to a sane length, and never as a
// header-less run-on blob table.
function salvageDegenerate(bodyRows: Element[]): TableData | null {
  const items: Record<string, string>[] = [];
  for (const row of bodyRows) {
    const text = (row.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (text.length > RUN_ON_CELL_LEN) continue; // drop run-on prose blobs
    items.push({ item: text });
  }
  if (items.length === 0) return null;
  return { headers: ['item'], rows: items };
}

export function extractTables(html: string): TableData[] {
  const { document: doc } = parseHTML(html);
  const allTables = Array.from(doc.querySelectorAll('table'));
  if (allTables.length === 0) return [];
  // Skip chrome tables (navbox / infobox / role=navigation) so callers get
  // real data tables only — H6.
  const tables = allTables.filter((t) => !isWikipediaChromeTable(t));
  if (tables.length === 0) return [];

  const out: TableData[] = [];
  for (const table of tables) {
    const caption = table.querySelector('caption')?.textContent?.trim() || undefined;

    // Header + row selection is scoped to THIS table's own cells; a nested
    // <table> inside a <td> must not lend its headers/rows to the parent.
    const thElements = ownHeaderCells(table, 'thead th');
    let headers: string[];
    let bodyRows: Element[];

    if (thElements.length > 0) {
      headers = thElements.map((th) => (th.textContent ?? '').trim());
      bodyRows = ownRows(table).filter((tr) => {
        // exclude the thead rows we already consumed as headers
        let cur: Element | null = tr.parentElement;
        while (cur && cur !== table) {
          if (cur.tagName.toLowerCase() === 'thead') return false;
          cur = cur.parentElement;
        }
        return true;
      });
      if (bodyRows.length === 0) {
        bodyRows = ownRows(table).slice(1);
      }
    } else {
      const allRows = ownRows(table);
      const firstRow = allRows[0];
      const firstRowThs = firstRow ? directCells(firstRow).filter((c) => c.tagName.toLowerCase() === 'th') : [];

      if (firstRowThs.length > 0) {
        headers = firstRowThs.map((th) => (th.textContent ?? '').trim());
        bodyRows = allRows.slice(1);
      } else {
        const cellCount = firstRow ? directCells(firstRow).length : 0;
        headers = Array.from({ length: cellCount }, (_, i) => `col_${i + 1}`);
        bodyRows = allRows;
      }
    }

    // Drop rows that exist only to wrap a nested <table>; the nested table is
    // surfaced on its own pass, so keeping the wrapper would duplicate it as a
    // flattened run-on cell.
    bodyRows = bodyRows.filter((row) => !rowOnlyWrapsTable(row));
    if (bodyRows.length === 0) continue;

    // Degenerate single-column layout table: a table that yields only one
    // column of long run-on cells is a layout wrapper, not a data grid.
    // Emitting it as { col_1: <whole cell text> } gives an agent a useless
    // blob. Salvage as list rows (or skip) instead.
    if (headers.length <= 1) {
      const runOn = bodyRows.some((row) => {
        const cells = directCells(row);
        const text = (cells[0]?.textContent ?? row.textContent ?? '').replace(/\s+/g, ' ').trim();
        return cells.length <= 1 && text.length > RUN_ON_CELL_LEN;
      });
      if (runOn) {
        const salvaged = salvageDegenerate(bodyRows);
        if (salvaged) {
          salvaged.caption = caption;
          out.push(salvaged);
        }
        continue;
      }
    }

    const rows = bodyRows.map((row) => {
      const cells = directCells(row);
      const obj: Record<string, string> = {};
      headers.forEach((header, i) => {
        obj[header] = (cells[i]?.textContent ?? '').trim();
      });
      return obj;
    });

    // A row that produced zero populated cells contributes nothing (this is
    // the parent layout table wrapping a nested data table). Drop such
    // header-only tables so the nested table is not duplicated.
    if (rows.length === 0 || rows.every((r) => Object.values(r).every((v) => v === ''))) {
      continue;
    }

    out.push({ caption, headers, rows });
  }
  return out;
}
