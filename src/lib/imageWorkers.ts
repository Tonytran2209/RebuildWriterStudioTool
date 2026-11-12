import { authenticatedRailwayFetch } from "./db";

export type ImageWorker = {
  id: string;
  name: string;
  agent: "claude" | "codex";
  preferred: boolean;
  online: boolean | null;
  busy?: boolean;
};
export type ImageJob = {
  id: string;
  suggestion_id: string;
  worker_id: string;
  status: "queued" | "running" | "ready" | "inserted" | "failed";
  error_code: string | null;
  style_id?: string | null;
};

export type ImageStyle = { id: string; name: string; description: string; version: number; source: "managed" | "built-in" };

export async function imageWorkerRequest<T>(railwayUrl: string, path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await authenticatedRailwayFetch(`/api/image-workers${path}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
  }, railwayUrl);
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new Error(result?.error || `Image Worker request failed (${response.status}).`);
  }
  return response.json();
}
