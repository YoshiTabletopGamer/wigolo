/**
 * SP6 — verifyEndToEnd action.
 *
 * Orchestrates a real capability smoke: search → fetch → extract →
 * (synthesis if a provider key is configured) plus an MCP-wiring check per
 * detected/configured agent.
 *
 * Design:
 * - All network/provider calls are injected via `VerifyEndToEndDeps` so the
 *   orchestration logic is testable headlessly.
 * - Synthesis is SKIPPED (not failed) when no provider key is configured.
 *   This avoids treating an optional capability as a hard failure.
 * - MCP-wiring: reads each agent's config file and asserts the wigolo entry
 *   is present at the expected key path. Reuses the SP7/agents.ts detection
 *   and config-writer.ts key-path knowledge.
 * - hardFailureCount counts only 'fail' results — 'skipped' is not a failure.
 *
 * SP4 seam: the synthesis probe loads `resolveProviderKey` from SP4's
 * `src/security/key-store.ts` via a variable-specifier dynamic import. If SP4
 * hasn't landed the import returns null and the probe falls back to an env-var
 * check. TODO(SP4-merged): import resolveProviderKey statically once SP4 is on
 * main and drop the env-var fallback.
 */

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { AgentId, InstallType } from '../agents.js';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type CapabilityName =
  | 'search'
  | 'fetch'
  | 'extract'
  | 'synthesis'
  | 'mcp-wiring';

export type CapabilityStatus = 'pass' | 'fail' | 'skipped';

export interface CapabilityResult {
  capability: CapabilityName;
  status: CapabilityStatus;
  /** Human-readable detail. On fail: actionable message naming the fix. */
  detail: string;
}

export interface McpWiringResult {
  agentId: AgentId;
  agentName: string;
  configPath: string | null;
  status: CapabilityStatus;
  detail: string;
}

export interface VerifyEndToEndResult {
  capabilities: CapabilityResult[];
  mcpWiringResults: McpWiringResult[];
  allPassed: boolean;
  /** Count of capabilities with status === 'fail'. Skipped never increments this. */
  hardFailureCount: number;
}

// ---------------------------------------------------------------------------
// Dependency injection interface (all network/provider calls injected)
// ---------------------------------------------------------------------------

