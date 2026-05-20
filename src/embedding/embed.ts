import type { EmbedProvider } from '../providers/embed-provider.js';
import { VectorIndex, type SimilarResult } from './vector-index.js';
import { updateCacheEmbedding, getAllEmbeddings, normalizeUrl } from '../cache/store.js';
import { FastembedEmbedProvider } from './fastembed-provider.js';
import { createLogger } from '../logger.js';

const log = createLogger('embedding');

/**
 * Embedding service backed by the native fastembed (ONNX) provider.
 *
 * Phase 3 replaced the sentence-transformers Python subprocess with the
 * `FastembedEmbedProvider`. The public surface (init / embedAndStore /
 * embedAsync / findSimilar / getIndex / isAvailable / shutdown) is unchanged so
 * callers in server.ts, tools/fetch.ts, research/pipeline.ts,
 * search/find-similar.ts, and the legacy SearXNG orchestrator continue to work
 * without modification.
 */
export class EmbeddingService {
  private provider: EmbedProvider;
  private index: VectorIndex;
  private available = false;
  private providerVerified = false;

  constructor(provider?: EmbedProvider) {
    this.provider = provider ?? new FastembedEmbedProvider();
    this.index = new VectorIndex();
  }

  async init(): Promise<void> {
    try {
      // Load any embeddings produced by the current model — entries from
      // other models would have incompatible dimensionality.
      const stored = getAllEmbeddings(this.provider.modelId);
      if (stored.length > 0) {
        const entries = stored
          .filter(e => e.embedding && e.dims > 0)
          .map(e => ({
            url: e.normalizedUrl,
            embedding: e.embedding,
            dims: e.dims,
          }));
        const loaded = this.index.loadFromBuffers(entries);
        log.info('loaded embeddings into index', { count: loaded });
      }

      // Probe the provider so we know up front whether ONNX init works.
      try {
        await this.provider.embed(['embedding service probe']);
        this.providerVerified = true;
        log.info('embedding provider verified', {
          modelId: this.provider.modelId,
          dim: this.provider.dim,
        });
      } catch (err) {
        log.warn('embedding provider probe failed — embeddings disabled', {
          error: err instanceof Error ? err.message : String(err),
        });
        this.providerVerified = false;
      }

      this.available = true;
    } catch (err) {
      log.error('EmbeddingService init failed', { error: String(err) });
      this.available = false;
    }
  }

  isAvailable(): boolean {
    return this.available;
  }

  setAvailable(value: boolean): void {
    this.available = value;
  }

  /** Backwards-compat alias preserved for callers that gated on subprocess readiness. */
  isSubprocessReady(): boolean {
    return this.providerVerified;
  }

  getIndex(): VectorIndex {
    return this.index;
  }

  async embedAndStore(url: string, markdown: string): Promise<void> {
    if (!this.available) {
      log.debug('embedding skipped: service not available', { url });
      return;
    }

    try {
      const [vector] = await this.provider.embed([markdown]);
      if (!vector || vector.length === 0) {
        log.warn('embedding returned empty vector', { url });
        return;
      }

      const buffer = Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
      const model = this.provider.modelId;
      const dims = vector.length;

      let normalizedUrl: string;
      try {
        normalizedUrl = normalizeUrl(url);
      } catch {
        normalizedUrl = url;
      }

      updateCacheEmbedding(normalizedUrl, buffer, model, dims);
      this.index.add(normalizedUrl, vector);

      log.debug('embedded and stored', { url: normalizedUrl, dims });
    } catch (err) {
      log.warn('embedAndStore failed', { url, error: String(err) });
    }
  }

  embedAsync(url: string, markdown: string): void {
    if (!this.available) return;

    this.embedAndStore(url, markdown).catch(err => {
      log.warn('async embedding failed', { url, error: String(err) });
    });
  }

  async findSimilar(
    queryText: string,
    topK: number,
    excludeUrls?: Set<string>,
  ): Promise<SimilarResult[]> {
    if (!this.available || this.index.size() === 0) {
      return [];
    }

    try {
      const [queryVector] = await this.provider.embed([queryText]);
      if (!queryVector || queryVector.length === 0) {
        log.warn('query embedding failed: empty vector');
        return [];
      }
      return this.index.findSimilar(queryVector, topK, excludeUrls);
    } catch (err) {
      log.warn('findSimilar failed', { error: String(err) });
      return [];
    }
  }

  shutdown(): void {
    try {
      this.index.clear();
      this.available = false;
      this.providerVerified = false;
      log.info('EmbeddingService shut down');
    } catch (err) {
      log.error('EmbeddingService shutdown error', { error: String(err) });
    }
  }
}

let globalInstance: EmbeddingService | null = null;

export function getEmbeddingService(): EmbeddingService {
  if (!globalInstance) {
    globalInstance = new EmbeddingService();
  }
  return globalInstance;
}

export function resetEmbeddingService(): void {
  if (globalInstance) {
    globalInstance.shutdown();
    globalInstance = null;
  }
}
