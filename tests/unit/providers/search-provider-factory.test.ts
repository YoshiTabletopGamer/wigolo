import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getSearchProvider, _resetSearchProviderForTest } from '../../../src/providers/search-provider.js';
import { resetConfig } from '../../../src/config.js';
import { resetPersistedConfig } from '../../../src/persisted-config.js';
import { LegacySearxngProvider } from '../../../src/search/legacy/searxng-provider.js';
import { CoreSearchProvider } from '../../../src/search/core/core-provider.js';
import { HybridSearchProvider } from '../../../src/search/hybrid/router.js';

describe('getSearchProvider', () => {
  let originalEnv: string | undefined;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let stderrOutput: string;

  beforeEach(() => {
    originalEnv = process.env.WIGOLO_SEARCH;
    _resetSearchProviderForTest();
    resetConfig();
    resetPersistedConfig();
    stderrOutput = '';
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      stderrOutput += String(chunk);
      return true;
    });
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.WIGOLO_SEARCH;
    else process.env.WIGOLO_SEARCH = originalEnv;
    delete process.env.WIGOLO_CONFIG_PATH;
    _resetSearchProviderForTest();
    resetConfig();
    resetPersistedConfig();
    stderrSpy.mockRestore();
  });

  it('returns CoreSearchProvider by default (unset)', async () => {
    delete process.env.WIGOLO_SEARCH;
    const provider = await getSearchProvider();
    expect(provider).toBeInstanceOf(CoreSearchProvider);
    expect(provider.name).toBe('core');
  });

  it('returns CoreSearchProvider when WIGOLO_SEARCH=core', async () => {
    process.env.WIGOLO_SEARCH = 'core';
    const provider = await getSearchProvider();
    expect(provider).toBeInstanceOf(CoreSearchProvider);
    expect(provider.name).toBe('core');
  });

  it('returns LegacySearxngProvider when WIGOLO_SEARCH=searxng', async () => {
    process.env.WIGOLO_SEARCH = 'searxng';
    const provider = await getSearchProvider();
    expect(provider).toBeInstanceOf(LegacySearxngProvider);
    expect(provider.name).toBe('searxng');
  });

  it('returns HybridSearchProvider when WIGOLO_SEARCH=hybrid', async () => {
    process.env.WIGOLO_SEARCH = 'hybrid';
    const provider = await getSearchProvider();
    expect(provider).toBeInstanceOf(HybridSearchProvider);
    expect(provider.name).toBe('hybrid');
    expect(stderrOutput).not.toMatch(/not yet implemented/);
  });

  it('accepts deprecated WIGOLO_SEARCH=v1 as alias for core and warns', async () => {
    process.env.WIGOLO_SEARCH = 'v1';
    const provider = await getSearchProvider();
    expect(provider).toBeInstanceOf(CoreSearchProvider);
    expect(provider.name).toBe('core');
    expect(stderrOutput).toMatch(/deprecated/);
  });

  it('rejects on unknown value with vocabulary error', async () => {
    process.env.WIGOLO_SEARCH = 'garbage';
    await expect(getSearchProvider()).rejects.toThrow(/Unknown WIGOLO_SEARCH/);
  });

  it('recovers from prior rejection on next call', async () => {
    process.env.WIGOLO_SEARCH = 'garbage';
    await expect(getSearchProvider()).rejects.toThrow(/Unknown WIGOLO_SEARCH/);
    process.env.WIGOLO_SEARCH = 'searxng';
    // Config is read once per process; resetConfig() re-reads env, mirroring
    // how a fresh server boot would pick up the corrected setting.
    resetConfig();
    expect(await getSearchProvider()).toBeInstanceOf(LegacySearxngProvider);
  });

  describe('honors persisted config.json searchBackend (A1)', () => {
    let dir: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'wigolo-search-cfg-'));
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it('selects searxng from config.json when WIGOLO_SEARCH env is unset', async () => {
      const cfgPath = join(dir, 'config.json');
      writeFileSync(cfgPath, JSON.stringify({ version: 1, settings: { searchBackend: 'searxng' } }));
      process.env.WIGOLO_CONFIG_PATH = cfgPath;
      delete process.env.WIGOLO_SEARCH;
      _resetSearchProviderForTest();
      resetConfig();
      resetPersistedConfig();
      const provider = await getSearchProvider();
      expect(provider).toBeInstanceOf(LegacySearxngProvider);
      expect(provider.name).toBe('searxng');
    });

    it('WIGOLO_SEARCH env wins over config.json searchBackend', async () => {
      const cfgPath = join(dir, 'config.json');
      writeFileSync(cfgPath, JSON.stringify({ version: 1, settings: { searchBackend: 'searxng' } }));
      process.env.WIGOLO_CONFIG_PATH = cfgPath;
      process.env.WIGOLO_SEARCH = 'core';
      _resetSearchProviderForTest();
      resetConfig();
      resetPersistedConfig();
      const provider = await getSearchProvider();
      expect(provider).toBeInstanceOf(CoreSearchProvider);
      expect(provider.name).toBe('core');
    });
  });
});
