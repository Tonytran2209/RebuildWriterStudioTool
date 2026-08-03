import type { Article, AppConfig, DocumentFile } from '../types';
import { kvGet, kvSet } from './supabase';

// ── Keys ──────────────────────────────────────────────────────────────────────

const KEYS = {
  articles: 'writer:articles',
  config:   'writer:config',
  files:    'writer:files',
} as const;

// ── Articles ──────────────────────────────────────────────────────────────────

export async function fetchArticles(): Promise<Article[]> {
  return (await kvGet<Article[]>(KEYS.articles)) ?? [];
}

export async function saveArticle(article: Article): Promise<void> {
  const list = (await kvGet<Article[]>(KEYS.articles)) ?? [];
  const next = [article, ...list.filter(a => a.id !== article.id)];
  await kvSet(KEYS.articles, next);
}

export async function updateArticle(id: string, updates: Partial<Article>): Promise<void> {
  const list = (await kvGet<Article[]>(KEYS.articles)) ?? [];
  const next = list.map(a =>
    a.id === id ? { ...a, ...updates, updatedAt: new Date().toISOString() } : a
  );
  await kvSet(KEYS.articles, next);
}

export async function deleteArticle(id: string): Promise<void> {
  const list = (await kvGet<Article[]>(KEYS.articles)) ?? [];
  await kvSet(KEYS.articles, list.filter(a => a.id !== id));
}

// ── Config ────────────────────────────────────────────────────────────────────

export async function fetchConfig(): Promise<AppConfig | null> {
  return kvGet<AppConfig>(KEYS.config);
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await kvSet(KEYS.config, config);
}

// ── Files ─────────────────────────────────────────────────────────────────────

export async function fetchFiles(): Promise<DocumentFile[]> {
  return (await kvGet<DocumentFile[]>(KEYS.files)) ?? [];
}

export async function saveFiles(files: DocumentFile[]): Promise<void> {
  await kvSet(KEYS.files, files);
}

// ── Railway health check ───────────────────────────────────────────────────────

export async function pingRailway(url: string): Promise<{ ok: boolean; providers?: Record<string, boolean> }> {
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { ok: false };
    const data = await res.json();
    return { ok: true, providers: data.providers };
  } catch {
    return { ok: false };
  }
}