export interface VerifyEndToEndDeps {
  probeSearch(): Promise<CapabilityResult>;
  probeFetch(): Promise<CapabilityResult>;
  probeExtract(): Promise<CapabilityResult>;
  probeSynthesis(): Promise<CapabilityResult>;
  probeMcpWiring(): Promise<McpWiringResult[]>;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function verifyEndToEnd(
  deps: VerifyEndToEndDeps,
): Promise<VerifyEndToEndResult> {
  const [search, fetch, extract, synthesis] = await Promise.all([
    deps.probeSearch().catch((err): CapabilityResult => ({
      capability: 'search',
      status: 'fail',
      detail: `probe threw: ${err instanceof Error ? err.message : String(err)}`,
    })),
    deps.probeFetch().catch((err): CapabilityResult => ({
      capability: 'fetch',
      status: 'fail',
      detail: `probe threw: ${err instanceof Error ? err.message : String(err)}`,
    })),
    deps.probeExtract().catch((err): CapabilityResult => ({
      capability: 'extract',
      status: 'fail',
      detail: `probe threw: ${err instanceof Error ? err.message : String(err)}`,
    })),
    deps.probeSynthesis().catch((err): CapabilityResult => ({
      capability: 'synthesis',
      status: 'fail',
      detail: `probe threw: ${err instanceof Error ? err.message : String(err)}`,
    })),
  ]);

  const wiringResults = await deps.probeMcpWiring().catch((): McpWiringResult[] => []);

  // Build the mcp-wiring capability summary
  const mcpWiringCap = buildMcpWiringCapability(wiringResults);

  const capabilities: CapabilityResult[] = [search, fetch, extract, synthesis, mcpWiringCap];

  const hardFailureCount = capabilities.filter((c) => c.status === 'fail').length;
  // allPassed: no hard failures (skipped does not count as failure)
  const allPassed = hardFailureCount === 0;

  return { capabilities, mcpWiringResults: wiringResults, allPassed, hardFailureCount };
}

function buildMcpWiringCapability(wiringResults: McpWiringResult[]): CapabilityResult {
  if (wiringResults.length === 0) {
    return {
      capability: 'mcp-wiring',
      status: 'skipped',
      detail: 'no agents configured — run `wigolo init` to wire an agent',
    };
  }
  const failed = wiringResults.filter((r) => r.status === 'fail');
  if (failed.length === 0) {
    const names = wiringResults.map((r) => r.agentName).join(', ');
    return {
      capability: 'mcp-wiring',
      status: 'pass',
      detail: `wigolo entry confirmed in: ${names}`,
    };
  }
  const failNames = failed.map((r) => `${r.agentName} (${r.detail})`).join('; ');
  return {
    capability: 'mcp-wiring',
    status: 'fail',
    detail: `MCP wiring missing for: ${failNames}`,
  };
}

// ---------------------------------------------------------------------------
// MCP wiring file probe — exported for unit testing and standalone use
// ---------------------------------------------------------------------------

export interface McpWiringCheckInput {
  agentId: AgentId;
  agentName: string;
  configPath: string | null;
  keyPath: string[];
  installType: InstallType;
  /**
   * Override the path-bound roots. Production omits this (defaults to home +
   * cwd); tests pass a temp-dir root so fixtures don't have to live under the
   * real home directory.
   */
  allowedRoots?: string[];
}

export async function checkMcpWiringForAgent(
  input: McpWiringCheckInput,
): Promise<McpWiringResult> {
  const { agentId, agentName, configPath, keyPath, installType, allowedRoots } = input;
  const base: Omit<McpWiringResult, 'status' | 'detail'> = {
    agentId,
    agentName,
    configPath,
  };

  // cli-command agents (Claude Code) are installed via `claude mcp add` — no
  // config file to read. Report as skipped rather than fail.
  if (installType === 'cli-command') {
    return { ...base, status: 'pass', detail: 'CLI-installed agent (no config file to check)' };
  }

  if (!configPath) {
    return { ...base, status: 'fail', detail: 'no configPath for agent — re-run `wigolo init`' };
  }

  // Bound the read surface: this is a public export accepting an arbitrary
  // configPath. Agent config files always live under the user's home dir or
  // the current working directory (see agents.ts). Refuse to read anything
  // outside those roots so a caller can't coax us into reading e.g. /etc/passwd.
  if (!isPathWithinAllowedRoots(configPath, allowedRoots)) {
    return {
      ...base,
      status: 'fail',
      detail: `config path is outside the home/working directory (${configPath}) — refusing to read`,
    };
  }

  if (!existsSync(configPath)) {
    return {
      ...base,
      status: 'fail',
      detail: `config file not found at ${configPath} — re-run \`wigolo init\` to create it`,
    };
  }

  if (installType === 'config-toml') {
    return checkTomlWiring(base, configPath, keyPath);
  }

  return checkJsonWiring(base, configPath, keyPath);
}

/**
 * Returns true only when the resolved path lives under the user's home dir or
 * the current working directory. Symlink-resolution is intentionally NOT done
 * (we only readFileSync afterwards, and the existsSync gate covers missing
 * files); this is a coarse bound on the input, not a full sandbox.
 */
function isPathWithinAllowedRoots(configPath: string, allowedRoots?: string[]): boolean {
  const abs = resolve(configPath);
  const roots = (allowedRoots && allowedRoots.length > 0 ? allowedRoots : [homedir(), process.cwd()])
    .map((r) => resolve(r));
  return roots.some((root) => abs === root || abs.startsWith(root + '/'));
}

function checkJsonWiring(
  base: Omit<McpWiringResult, 'status' | 'detail'>,
  configPath: string,
  keyPath: string[],
): McpWiringResult {
  let parsed: Record<string, unknown>;
  try {
    const raw = readFileSync(configPath, 'utf-8').trim();
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ...base,
      status: 'fail',
      detail: `could not parse config file: ${msg.slice(0, 80)} — re-run \`wigolo init\``,
    };
  }

  const found = getAtPath(parsed, keyPath);
  if (found == null) {
    return {
      ...base,
      status: 'fail',
      detail: `wigolo entry missing at ${keyPath.join('.')} — re-run \`wigolo init\` to repair`,
    };
  }
  return { ...base, status: 'pass', detail: 'wigolo entry found' };
}

function checkTomlWiring(
  base: Omit<McpWiringResult, 'status' | 'detail'>,
  configPath: string,
  keyPath: string[],
): McpWiringResult {
  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ...base,
      status: 'fail',
      detail: `could not read config file: ${msg.slice(0, 80)} — re-run \`wigolo init\``,
    };
  }

  // Minimal TOML table-header check: look for [key0.key1] or [key0.key1.*]
  // We don't want to pull in a full TOML parser for a smoke check.
  const tableName = keyPath.join('.');
  const pattern = new RegExp(
    `^\\s*\\[\\s*${escapeRegex(tableName)}\\s*[\\].]`,
    'm',
  );
  if (!pattern.test(raw)) {
    return {
      ...base,
      status: 'fail',
      detail: `wigolo entry missing at [${tableName}] — re-run \`wigolo init\` to repair`,
    };
  }
  return { ...base, status: 'pass', detail: 'wigolo entry found' };
}

