import { projectId, publicAnonKey } from '../../utils/supabase/info';
import type { Article, AppConfig, DocumentFile } from '../types';

/**
 * Priority: if RAILWAY_URL is stored in localStorage, call Railway backend.
 * Otherwise fall back to Supabase edge function directly.
 */
function getBaseUrl(): string {
  const railwayUrl = localStorage.getItem('writer:railwayUrl');
  if (railwayUrl) return railwayUrl.replace(/\/$/, '');
  return `https://${projectId}.supabase.co/functions/v1/make-server-48d8062f`;
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const base = getBaseUrl();
  const isSupabase = base.includes('supabase.co');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  };

  // Supabase edge functions require anon key auth
  if (isSupabase) {
    headers['Authorization'] = `Bearer ${publicAnonKey}`;
  }

  const res = await fetch(`${base}${path}`, { ...options, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
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

// Ping Railway backend to check availability
export async function pingRailway(url: string): Promise<{ ok: boolean; providers?: Record<string, boolean> }> {
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { ok: false };
    const data = await res.json();
    return { ok: true, providers: data.providers };
  } catch {
    return { ok: false };
  }
}
