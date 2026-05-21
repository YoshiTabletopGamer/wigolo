import { extractNews } from '../news.js';

export interface ArticleData {
  title: string;
  body: string;
  url: string;
  author?: string;
  date?: string;
  description?: string;
  language?: string;
}

export async function extractArticle(html: string, url: string): Promise<ArticleData | null> {
  const result = await extractNews(html, url);
  if (!result) return null;

  const title = (result.title ?? '').trim();
  const body = (result.markdown ?? '').trim();
  if (!title && !body) return null;

  const meta = result.metadata ?? {};
  const data: ArticleData = {
    title,
    body,
    url,
  };
  if (meta.author) data.author = meta.author;
  if (meta.date) data.date = meta.date;
  if (meta.description) data.description = meta.description;
  if (meta.language) data.language = meta.language;

  return data;
}
