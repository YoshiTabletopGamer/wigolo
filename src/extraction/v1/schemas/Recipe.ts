import { extractJsonLd } from '../../jsonld.js';
import { extractRecipe } from '../recipe.js';

export interface RecipeData {
  name: string;
  description?: string;
  ingredients: string[];
  instructions: string[];
  totalTime?: string;
  prepTime?: string;
  cookTime?: string;
  recipeYield?: string;
  author?: string;
  date?: string;
}

export async function extractRecipeSchema(html: string, url: string): Promise<RecipeData | null> {
  if (!html) return null;

  const fromJsonLd = tryJsonLd(html);
  if (fromJsonLd) return fromJsonLd;

  return tryMarkdownFallback(html, url);
}

function tryJsonLd(html: string): RecipeData | null {
  let blocks: Record<string, unknown>[];
  try {
    blocks = extractJsonLd(html);
  } catch {
    return null;
  }

  const recipe = blocks.find((block) => typeIncludes(block['@type'], 'recipe'));
  if (!recipe) return null;

  const name = stringField(recipe['name']);
  if (!name) return null;

  const ingredients = stringArray(recipe['recipeIngredient']);
  const instructions = readInstructions(recipe['recipeInstructions']);

  const data: RecipeData = {
    name,
    ingredients,
    instructions,
  };
  const description = stringField(recipe['description']);
  if (description) data.description = description;
  const totalTime = stringField(recipe['totalTime']);
  if (totalTime) data.totalTime = totalTime;
  const prepTime = stringField(recipe['prepTime']);
  if (prepTime) data.prepTime = prepTime;
  const cookTime = stringField(recipe['cookTime']);
  if (cookTime) data.cookTime = cookTime;
  const recipeYield = stringField(recipe['recipeYield']);
  if (recipeYield) data.recipeYield = recipeYield;
  const author = readAuthor(recipe['author']);
  if (author) data.author = author;
  const date = stringField(recipe['datePublished']);
  if (date) data.date = date;

  return data;
}

async function tryMarkdownFallback(html: string, url: string): Promise<RecipeData | null> {
  const result = await extractRecipe(html, url);
  if (!result) return null;

  const name = (result.title ?? '').trim();
  if (!name) return null;

  const ingredients = parseSection(result.markdown, '## Ingredients');
  const instructions = parseNumberedSection(result.markdown, '## Instructions');

  const data: RecipeData = {
    name,
    ingredients,
    instructions,
  };
  if (result.metadata.description) data.description = result.metadata.description;
  if (result.metadata.author) data.author = result.metadata.author;
  if (result.metadata.date) data.date = result.metadata.date;

  return data;
}

function parseSection(markdown: string, header: string): string[] {
  if (!markdown) return [];
  const idx = markdown.indexOf(header);
  if (idx < 0) return [];
  const rest = markdown.slice(idx + header.length);
  const stop = rest.indexOf('\n## ');
  const slice = stop >= 0 ? rest.slice(0, stop) : rest;
  const out: string[] = [];
  for (const line of slice.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('- ')) {
      out.push(trimmed.slice(2).trim());
    }
  }
  return out;
}

function parseNumberedSection(markdown: string, header: string): string[] {
  if (!markdown) return [];
  const idx = markdown.indexOf(header);
  if (idx < 0) return [];
  const rest = markdown.slice(idx + header.length);
  const stop = rest.indexOf('\n## ');
  const slice = stop >= 0 ? rest.slice(0, stop) : rest;
  const out: string[] = [];
  for (const line of slice.split('\n')) {
    const trimmed = line.trim();
    const m = /^\d+\.\s+(.*)$/.exec(trimmed);
    if (m) out.push(m[1].trim());
  }
  return out;
}

function typeIncludes(raw: unknown, want: string): boolean {
  const target = want.toLowerCase();
  if (typeof raw === 'string') return normalizeType(raw) === target;
  if (Array.isArray(raw)) {
    return raw.some((entry) => typeof entry === 'string' && normalizeType(entry) === target);
  }
  return false;
}

function normalizeType(raw: string): string {
  const tail = raw.split(/[/#:]/).pop() ?? raw;
  return tail.toLowerCase();
}

function stringField(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string') {
      const trimmed = entry.trim();
      if (trimmed) out.push(trimmed);
    }
  }
  return out;
}

function readInstructions(value: unknown): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string') {
      const trimmed = entry.trim();
      if (trimmed) out.push(trimmed);
      continue;
    }
    if (entry && typeof entry === 'object') {
      const text = (entry as Record<string, unknown>)['text'];
      if (typeof text === 'string') {
        const trimmed = text.trim();
        if (trimmed) out.push(trimmed);
      }
    }
  }
  return out;
}

function readAuthor(value: unknown): string | undefined {
  if (typeof value === 'string') return stringField(value);
  if (Array.isArray(value)) {
    for (const entry of value) {
      const name = readAuthor(entry);
      if (name) return name;
    }
    return undefined;
  }
  if (value && typeof value === 'object') {
    const name = (value as Record<string, unknown>)['name'];
    if (typeof name === 'string') return stringField(name);
  }
  return undefined;
}
