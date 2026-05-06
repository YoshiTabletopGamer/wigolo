import { chromium, type Browser, type BrowserContext } from 'playwright';
import { existsSync } from 'node:fs';
import { createLogger } from '../logger.js';

const log = createLogger('playwright-tier');

export interface InstallStatus {
  installed: boolean;
  hint?: string;
}

export async function detectPlaywrightInstall(): Promise<InstallStatus> {
  try {
    const exec = chromium.executablePath();
    if (exec && existsSync(exec)) return { installed: true };
    return { installed: false, hint: 'npx playwright install chromium' };
  } catch {
    return { installed: false, hint: 'npx playwright install chromium' };
  }
}

export function shouldEscalate(body: string): boolean {
  if (!body) return true;
  if (body.length < 500) return true;
  if (/enable javascript/i.test(body)) return true;
  return false;
}

let _browser: Browser | null = null;
let _ctx: BrowserContext | null = null;

export async function getDaemonBrowser(): Promise<{ browser: Browser; context: BrowserContext }> {
  if (_browser && _ctx) return { browser: _browser, context: _ctx };
  const status = await detectPlaywrightInstall();
  if (!status.installed) {
    const err = new Error('playwright_not_installed') as Error & { hint?: string };
    err.hint = status.hint;
    throw err;
  }
  _browser = await chromium.launch({ headless: true });
  _ctx = await _browser.newContext();
  log.info('Playwright daemon browser launched');
  return { browser: _browser, context: _ctx };
}

export async function closeDaemonBrowser(): Promise<void> {
  if (_ctx) { await _ctx.close(); _ctx = null; }
  if (_browser) { await _browser.close(); _browser = null; }
}

export async function fetchWithPlaywright(url: string, opts: { timeoutMs?: number } = {}): Promise<{ html: string; text: string }> {
  const { context } = await getDaemonBrowser();
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opts.timeoutMs ?? 30000 });
    const html = await page.content();
    const text = await page.evaluate(() => document.body?.innerText ?? '');
    return { html, text };
  } finally {
    await page.close();
  }
}
