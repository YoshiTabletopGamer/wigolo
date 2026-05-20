import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface PythonProbeResult {
  reranker: 'ok' | 'missing';
  embeddings: 'ok' | 'missing';
}

export function probePythonPackages(dataDir: string): PythonProbeResult {
  return {
    reranker: probeRerankerCache(dataDir),
    embeddings: probeFastembedCache(dataDir),
  };
}

function probeRerankerCache(dataDir: string): 'ok' | 'missing' {
  // Transformers.js writes the cross-encoder model under
  // `<dataDir>/transformers/`. Presence of that directory with content
  // is a good proxy for "model has been downloaded at least once".
  const cacheDir = join(dataDir, 'transformers');
  if (!existsSync(cacheDir)) return 'missing';
  try {
    return readdirSync(cacheDir).length > 0 ? 'ok' : 'missing';
  } catch {
    return 'missing';
  }
}

function probeFastembedCache(dataDir: string): 'ok' | 'missing' {
  const cacheDir = join(dataDir, 'fastembed');
  if (!existsSync(cacheDir)) return 'missing';
  try {
    return readdirSync(cacheDir).length > 0 ? 'ok' : 'missing';
  } catch {
    return 'missing';
  }
}
