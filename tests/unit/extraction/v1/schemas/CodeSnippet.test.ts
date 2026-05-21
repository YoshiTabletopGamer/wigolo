import { describe, it, expect } from 'vitest';
import { extractCodeSnippet } from '../../../../../src/extraction/v1/schemas/CodeSnippet.js';

describe('extractCodeSnippet', () => {
  const url = 'https://example.com/post';

  it('returns the largest pre>code block with language', async () => {
    const html = `<!doctype html><html><body>
      <pre><code class="language-ts">const x: number = 1; const y = x + 2; const z = y * y; // sample</code></pre>
      <pre><code class="language-py">print(1)</code></pre>
    </body></html>`;
    const result = await extractCodeSnippet(html, url);
    expect(result).not.toBeNull();
    expect(result!.code).toContain('const x: number');
    expect(result!.language).toBe('ts');
    expect(result!.url).toBe(url);
  });

  it('reads language from pre.class when code has no class', async () => {
    const html = `<!doctype html><html><body>
      <pre class="language-rust"><code>fn main() { println!("hello"); let x = 42; let y = x + 1; }</code></pre>
    </body></html>`;
    const result = await extractCodeSnippet(html, url);
    expect(result!.language).toBe('rust');
  });

  it('reads filename from figcaption and description from prior paragraph', async () => {
    const html = `<!doctype html><html><body>
      <p>This is a short description of the snippet that follows.</p>
      <figure>
        <figcaption>main.ts</figcaption>
        <pre><code class="language-ts">export const greet = (name: string): string => "hello " + name;</code></pre>
      </figure>
    </body></html>`;
    const result = await extractCodeSnippet(html, url);
    expect(result).not.toBeNull();
    expect(result!.filename).toBe('main.ts');
  });

  it('returns null when no code block is present', async () => {
    expect(await extractCodeSnippet('<!doctype html><html><body><p>no code</p></body></html>', url)).toBeNull();
  });

  it('returns null when largest code is below threshold', async () => {
    const html = '<!doctype html><html><body><pre><code>x=1</code></pre></body></html>';
    expect(await extractCodeSnippet(html, url)).toBeNull();
  });

  it('returns null on empty input', async () => {
    expect(await extractCodeSnippet('', url)).toBeNull();
  });
});
