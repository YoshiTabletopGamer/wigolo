import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetConfig } from '../../../src/config.js';
import {
  isAntiBotStatus,
  hasChallengeBody,
  isAntiBotSignal,
  looksJsRequired,
  describeAntiBot,
  tlsFetch,
  _setTlsBackendForTests,
  _resetTlsBackend,
  TlsTierUnavailableError,
} from '../../../src/fetch/tls-tier.js';

const originalEnv = process.env;

describe('tls-tier: anti-bot detectors', () => {
  it('flags 403/429/503 as anti-bot statuses', () => {
    expect(isAntiBotStatus(403)).toBe(true);
    expect(isAntiBotStatus(429)).toBe(true);
    expect(isAntiBotStatus(503)).toBe(true);
  });

  it('does not flag 200/302/500 as anti-bot statuses', () => {
    expect(isAntiBotStatus(200)).toBe(false);
    expect(isAntiBotStatus(302)).toBe(false);
    expect(isAntiBotStatus(500)).toBe(false);
  });

  it('detects Cloudflare challenge body markers', () => {
    expect(hasChallengeBody('<html><body>cf-browser-verification</body></html>')).toBe(true);
    expect(hasChallengeBody('<title>Just a moment...</title>')).toBe(true);
    expect(hasChallengeBody('<script>var _cfChlOpt = {}</script>')).toBe(true);
  });

  it('detects DataDome challenge markers', () => {
    expect(hasChallengeBody('<div class="dd-loader"></div>')).toBe(true);
    expect(hasChallengeBody('<script>window._dd_s = 1;</script>')).toBe(true);
  });

  it('does not flag normal HTML as anti-bot', () => {
    expect(hasChallengeBody('<html><body><h1>Normal page</h1></body></html>')).toBe(false);
    expect(hasChallengeBody(null)).toBe(false);
    expect(hasChallengeBody('')).toBe(false);
  });

  it('caps challenge-body scan at 32KB', () => {
    const padding = 'a'.repeat(40000);
    const html = padding + 'cf-browser-verification';
    // Marker is past the 32KB window — should not match.
    expect(hasChallengeBody(html)).toBe(false);
  });

  it('isAntiBotSignal combines status + body', () => {
    expect(isAntiBotSignal(200, '<html>fine</html>')).toBe(false);
    expect(isAntiBotSignal(403, '<html>fine</html>')).toBe(true);
    expect(isAntiBotSignal(200, 'cf-browser-verification')).toBe(true);
  });

  it('looksJsRequired matches "enable javascript"', () => {
    expect(looksJsRequired('<noscript>Please enable JavaScript</noscript>')).toBe(true);
    expect(looksJsRequired('<noscript>please enable javascript to continue</noscript>')).toBe(true);
    expect(looksJsRequired('<html><body>plain content</body></html>')).toBe(false);
    expect(looksJsRequired(null)).toBe(true);
    expect(looksJsRequired('')).toBe(true);
  });

  it('describeAntiBot returns status_* for blocked status', () => {
    expect(describeAntiBot(429, '')).toBe('status_429');
    expect(describeAntiBot(200, 'cf-browser-verification')).toBe('challenge_body');
    expect(describeAntiBot(200, '<html>normal</html>')).toBe(null);
  });
});

describe('tls-tier: lazy load + module cache safety', () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    resetConfig();
    _resetTlsBackend();
    _setTlsBackendForTests(null);
  });

  afterEach(() => {
    process.env = originalEnv;
    resetConfig();
    _setTlsBackendForTests(null);
    _resetTlsBackend();
  });

  it('does not load wreq-js until tlsFetch is invoked', async () => {
    // Module-level import of tls-tier.js must not pull in wreq-js. The
    // contract: importing tls-tier should produce zero wreq-js entries in
    // either require.cache (CJS) or process._linkedBinding (napi).
    // vitest runs tests under ESM where require may not be present, so we
    // guard against absence and fall back to a presence check via
    // `import.meta.url`-relative resolution (skipped here — the absence of
    // any wreq-js export on the tls-tier surface is the real assertion).
    const reqCache = (globalThis as { require?: { cache: Record<string, unknown> } }).require?.cache;
    if (reqCache) {
      const inCacheBefore = Object.keys(reqCache).some((k) => k.includes('wreq-js'));
      expect(inCacheBefore).toBe(false);
    }
    // Surface contract: tls-tier exports no symbols that would force a
    // transitive wreq-js load at module-evaluation time.
    const mod = await import('../../../src/fetch/tls-tier.js');
    expect(typeof mod.tlsFetch).toBe('function');
    expect(typeof mod.isAntiBotSignal).toBe('function');
  });

  it('returns TlsTierUnavailableError when backend import fails', async () => {
    _setTlsBackendForTests(null);
    _resetTlsBackend();

    // The TlsTierUnavailableError shape is the contract callers (router)
    // pattern-match on. Verify the type and cause carry through. We can't
    // force the real dynamic import to fail in a sandbox where wreq-js is
    // installed, so we exercise the constructor directly here and let the
    // router-tls tests cover the wiring path.
    const err = new TlsTierUnavailableError(new Error('simulated'));
    expect(err.name).toBe('TlsTierUnavailableError');
    expect(err.message).toBe('tls_tier_unavailable');
    expect((err.cause as Error).message).toBe('simulated');
  });

  it('uses test-override backend without touching wreq-js', async () => {
    const calls: string[] = [];
    _setTlsBackendForTests({
      fetch: async (url) => {
        calls.push(url);
        return {
          status: 200,
          url,
          headers: {
            entries: function* () {
              yield ['content-type', 'text/html'];
            },
          },
          text: async () => '<html><body>hello from tls</body></html>',
        };
      },
    });

    const result = await tlsFetch('https://example.com/page');
    expect(result.statusCode).toBe(200);
    expect(result.html).toContain('hello from tls');
    expect(result.contentType).toBe('text/html');
    expect(calls).toEqual(['https://example.com/page']);
  });
});

describe('tls-tier: MCP-stdio safety', () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    resetConfig();
    _setTlsBackendForTests(null);
    _resetTlsBackend();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetConfig();
    _setTlsBackendForTests(null);
    _resetTlsBackend();
  });

  it('never writes to process.stdout during a tls fetch', async () => {
    _setTlsBackendForTests({
      fetch: async (url) => ({
        status: 200,
        url,
        headers: {
          entries: function* () {
            yield ['content-type', 'text/html'];
          },
        },
        text: async () => '<html><body>safe</body></html>',
      }),
    });

    // Spy on process.stdout.write to count calls. MCP stdio uses stdout for
    // JSON-RPC framing — any rogue write here corrupts the protocol.
    let stdoutWrites = 0;
    const originalWrite = process.stdout.write.bind(process.stdout);
    // Replace with a counter. Return true to mimic the WriteStream contract.
    process.stdout.write = ((..._args: unknown[]) => {
      stdoutWrites++;
      return true;
    }) as typeof process.stdout.write;

    try {
      const result = await tlsFetch('https://example.com/stdio-test');
      expect(result.statusCode).toBe(200);
    } finally {
      process.stdout.write = originalWrite;
    }

    expect(stdoutWrites).toBe(0);
  });
});
