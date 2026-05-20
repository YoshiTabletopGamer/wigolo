// Runtime tests require huggingface.co network for ONNX download on first run.
// Gate them via RUN_FASTEMBED=1 env so CI/sandbox environments stay green.
import { describe, it, expect, beforeAll } from 'vitest';
import { FastembedEmbedProvider } from '../../../src/embedding/fastembed-provider.js';

describe('FastembedEmbedProvider (static)', () => {
  it('exposes BGE-small modelId and 384-dim without warmup', () => {
    const p = new FastembedEmbedProvider();
    expect(p.modelId).toMatch(/bge.?small/i);
    expect(p.dim).toBe(384);
  });
});

describe.skipIf(!process.env.RUN_FASTEMBED)('FastembedEmbedProvider (runtime, RUN_FASTEMBED=1)', () => {
  let provider: FastembedEmbedProvider;
  beforeAll(async () => {
    provider = new FastembedEmbedProvider();
    await provider.warmup();
  }, 120_000);

  it('embeds a single string', async () => {
    const [vec] = await provider.embed(['hello world']);
    expect(vec).toBeInstanceOf(Float32Array);
    expect(vec.length).toBe(provider.dim);
  });

  it('embeds a batch', async () => {
    const vecs = await provider.embed(['foo', 'bar', 'baz']);
    expect(vecs).toHaveLength(3);
    vecs.forEach(v => expect(v.length).toBe(provider.dim));
  });

  it('similar strings have higher cosine similarity than dissimilar', async () => {
    const [a, b, c] = await provider.embed([
      'TypeScript is a typed superset of JavaScript',
      'TS adds types to JavaScript',
      'The quick brown fox jumps over the lazy dog',
    ]);
    const cos = (x: Float32Array, y: Float32Array): number => {
      let s = 0, nx = 0, ny = 0;
      for (let i = 0; i < x.length; i++) { s += x[i] * y[i]; nx += x[i] ** 2; ny += y[i] ** 2; }
      return s / (Math.sqrt(nx) * Math.sqrt(ny));
    };
    expect(cos(a, b)).toBeGreaterThan(cos(a, c));
  });

  it('exposes stable modelId', () => {
    expect(provider.modelId).toMatch(/bge|nomic/i);
  });

  it('returns empty array for empty input', async () => {
    const out = await provider.embed([]);
    expect(out).toEqual([]);
  });
});
