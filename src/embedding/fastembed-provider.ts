import { join } from 'node:path';
import { FlagEmbedding, EmbeddingModel } from 'fastembed';
import type { EmbedProvider } from '../providers/embed-provider.js';
import { getConfig } from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('embedding');

/**
 * Native ONNX embedding provider using fastembed-rs Node bindings.
 *
 * Model: BGE-small-en-v1.5 (384-dim). First call to `warmup()` downloads
 * the ONNX model to `${dataDir}/fastembed`. Subsequent runs reuse the cache.
 * Replaces the legacy sentence-transformers Python subprocess.
 */
export class FastembedEmbedProvider implements EmbedProvider {
  private model: FlagEmbedding | null = null;
  private modelPromise: Promise<FlagEmbedding> | null = null;
  readonly modelId: string;
  readonly dim: number;

  constructor() {
    this.modelId = 'BGE-small-en-v1.5';
    this.dim = 384;
  }

  async warmup(): Promise<void> {
    await this.getModel();
  }

  private getModel(): Promise<FlagEmbedding> {
    if (this.model) return Promise.resolve(this.model);
    if (this.modelPromise) return this.modelPromise;
    log.info('Loading embedding model', { modelId: this.modelId });
    const cacheDir = join(getConfig().dataDir, 'fastembed');
    this.modelPromise = FlagEmbedding.init({
      model: EmbeddingModel.BGESmallENV15,
      cacheDir,
    }).then(m => {
      this.model = m;
      log.info('Embedding model ready', { modelId: this.modelId, dim: this.dim });
      return m;
    }).catch(err => {
      this.modelPromise = null;
      throw err;
    });
    return this.modelPromise;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const model = await this.getModel();
    const out: Float32Array[] = [];
    for await (const batch of model.embed(texts, texts.length)) {
      for (const vec of batch) {
        out.push(Float32Array.from(vec));
      }
    }
    return out;
  }
}
