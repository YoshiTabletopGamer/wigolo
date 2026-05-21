import { createLogger } from '../../logger.js';

const log = createLogger('extract');

const MAX_HTML_CHARS = 50000;
const REQUEST_TIMEOUT_MS = 30_000;

export function isLocalLlmEnabled(): boolean {
  return !!process.env['WIGOLO_LLM_PROVIDER'];
}

export interface LocalLlmRequest {
  schema: Record<string, unknown>;
  html: string;
  url: string;
}

export async function extractWithLocalLlm(
  request: LocalLlmRequest,
): Promise<Record<string, unknown> | null> {
  if (!isLocalLlmEnabled()) return null;

  const provider = process.env['WIGOLO_LLM_PROVIDER']!;
  const endpoint = provider.includes('/chat/completions')
    ? provider
    : provider.replace(/\/+$/, '') + '/v1/chat/completions';
  const model = process.env['WIGOLO_LLM_MODEL'] ?? 'local';

  const htmlSlice = request.html.length > MAX_HTML_CHARS
    ? request.html.slice(0, MAX_HTML_CHARS)
    : request.html;

  const prompt =
    'Extract data matching this JSON schema from the HTML. Return only valid JSON.\n' +
    `Schema: ${JSON.stringify(request.schema)}\n` +
    `URL: ${request.url}\n` +
    `HTML: ${htmlSlice}`;

  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
  };

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    log.error('local llm request failed', { error: String(err) });
    throw err;
  }

  if (!response.ok) {
    throw new Error(`Local LLM endpoint returned ${response.status}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('Local LLM response missing message content');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(`Local LLM returned invalid JSON: ${String(err)}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Local LLM response is not a JSON object');
  }
  return parsed as Record<string, unknown>;
}
