import type { MergedSearchResult } from '../dedup.js';

// Engine-consensus boost (Q7). Replaces per-subject authority enumeration with a
// data-driven signal: URLs returned by multiple independent search engines are
// likely authoritative regardless of query topic. Generalizes to all subjects;
// no hand-curated map.
//
// Provenance: Reciprocal Rank Fusion's consensus property — documents agreed on
// by multiple rankers tend to be relevant (Cormack et al., SIGIR 2009;
// OpenSearch 2.19 RRF documentation; Azure AI Search RRF). We surface engine
// agreement as a first-class re-rank signal in addition to the existing RRF
// merge in dedup.ts.

const CONSENSUS_BOOST_BY_ENGINE_COUNT: Record<number, number> = {
  1: 0,
  2: 0.05,
  3: 0.10,
};
const CAP_AT_OR_ABOVE_4 = 0.12;

export function applyConsensusBoost(results: MergedSearchResult[]): MergedSearchResult[] {
  if (results.length === 0) return results;

  return results.map((r) => {
    const n = uniqueEngines(r.engines);
    if (n <= 1) return r;
    const boost = n >= 4 ? CAP_AT_OR_ABOVE_4 : CONSENSUS_BOOST_BY_ENGINE_COUNT[n] ?? 0;
    if (boost === 0) return r;
    return {
      ...r,
      relevance_score: Math.min(1, r.relevance_score + boost),
    };
  });
}

function uniqueEngines(engines: string[] | undefined): number {
  if (!engines || engines.length === 0) return 0;
  return new Set(engines.map((e) => e.toLowerCase())).size;
}
