import { describe, expect, it, vi, beforeEach } from 'vitest';

const { existsSyncMock, readdirSyncMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  readdirSyncMock: vi.fn(),
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, existsSync: existsSyncMock, readdirSync: readdirSyncMock };
});

import { probePythonPackages } from '../../../../src/cli/tui/status-python.js';

beforeEach(() => {
  existsSyncMock.mockReset();
  readdirSyncMock.mockReset();
});

describe('probePythonPackages', () => {
  it('marks each package ok when every probe succeeds', () => {
    existsSyncMock.mockReturnValue(true);
    readdirSyncMock.mockReturnValue(['model.onnx'] as unknown as ReturnType<typeof readdirSyncMock>);

    const result = probePythonPackages('/tmp/data');

    expect(result.reranker).toBe('ok');
    expect(result.embeddings).toBe('ok');
  });

  it('marks each package missing when its probe fails', () => {
    existsSyncMock.mockReturnValue(false);
    readdirSyncMock.mockReturnValue([] as unknown as ReturnType<typeof readdirSyncMock>);

    const result = probePythonPackages('/tmp/data');

    expect(result.reranker).toBe('missing');
    expect(result.embeddings).toBe('missing');
  });

  it('isolates per-package state — reranker cache present, embeddings cache absent', () => {
    existsSyncMock.mockImplementation((p) => String(p).endsWith('transformers'));
    readdirSyncMock.mockReturnValue(['model.onnx'] as unknown as ReturnType<typeof readdirSyncMock>);

    const result = probePythonPackages('/tmp/data');

    expect(result.reranker).toBe('ok');
    expect(result.embeddings).toBe('missing');
  });
});
