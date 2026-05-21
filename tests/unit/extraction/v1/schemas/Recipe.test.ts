import { describe, it, expect } from 'vitest';
import { extractRecipeSchema } from '../../../../../src/extraction/v1/schemas/Recipe.js';

function htmlWithJsonLd(obj: unknown): string {
  return `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify(obj)}</script></head><body></body></html>`;
}

const VALID_RECIPE = {
  '@context': 'https://schema.org',
  '@type': 'Recipe',
  name: 'Classic Pancakes',
  description: 'Fluffy breakfast pancakes.',
  recipeIngredient: ['1 cup flour', '2 eggs', '1 cup milk'],
  recipeInstructions: [
    { '@type': 'HowToStep', text: 'Mix dry ingredients.' },
    { '@type': 'HowToStep', text: 'Whisk in wet ingredients.' },
    'Cook on a hot griddle.',
  ],
  totalTime: 'PT15M',
  prepTime: 'PT5M',
  cookTime: 'PT10M',
  recipeYield: '4 servings',
  author: { '@type': 'Person', name: 'Chef Bob' },
  datePublished: '2024-01-02',
};

describe('extractRecipeSchema', () => {
  it('extracts a valid Recipe JSON-LD block', async () => {
    const html = htmlWithJsonLd(VALID_RECIPE);
    const result = await extractRecipeSchema(html, 'https://example.com/r');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('Classic Pancakes');
    expect(result!.description).toBe('Fluffy breakfast pancakes.');
    expect(result!.ingredients).toEqual(['1 cup flour', '2 eggs', '1 cup milk']);
    expect(result!.instructions).toEqual([
      'Mix dry ingredients.',
      'Whisk in wet ingredients.',
      'Cook on a hot griddle.',
    ]);
    expect(result!.totalTime).toBe('PT15M');
    expect(result!.prepTime).toBe('PT5M');
    expect(result!.cookTime).toBe('PT10M');
    expect(result!.recipeYield).toBe('4 servings');
    expect(result!.author).toBe('Chef Bob');
    expect(result!.date).toBe('2024-01-02');
  });

  it('tolerates URI-prefixed @type values', async () => {
    const html = htmlWithJsonLd({
      ...VALID_RECIPE,
      '@type': 'https://schema.org/Recipe',
    });
    const result = await extractRecipeSchema(html, 'https://example.com/r');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('Classic Pancakes');
  });

  it('returns null when no JSON-LD recipe and no markdown fallback', async () => {
    const html = '<!doctype html><html><body><h1>nothing</h1></body></html>';
    const result = await extractRecipeSchema(html, 'https://example.com/r');
    expect(result).toBeNull();
  });

  it('returns null when @type is wrong', async () => {
    const html = htmlWithJsonLd({ ...VALID_RECIPE, '@type': 'Article' });
    const result = await extractRecipeSchema(html, 'https://example.com/r');
    expect(result).toBeNull();
  });

  it('returns null on empty input', async () => {
    expect(await extractRecipeSchema('', 'https://example.com/r')).toBeNull();
  });

  it('returns null on malformed JSON-LD', async () => {
    const html =
      '<!doctype html><html><head><script type="application/ld+json">{ not json }</script></head><body></body></html>';
    const result = await extractRecipeSchema(html, 'https://example.com/r');
    expect(result).toBeNull();
  });
});
