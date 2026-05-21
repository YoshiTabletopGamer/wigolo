import type { ExtractInput, ExtractOutput, StageResult } from '../types.js';
import type { SmartRouter } from '../fetch/router.js';
import { extractMetadata, extractSelector, extractTables } from '../extraction/extract.js';
import {
  extractWithSchema,
  extractWithSchemaDetailedAsync,
} from '../extraction/schema.js';
import { extractJsonLd } from '../extraction/jsonld.js';
import { extractStructured } from '../extraction/structured.js';
import { getCachedContent, isExpired } from '../cache/store.js';
import { fetchWithPlaywright } from '../fetch/playwright-tier.js';
import { createLogger } from '../logger.js';
import {
  isNamedSchemaType,
  extractNamedSchema,
  NAMED_SCHEMAS,
} from '../extraction/v1/schemas/index.js';
import { isLocalLlmEnabled, extractWithLocalLlm } from '../extraction/v1/local-llm.js';

const log = createLogger('extract');

async function resolveHtml(
  input: ExtractInput,
  router: SmartRouter,
): Promise<{ html: string; sourceUrl?: string }> {
  if (input.execution_mode === 'stealth' && input.url) {
    const pw = await fetchWithPlaywright(input.url);
    return { html: pw.html, sourceUrl: input.url };
  }

  if (input.url) {
    const cached = getCachedContent(input.url);
    if (cached && !isExpired(cached)) {
      log.info('Using cached HTML', { url: input.url });
      return { html: cached.rawHtml, sourceUrl: cached.url };
    }

    const raw = await router.fetch(input.url, {
      renderJs: 'auto',
      useAuth: false,
    });
    return { html: raw.html, sourceUrl: raw.finalUrl };
  }

  return { html: input.html! };
}

export async function handleExtract(
  input: ExtractInput,
  router: SmartRouter,
): Promise<StageResult<ExtractOutput>> {
  const mode = input.mode ?? 'metadata';

  if (!input.url && !input.html) {
    return {
      ok: false,
      error: 'invalid_input',
      error_reason: 'Either url or html must be provided',
      stage: 'extract',
    };
  }

  if (input.named_schema && input.schema) {
    return {
      ok: false,
      error: 'invalid_input',
      error_reason: 'schema and named_schema are mutually exclusive',
      stage: 'extract',
    };
  }

  if (input.named_schema && !isNamedSchemaType(input.named_schema)) {
    return {
      ok: false,
      error: 'invalid_input',
      error_reason: `Unknown named_schema. Valid: ${NAMED_SCHEMAS.join(', ')}`,
      stage: 'extract',
    };
  }

  if (mode === 'selector' && !input.css_selector) {
    return {
      ok: false,
      error: 'invalid_input',
      error_reason: 'css_selector is required when mode is "selector"',
      stage: 'extract',
    };
  }

  if (mode === 'schema' && !input.named_schema && (!input.schema || !input.schema.properties)) {
    return {
      ok: false,
      error: 'invalid_input',
      error_reason: 'schema is required when mode is "schema" and must have properties',
      stage: 'extract',
    };
  }

  try {
    const { html, sourceUrl } = await resolveHtml(input, router);

    if (input.named_schema) {
      const namedData = await extractNamedSchema(input.named_schema, html, sourceUrl ?? input.url ?? '');
      if (namedData === null) {
        return {
          ok: true,
          data: {
            data: {},
            source_url: sourceUrl,
            mode: 'schema',
            error: `No ${input.named_schema} data found on page`,
          },
        };
      }
      return {
        ok: true,
        data: {
          data: namedData as unknown as Record<string, unknown>,
          source_url: sourceUrl,
          mode: 'schema',
        },
      };
    }

    if (mode === 'schema' && input.schema && isLocalLlmEnabled()) {
      const llmData = await extractWithLocalLlm({
        schema: input.schema as unknown as Record<string, unknown>,
        html,
        url: sourceUrl ?? input.url ?? '',
      });
      return {
        ok: true,
        data: {
          data: (llmData ?? {}) as Record<string, unknown>,
          source_url: sourceUrl,
          mode: 'schema',
        },
      };
    }

    let data: ExtractOutput['data'];

    switch (mode) {
      case 'selector':
        data = extractSelector(html, input.css_selector!, input.multiple ?? false);
        break;
      case 'tables':
        data = extractTables(html);
        break;
      case 'structured':
        data = extractStructured(html);
        break;
      case 'schema': {
        const schema = input.schema!;
        if (Array.isArray(schema.required) && schema.required.length > 0) {
          const detailed = await extractWithSchemaDetailedAsync(html, schema);
          data = detailed.values;
          if (detailed.warnings.length > 0) {
            return {
              ok: true,
              data: {
                data,
                source_url: sourceUrl,
                mode,
                warnings: detailed.warnings,
              },
            };
          }
        } else {
          data = extractWithSchema(html, schema);
        }
        break;
      }
      case 'metadata':
      default: {
        const meta = extractMetadata(html);
        const jsonld = extractJsonLd(html);
        if (jsonld.length > 0) {
          meta.jsonld = jsonld;
        }
        data = meta;
        break;
      }
    }

    if (mode === 'tables' && Array.isArray(data) && data.length === 0) {
      const hint =
        input.execution_mode === 'stealth'
          ? 'no_tables_detected — page genuinely contains no tables'
          : 'no_tables_detected — page may require JavaScript; retry with execution_mode: "stealth"';
      return {
        ok: false,
        error: 'no_tables_detected',
        error_reason: 'No tables found on page',
        stage: 'extract',
        hint,
      };
    }

    return { ok: true, data: { data, source_url: sourceUrl, mode } };
  } catch (err) {
    log.error('Extract failed', { url: input.url, error: String(err) });
    return {
      ok: false,
      error: 'extract_failed',
      error_reason: err instanceof Error ? err.message : String(err),
      stage: 'extract',
    };
  }
}