function getAtPath(obj: unknown, keyPath: string[]): unknown {
  let cursor = obj;
  for (const key of keyPath) {
    if (cursor == null || typeof cursor !== 'object' || Array.isArray(cursor)) return null;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor ?? null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Default dependency implementations (live network/provider calls)
// Used at runtime by the TUI and the standalone verify/doctor paths.
// ---------------------------------------------------------------------------

const STABLE_FETCH_URL = 'https://www.example.com';
const STABLE_SEARCH_QUERY = 'wigolo mcp server';

export async function buildDefaultDeps(): Promise<VerifyEndToEndDeps> {
  return {
    probeSearch: buildDefaultSearchProbe(),
    probeFetch: buildDefaultFetchProbe(),
    probeExtract: buildDefaultExtractProbe(),
    probeSynthesis: await buildDefaultSynthesisProbe(),
    probeMcpWiring: buildDefaultMcpWiringProbe(),
  };
}

function buildDefaultSearchProbe(): () => Promise<CapabilityResult> {
  return async (): Promise<CapabilityResult> => {
    try {
      const { getSearchProvider } = await import('../../../providers/search-provider.js');
      const provider = await getSearchProvider();
      const { buildMinimalRouter } = await import('./verify-router.js');
      const router = await buildMinimalRouter();
      const result = await provider.search(
        { query: STABLE_SEARCH_QUERY },
        { engines: [], router },
      );
      const count = result.ok ? (result.data.results?.length ?? 0) : 0;
      if (!result.ok || count === 0) {
        return {
          capability: 'search',
          status: 'fail',
          detail: 'search returned 0 results — check internet connectivity or WIGOLO_SEARCH env var',
        };
      }
      return { capability: 'search', status: 'pass', detail: `got ${count} result(s)` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        capability: 'search',
        status: 'fail',
        detail: `search probe failed: ${msg.slice(0, 120)} — check internet connectivity`,
      };
    }
  };
}

function buildDefaultFetchProbe(): () => Promise<CapabilityResult> {
  return async (): Promise<CapabilityResult> => {
    try {
      const { buildMinimalRouter } = await import('./verify-router.js');
      const router = await buildMinimalRouter();
      const raw = await router.fetch(STABLE_FETCH_URL, { renderJs: 'never' });
      const chars = raw.html?.length ?? 0;
      if (chars === 0) {
        return {
          capability: 'fetch',
          status: 'fail',
          detail: `fetch returned empty body for ${STABLE_FETCH_URL} — check internet connectivity`,
        };
      }
      return { capability: 'fetch', status: 'pass', detail: `fetched ${chars} chars` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        capability: 'fetch',
        status: 'fail',
        detail: `fetch probe failed: ${msg.slice(0, 120)} — check internet connectivity or run \`wigolo warmup\``,
      };
    }
  };
}

function buildDefaultExtractProbe(): () => Promise<CapabilityResult> {
  return async (): Promise<CapabilityResult> => {
    // Minimal HTML to avoid depending on network in the extract probe itself
    const PROBE_HTML = '<html><head><title>Wigolo Probe</title></head><body><p>Hello probe</p></body></html>';
    try {
      const { getExtractProvider } = await import('../../../providers/extract-provider.js');
      const provider = await getExtractProvider();
      const result = await provider.extract(PROBE_HTML, STABLE_FETCH_URL);
      const title = result.title ?? '';
      const content = result.markdown ?? '';
      if (!title && !content) {
        return {
          capability: 'extract',
          status: 'fail',
          detail: 'extraction returned no title or content — run `wigolo warmup` to reinstall content extractor',
        };
      }
      return { capability: 'extract', status: 'pass', detail: `extracted title="${title.slice(0, 40)}"` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        capability: 'extract',
        status: 'fail',
        detail: `extract probe failed: ${msg.slice(0, 120)} — run \`wigolo warmup\` to reinstall content extractor`,
      };
    }
  };
}

async function buildDefaultSynthesisProbe(): Promise<() => Promise<CapabilityResult>> {
  const SYNTHESIS_SKIP_DETAIL =
    'no provider key configured — set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY to enable synthesis';

  // SP4 seam: SP4 ships `resolveProviderKey(provider, { dataDir })` from
  // `src/security/key-store.ts` (keychain → encrypted file → env). We load it
  // through a VARIABLE specifier so tsc never resolves the path at compile time
  // (the module doesn't exist on this branch yet). When SP4 hasn't merged the
  // import returns null and we fall through to the env-var check.
  // TODO(SP4-merged): import resolveProviderKey directly from
  //   '../../../security/key-store.js' and drop the variable-specifier dance +
  //   env-var fallback once SP4 is on main.
  type ResolveProviderKey = (
    provider: string,
    opts: { dataDir: string },
  ) => Promise<string | undefined>;
  let resolveProviderKey: ResolveProviderKey | undefined;
  {
    const seamSpec = '../../../security/key-store.js';
    const mod = await import(seamSpec).catch(() => null);
    const candidate = (mod as { resolveProviderKey?: unknown } | null)?.resolveProviderKey;
    if (typeof candidate === 'function') {
      resolveProviderKey = candidate as ResolveProviderKey;
    }
  }

  return async (): Promise<CapabilityResult> => {
    // Determine if any provider key is available
    let hasKey = false;

    if (resolveProviderKey) {
      // SP4 seam available
      const { getConfig } = await import('../../../config.js');
      const dataDir = getConfig().dataDir;
      const { allProviders } = await import('../../../integrations/cloud/llm/select.js');
      for (const provider of allProviders()) {
        const key = await resolveProviderKey(provider, { dataDir }).catch(() => undefined);
        if (key) { hasKey = true; break; }
      }
    } else {
      // Fallback: check well-known env vars directly
      const PROVIDER_KEYS = [
        'ANTHROPIC_API_KEY',
        'OPENAI_API_KEY',
        'GEMINI_API_KEY',
        'GROQ_API_KEY',
      ];
      hasKey = PROVIDER_KEYS.some((k) => !!process.env[k]);
    }

    if (!hasKey) {
      return { capability: 'synthesis', status: 'skipped', detail: SYNTHESIS_SKIP_DETAIL };
    }

    try {
      const { selectProvider } = await import('../../../integrations/cloud/llm/select.js');
      const active = selectProvider(process.env);
      if (!active) {
        return { capability: 'synthesis', status: 'skipped', detail: SYNTHESIS_SKIP_DETAIL };
      }
      // Probe with a minimal prompt
      const { runLlmText } = await import('../../../integrations/cloud/llm/run.js');
      const response = await runLlmText({
        prompt: 'Reply with the single word "ok".',
        maxTokens: 10,
      });
      const text = response.text?.trim() ?? '';
      if (!text) {
        return {
          capability: 'synthesis',
          status: 'fail',
          detail: `synthesis returned empty response — check your ${active.toUpperCase()} API key`,
        };
      }
      return { capability: 'synthesis', status: 'pass', detail: `synthesis ok (${active})` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        capability: 'synthesis',
        status: 'fail',
        detail: `synthesis probe failed: ${msg.slice(0, 120)} — check your provider API key`,
      };
    }
  };
}

function buildDefaultMcpWiringProbe(): () => Promise<McpWiringResult[]> {
  return async (): Promise<McpWiringResult[]> => {
    const { detectAgents } = await import('../agents.js');
    const { JSON_SPECS, CODEX_TABLE_PATH } = await import('../config-writer.js');
    const detected = detectAgents({});
    const configured = detected.filter((a) => a.detected);
    if (configured.length === 0) return [];

    const results: McpWiringResult[] = [];
    for (const agent of configured) {
      let keyPath: string[];
      if (agent.installType === 'cli-command') {
        keyPath = [];
      } else if (agent.installType === 'config-toml') {
        keyPath = CODEX_TABLE_PATH;
      } else {
        const spec = JSON_SPECS[agent.id as keyof typeof JSON_SPECS];
        keyPath = spec?.keyPath ?? [];
      }
      const r = await checkMcpWiringForAgent({
        agentId: agent.id,
        agentName: agent.displayName,
        configPath: agent.configPath,
        keyPath,
        installType: agent.installType,
      });
      results.push(r);
    }
    return results;
  };
}

// ---------------------------------------------------------------------------
// Plain-text formatter for non-interactive / --plain output
// ---------------------------------------------------------------------------

export function formatVerifyResultPlain(result: VerifyEndToEndResult): string[] {
  const lines: string[] = [];
  lines.push('[wigolo verify] Capability smoke check:');
  for (const cap of result.capabilities) {
    const label = cap.capability.padEnd(12);
    const statusTag =
      cap.status === 'pass' ? 'PASS' : cap.status === 'skipped' ? 'SKIP' : 'FAIL';
    lines.push(`  ${statusTag}  ${label}  ${cap.detail}`);
  }

  if (result.mcpWiringResults.length > 0) {
    lines.push('');
    lines.push('[wigolo verify] MCP wiring:');
    for (const w of result.mcpWiringResults) {
      const statusTag =
        w.status === 'pass' ? 'PASS' : w.status === 'skipped' ? 'SKIP' : 'FAIL';
      lines.push(`  ${statusTag}  ${w.agentName.padEnd(16)}  ${w.detail}`);
    }
  }

  lines.push('');
  if (result.allPassed) {
    lines.push('[wigolo verify] Overall: OK — all capabilities pass');
  } else {
    lines.push(
      `[wigolo verify] Overall: FAIL — ${result.hardFailureCount} hard failure(s) detected`,
    );
  }
  return lines;
}
