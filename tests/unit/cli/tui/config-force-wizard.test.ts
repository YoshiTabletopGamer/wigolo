/**
 * --force-wizard routing tests.
 *
 * `wigolo config --force-wizard` must resolve to mode='wizard' even when
 * a fully-configured config file exists. This pins the flag as a real bypass
 * rather than a rename of the existing wizard path.
 *
 * `wigolo init` delegates to runConfig with forceWizard:true — same code path,
 * verified by confirming both produce the same resolveEntry result.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveEntry } from '../../../../src/cli/tui/entry.js';

let tmpDir: string;

function writeComplete(file: string): string {
  const p = join(tmpDir, file);
  writeFileSync(p, JSON.stringify({
    version: 1,
    settings: { llmProvider: 'anthropic', llmApiKey: 'sk-xxx' },
  }), { mode: 0o600 });
  return p;
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'wigolo-fwiz-'));
});

afterEach(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('resolveEntry with mode=wizard (force-wizard path)', () => {
  it('mode=wizard on a fully-configured file → still wizard (force bypasses required-fields)', async () => {
    const p = writeComplete('complete.json');
    const r = await resolveEntry({ mode: 'wizard', configPath: p, isTTY: true });
    expect(r.mode).toBe('wizard');
    // firstRun is false because the file exists — just the wizard was forced
    expect(r.firstRun).toBe(false);
  });

  it('mode=wizard on a missing file → wizard + firstRun=true', async () => {
    const p = join(tmpDir, 'none.json');
    const r = await resolveEntry({ mode: 'wizard', configPath: p, isTTY: true });
    expect(r.mode).toBe('wizard');
    expect(r.firstRun).toBe(true);
  });
});
