import { describe, it, expect } from 'vitest';
import type { ResearchBrief, ResearchSource } from '../../../src/types.js';
import { renderBriefReport } from '../../../src/research/render-brief.js';

function mkSource(overrides: Partial<ResearchSource> = {}): ResearchSource {
  return {
    url: 'https://example.com/1',
    title: 'Example Source One',
    markdown_content: 'content',
    relevance_score: 0.9,
    fetched: true,
    ...overrides,
  };
}

function mkBrief(overrides: Partial<ResearchBrief> = {}): ResearchBrief {
  return {
    topics: ['topic a'],
    highlights: [],
    key_findings: ['Finding one about the topic.', 'Finding two with more detail.'],
    per_source_char_cap: 3000,
    total_sources_char_cap: 40000,
    sections: {
      overview: {
        key_findings: ['Finding one about the topic.'],
        cross_references: [],
      },
      gaps: [],
    },
    query_type: 'general',
    ...overrides,
  };
}

describe('renderBriefReport', () => {
  // WHY: the report title must echo the question so the reader sees what was
  // researched, and it must be a markdown document (the report tool contract).
  it('emits a markdown heading with the question', () => {
    const md = renderBriefReport('How do RSC work', mkBrief(), [mkSource()]);
    expect(md).toContain('## How do RSC work — Research Brief');
  });

  // WHY: a comparison with source-quoted tradeoffs is the parity lever — the
  // verdict must be evidence-backed with [n] citations, never an invented
  // directional claim. The heading signals the quotes come FROM sources.
  it('renders a source-cited Verdict section when comparison tradeoffs exist', () => {
    const brief = mkBrief({
      query_type: 'comparison',
      sections: {
        overview: { key_findings: ['kf'], cross_references: [] },
        comparison: {
          entities: ['SQLite FTS5', 'vector DB'],
          comparison_points: ['faster', 'simpler'],
          tradeoffs: [
            { text: 'SQLite FTS5 is simpler to operate than a dedicated vector DB.', source_index: 0, term: 'simpler' },
            { text: 'A dedicated vector DB is faster for high-dimensional similarity search.', source_index: 1, term: 'faster' },
          ],
        },
        gaps: [],
      },
    });
    const sources = [
      mkSource({ url: 'https://a.com', title: 'FTS5 guide' }),
      mkSource({ url: 'https://b.com', title: 'Vector DB guide' }),
    ];
    const md = renderBriefReport('SQLite FTS5 vs vector DB', brief, sources);
    expect(md).toContain('Verdict (from sources)');
    expect(md).toContain('SQLite FTS5 is simpler to operate');
    // tradeoff[0] from source_index 0 -> citation [1]; tradeoff[1] -> [2].
    expect(md).toMatch(/SQLite FTS5 is simpler to operate[^\n]*\[1\]/);
    expect(md).toMatch(/A dedicated vector DB is faster[^\n]*\[2\]/);
  });

  // WHY: with no comparison signal, fabricating a verdict would be a fake-LLM
  // smell. Fall back to a clearly-labeled heuristic Summary from key_findings.
  it('falls back to a labeled Summary when no comparison tradeoffs exist', () => {
    const md = renderBriefReport('What is X', mkBrief(), [mkSource()]);
    expect(md).not.toContain('Verdict (from sources)');
    expect(md).toContain('**Summary');
    expect(md.toLowerCase()).toContain('heuristic');
    expect(md).toContain('Finding one about the topic.');
  });

  // WHY: a comparison query with entities but no quotable tradeoff sentence
  // must still not invent a verdict — it degrades to the Summary, not a
  // verdict with no citations.
  it('uses Summary (not Verdict) when comparison section has empty tradeoffs', () => {
    const brief = mkBrief({
      query_type: 'comparison',
      sections: {
        overview: { key_findings: ['kf'], cross_references: [] },
        comparison: { entities: ['A', 'B'], comparison_points: [], tradeoffs: [] },
        gaps: [],
      },
    });
    const md = renderBriefReport('A vs B', brief, [mkSource()]);
    expect(md).not.toContain('Verdict (from sources)');
    expect(md).toContain('**Summary');
  });

  // WHY: each brief section maps to a heading so the reader gets an organized
  // brief, not a flat dump.
  it('maps brief sections to their headings', () => {
    const brief = mkBrief({
      key_findings: ['A key finding.'],
      sections: {
        overview: {
          key_findings: ['A key finding.'],
          cross_references: [
            { finding: 'columnar storage engine', source_indices: [0, 1], confidence: 'high' },
          ],
        },
        gaps: ['Limited coverage for: "scaling"', { entity: 'A2A', reason: 'no sub-query planned' }],
      },
    });
    const sources = [
      mkSource({ url: 'https://a.com', title: 'Source A' }),
      mkSource({ url: 'https://b.com', title: 'Source B' }),
    ];
    const md = renderBriefReport('q', brief, sources);
    expect(md).toContain('### Key Findings');
    expect(md).toContain('A key finding.');
    expect(md).toContain('### Where Sources Agree');
    expect(md).toContain('columnar storage engine');
    expect(md).toContain('### Open Questions');
    expect(md).toContain('scaling');
    expect(md).toContain('A2A');
    expect(md).toContain('### Sources');
    expect(md).toContain('Source A');
    expect(md).toContain('https://a.com');
  });

  // WHY: cross-reference citations must point at the right sources so a reader
  // can verify a corroborated claim.
  it('cites cross-references with [n] indexing into sources (1-based)', () => {
    const brief = mkBrief({
      sections: {
        overview: {
          key_findings: ['kf'],
          cross_references: [
            { finding: 'shared finding', source_indices: [0, 2], confidence: 'high' },
          ],
        },
        gaps: [],
      },
    });
    const sources = [mkSource({ url: 'https://a.com' }), mkSource({ url: 'https://b.com' }), mkSource({ url: 'https://c.com' })];
    const md = renderBriefReport('q', brief, sources);
    // source_indices [0,2] -> citations [1] and [3].
    expect(md).toMatch(/shared finding[^\n]*\[1\]/);
    expect(md).toContain('[3]');
  });

  // WHY: the Comparison section is only meaningful for comparison queries;
  // showing it for a general query would be noise.
  it('renders the Comparison section only for comparison query_type', () => {
    const comparisonBrief = mkBrief({
      query_type: 'comparison',
      sections: {
        overview: { key_findings: ['kf'], cross_references: [] },
        comparison: {
          entities: ['A', 'B'],
          comparison_points: ['faster'],
          tradeoffs: [{ text: 'A is faster than B.', source_index: 0, term: 'faster' }],
        },
        gaps: [],
      },
    });
    const generalBrief = mkBrief({ query_type: 'general' });
    const cmpMd = renderBriefReport('A vs B', comparisonBrief, [mkSource()]);
    const genMd = renderBriefReport('q', generalBrief, [mkSource()]);
    expect(cmpMd).toContain('### Comparison');
    expect(genMd).not.toContain('### Comparison');
  });

  // WHY: empty sections must be omitted cleanly — an empty "Open Questions"
  // heading with no content reads like a broken template.
  it('omits empty sections', () => {
    const md = renderBriefReport('q', mkBrief({
      sections: {
        overview: { key_findings: ['kf'], cross_references: [] },
        gaps: [],
      },
    }), [mkSource()]);
    expect(md).not.toContain('### Where Sources Agree');
    expect(md).not.toContain('### Open Questions');
    expect(md).not.toContain('### Comparison');
    // Sources and Key Findings always present when data exists.
    expect(md).toContain('### Sources');
    expect(md).toContain('### Key Findings');
  });
});
