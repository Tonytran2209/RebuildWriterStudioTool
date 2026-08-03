import { projectId } from '../../utils/supabase/info';
import type { Article, AppConfig, DocumentFile } from '../types';

const BASE = `https://${projectId}.supabase.co/functions/v1/make-server-48d8062f`;

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  return res.json();
}

// Articles
export const fetchArticles = (): Promise<Article[]> => api('/articles');
export const saveArticle = (article: Article): Promise<{ ok: boolean }> =>
  api('/articles', { method: 'POST', body: JSON.stringify(article) });
export const updateArticle = (id: string, updates: Partial<Article>): Promise<{ ok: boolean }> =>
  api(`/articles/${id}`, { method: 'PUT', body: JSON.stringify(updates) });
export const deleteArticle = (id: string): Promise<{ ok: boolean }> =>
  api(`/articles/${id}`, { method: 'DELETE' });

// Config
export const fetchConfig = (): Promise<AppConfig | null> => api('/config');
export const saveConfig = (config: AppConfig): Promise<{ ok: boolean }> =>
  api('/config', { method: 'POST', body: JSON.stringify(config) });

// Files
export const fetchFiles = (): Promise<DocumentFile[]> => api('/files');
export const saveFiles = (files: DocumentFile[]): Promise<{ ok: boolean }> =>
  api('/files', { method: 'POST', body: JSON.stringify(files) });
