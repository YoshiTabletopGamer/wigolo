import { createLogger } from '../logger.js';
import { isLlmConfiguredWithKeyStore, runLlmText } from '../integrations/cloud/llm/run.js';

const log = createLogger('research');

const DEFAULT_MAX_SOURCES = 8;
const DEFAULT_MAX_CHARS_PER_SOURCE = 4000;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_TOKENS = 3000;

export interface LocalSynthesisOptions {
  maxSources?: number;
  maxCharsPerSource?: number;
  timeoutMs?: number;
  maxTokens?: number;
  modelOverride?: string;
  /**
   * Opt-in local-model tier (from resolveLocalModelTier). When present, the
   * keystore gate is bypassed and runLlmText is routed at this endpoint/model —
   * enabling synthesis when only WIGOLO_LOCAL_LLM is on (no cloud key, no
   * explicit WIGOLO_LLM_PROVIDER).
   */
  tier?: { endpoint: string; model: string };
}

export interface LocalSynthesisSource {
  url: string;
  title: string;
  markdown: string;
}

export interface LocalSynthesisResult {
  text: string;
  citations: number[];
}

export async function synthesizeLocal(
  question: string,
  sources: LocalSynthesisSource[],
  opts: LocalSynthesisOptions = {},
): Promise<LocalSynthesisResult> {
  // A local-model tier is self-configuring: it carries its own endpoint/model,
  // so it bypasses the keystore gate (that gate only knows about cloud keys and
  // an explicit WIGOLO_LLM_PROVIDER). Without a tier, require a configured LLM.
  if (!opts.tier && !(await isLlmConfiguredWithKeyStore())) {
    throw new Error('LLM not configured. Set WIGOLO_LLM_PROVIDER or a provider API key.');
  }

  const maxSources = opts.maxSources ?? DEFAULT_MAX_SOURCES;
  const maxCharsPerSource = opts.maxCharsPerSource ?? DEFAULT_MAX_CHARS_PER_SOURCE;

  const sliced = sources.slice(0, maxSources);
  const sourceBlocks = sliced.map((s, i) => {
    const body = s.markdown.length > maxCharsPerSource
      ? s.markdown.slice(0, maxCharsPerSource)
      : s.markdown;
    return `[${i + 1}] ${s.title}\n${body}`;
  });

  const prompt =
    'You answer questions using ONLY the provided sources. Cite each fact with [N] where N is the source number.\n\n' +
    `Question: ${question}\n\n` +
    `Sources:\n${sourceBlocks.join('\n\n')}`;

  try {
    const result = await runViaTierOrConfigured(prompt, opts);
    log.info('local synthesis ok', { provider: result.provider, model: result.model, latencyMs: result.latencyMs });
    return { text: result.text, citations: extractCitations(result.text) };
  } catch (err) {
    log.error('local synthesis request failed', { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

// runLlmText resolves its backend from process.env.WIGOLO_LLM_PROVIDER (via
// resolveCustomBackend). When a local-model tier is supplied it may be the ONLY
// signal that a model is reachable — no WIGOLO_LLM_PROVIDER set — so point that
// env at the tier's OpenAI-compatible endpoint for the scope of the call and
// restore it after (success OR failure), so a caller's env is never mutated.
async function runViaTierOrConfigured(prompt: string, opts: LocalSynthesisOptions) {
  const call = () =>
    runLlmText({
      prompt,
      maxTokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      modelOverride: opts.tier?.model ?? opts.modelOverride,
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });

  if (!opts.tier) return call();

  const prevProvider = process.env.WIGOLO_LLM_PROVIDER;
  process.env.WIGOLO_LLM_PROVIDER = opts.tier.endpoint;
  try {
    return await call();
  } finally {
    if (prevProvider === undefined) delete process.env.WIGOLO_LLM_PROVIDER;
    else process.env.WIGOLO_LLM_PROVIDER = prevProvider;
  }
}

// Backwards-compat shim — callers used isLocalLlmEnabled() to gate this
// fallback. Keystore-aware so a zero-env (config.json + keychain) setup reports
// enabled. No remaining in-tree callers; kept for external compatibility.
export async function isLocalLlmEnabled(): Promise<boolean> {
  return isLlmConfiguredWithKeyStore();
}

function extractCitations(text: string): number[] {
  const matches = text.match(/\[(\d+)\]/g);
  if (!matches) return [];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const m of matches) {
    const n = Number(m.slice(1, -1));
    if (!Number.isFinite(n) || n < 1) continue;
    const idx = n - 1;
    if (seen.has(idx)) continue;
    seen.add(idx);
    out.push(idx);
  }
  return out;
}
