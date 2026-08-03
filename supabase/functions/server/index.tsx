import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import * as kv from "./kv_store.tsx";

const app = new Hono();

app.use('*', logger(console.log));
app.use(
  "/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
  }),
);

app.get("/make-server-48d8062f/health", (c) => {
  return c.json({ status: "ok" });
});

// ── Articles ────────────────────────────────────────────────────────────────

app.get("/make-server-48d8062f/articles", async (c) => {
  const articles = await kv.get("writer:articles") ?? [];
  return c.json(articles);
});

app.post("/make-server-48d8062f/articles", async (c) => {
  const article = await c.req.json();
  const articles = await kv.get("writer:articles") ?? [];
  const updated = [article, ...articles.filter((a: any) => a.id !== article.id)];
  await kv.set("writer:articles", updated);
  return c.json({ ok: true });
});

app.put("/make-server-48d8062f/articles/:id", async (c) => {
  const id = c.req.param("id");
  const updates = await c.req.json();
  const articles = await kv.get("writer:articles") ?? [];
  const updated = articles.map((a: any) =>
    a.id === id ? { ...a, ...updates, updatedAt: new Date().toISOString() } : a
  );
  await kv.set("writer:articles", updated);
  return c.json({ ok: true });
});

app.delete("/make-server-48d8062f/articles/:id", async (c) => {
  const id = c.req.param("id");
  const articles = await kv.get("writer:articles") ?? [];
  await kv.set("writer:articles", articles.filter((a: any) => a.id !== id));
  return c.json({ ok: true });
});

// ── Config ──────────────────────────────────────────────────────────────────

app.get("/make-server-48d8062f/config", async (c) => {
  const config = await kv.get("writer:config");
  return c.json(config ?? null);
});

app.post("/make-server-48d8062f/config", async (c) => {
  const config = await c.req.json();
  await kv.set("writer:config", config);
  return c.json({ ok: true });
});

// ── Files ───────────────────────────────────────────────────────────────────

app.get("/make-server-48d8062f/files", async (c) => {
  const files = await kv.get("writer:files") ?? [];
  return c.json(files);
});

app.post("/make-server-48d8062f/files", async (c) => {
  const files = await c.req.json();
  await kv.set("writer:files", files);
  return c.json({ ok: true });
});

Deno.serve(app.fetch);
