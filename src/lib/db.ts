import type { Article, AppConfig, DocumentFile } from '../types';

function resolveRailwayUrl(explicitUrl?: string): string {
  const saved = typeof window !== 'undefined' ? localStorage.getItem('writer:railwayUrl') : null;
  const sameOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const url = explicitUrl?.trim() || saved?.trim() || sameOrigin;
  if (!url) throw new Error('Chưa cấu hình Railway URL.');
  return url.replace(/\/$/, '');
}

async function railwayRequest<T>(path: string, init?: RequestInit, railwayUrl?: string): Promise<T> {
  const url = `${resolveRailwayUrl(railwayUrl)}${path}`;
  const method = (init?.method ?? 'GET').toUpperCase();
  const maxAttempts = method === 'GET' ? 3 : 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) throw error;
      await new Promise(resolve => setTimeout(resolve, attempt * 750));
      continue;
    }

    const payload = await response.json().catch(() => ({ error: response.statusText }));
    const transient = [502, 503, 504].includes(response.status);

    if (response.ok) return payload as T;
    if (!transient || attempt === maxAttempts) {
      throw new Error(payload.error || `Railway error ${response.status}`);
    }
    lastError = new Error(payload.error || `Railway error ${response.status}`);

    await new Promise(resolve => setTimeout(resolve, attempt * 750));
  }

  throw lastError instanceof Error ? lastError : new Error('Không thể kết nối Railway.');
}

// ── Articles ──────────────────────────────────────────────────────────────────

export async function fetchArticles(): Promise<Article[]> {
  return railwayRequest<Article[]>('/api/articles');
}

export async function saveArticle(article: Article): Promise<Article> {
  const result = await railwayRequest<{ article: Article }>('/api/articles', jsonRequest('POST', article));
  return result.article;
}

export async function updateArticle(id: string, updates: Partial<Article>): Promise<Article> {
  const result = await railwayRequest<{ article: Article }>(`/api/articles/${encodeURIComponent(id)}`, jsonRequest('PUT', updates));
  return result.article;
}

export async function deleteArticle(id: string): Promise<void> {
  await railwayRequest(`/api/articles/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ── Config ────────────────────────────────────────────────────────────────────

export async function fetchConfig(): Promise<AppConfig | null> {
  return railwayRequest<AppConfig | null>('/api/config');
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await railwayRequest('/api/config', jsonRequest('POST', config), config.railwayUrl);
}

// ── Files ─────────────────────────────────────────────────────────────────────

export async function fetchFiles(): Promise<DocumentFile[]> {
  return railwayRequest<DocumentFile[]>('/api/files');
}

export async function saveFiles(files: DocumentFile[], railwayUrl: string): Promise<void> {
  await railwayRequest('/api/files', jsonRequest('POST', files), railwayUrl);
}

function jsonRequest(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
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
