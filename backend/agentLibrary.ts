import crypto from "node:crypto"
import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import {
  kvGet,
  kvSet,
  tableAvailable,
  tableDeleteWhere,
  tableSelect,
  tableUpsert,
} from "./supabase.ts"

const execFileAsync = promisify(execFile)
const PROJECT_ID = "writer-studio"
const CURRENT_VERSION_KEY = `agent-library:${PROJECT_ID}:current`
const MAX_DOCUMENT_CHARS = 120_000
const DEFAULT_CHUNK_CHARS = 1_800
let activeSync: Promise<Awaited<ReturnType<typeof performAgentLibrarySync>>> | null = null

export type AgentLibraryLayer = "project" | "design" | "backend" | "database" | "policy"

const LIBRARY_FILES: Array<{ path: string; layer: AgentLibraryLayer }> = [
  { path: "project.md", layer: "project" },
  { path: "design/design.md", layer: "design" },
  { path: "design/components.md", layer: "design" },
  { path: "design/flows.md", layer: "design" },
  { path: "design/sources.md", layer: "design" },
  { path: "backend/workflow.md", layer: "backend" },
  { path: "backend/api-contracts.md", layer: "backend" },
  { path: "database/data-model.md", layer: "database" },
  { path: "database/storage.md", layer: "database" },
  { path: "policies/ownership.md", layer: "policy" },
  { path: "policies/automation.md", layer: "policy" },
]

type IndexedDocument = {
  path: string
  layer: AgentLibraryLayer
  content: string
  contentHash: string
}

type LibraryChunk = {
  path: string
  layer: AgentLibraryLayer
  chunkIndex: number
  heading: string
  content: string
  contentHash: string
}

function hash(value: string) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex")
}

function libraryRoot() {
  return path.resolve(
    process.env.AGENT_LIBRARY_ROOT ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), "../.agent-hub"),
  )
}

function repositoryRoot() {
  return path.resolve(libraryRoot(), "..")
}

async function sourceCommit(contentHash: string) {
  const configured = process.env.AGENT_LIBRARY_SOURCE_COMMIT ?? process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA
  if (configured) return configured.trim().slice(0, 128)
  try {
    const { stdout } = await execFileAsync("git", ["-C", repositoryRoot(), "rev-parse", "HEAD"])
    return stdout.trim()
  } catch {
    // A Railway deployment may intentionally omit .git. The content hash still
    // gives this immutable index version a stable identity.
    return `content-${contentHash.slice(0, 16)}`
  }
}

async function readCanonicalDocuments(): Promise<IndexedDocument[]> {
  const root = libraryRoot()
  const documents: IndexedDocument[] = []
  for (const entry of LIBRARY_FILES) {
    const absolutePath = path.resolve(root, entry.path)
    if (!absolutePath.startsWith(`${root}${path.sep}`))
      throw new Error(`Agent library path is outside its root: ${entry.path}`)
    let content: string
    try {
      content = await readFile(absolutePath, "utf8")
    } catch {
      throw new Error(`Canonical agent library document is missing: .agent-hub/${entry.path}`)
    }
    if (content.length > MAX_DOCUMENT_CHARS)
      throw new Error(`Agent library document exceeds ${MAX_DOCUMENT_CHARS} characters: ${entry.path}`)
    documents.push({ path: entry.path, layer: entry.layer, content, contentHash: hash(content) })
  }
  return documents
}

function headingOf(block: string, fallback: string) {
  return block.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim() ?? fallback
}

function splitLongText(value: string, maxChars: number) {
  const result: string[] = []
  let remaining = value.trim()
  while (remaining.length > maxChars) {
    const boundary = Math.max(remaining.lastIndexOf("\n\n", maxChars), remaining.lastIndexOf("\n", maxChars), remaining.lastIndexOf(" ", maxChars))
    const index = boundary > Math.floor(maxChars * 0.55) ? boundary : maxChars
    result.push(remaining.slice(0, index).trim())
    remaining = remaining.slice(index).trim()
  }
  if (remaining) result.push(remaining)
  return result
}

function chunkDocument(document: IndexedDocument): LibraryChunk[] {
  const blocks = document.content.split(/(?=^#{1,3}\s+)/m).filter((block) => block.trim())
  const chunks: LibraryChunk[] = []
  for (const block of blocks) {
    const heading = headingOf(block, document.path)
    for (const content of splitLongText(block, DEFAULT_CHUNK_CHARS)) {
      chunks.push({
        path: document.path,
        layer: document.layer,
        chunkIndex: chunks.length,
        heading,
        content,
        contentHash: hash(content),
      })
    }
  }
  return chunks
}

async function assertIndexTables() {
  const ready = await Promise.all([
    tableAvailable("agent_library_versions"),
    tableAvailable("agent_library_documents"),
    tableAvailable("agent_library_chunks"),
  ])
  if (ready.every(Boolean)) return
  throw new Error("Agent Library tables are unavailable. Apply Supabase migration 007_agent_library_index.sql first.")
}

async function performAgentLibrarySync() {
  await assertIndexTables()
  const documents = await readCanonicalDocuments()
  const contentHash = hash(documents.map((document) => `${document.path}:${document.contentHash}`).join("\n"))
  const commit = await sourceCommit(contentHash)
  const versionId = hash(`${PROJECT_ID}:${commit}:${contentHash}`).slice(0, 40)
  const chunks = documents.flatMap(chunkDocument)
  const manifest = {
    schema: "agent-hub/index-manifest/v1",
    projectId: PROJECT_ID,
    sourceCommit: commit,
    sourceRoot: ".agent-hub",
    documents: documents.map(({ path: documentPath, layer, contentHash: documentHash }) => ({ path: documentPath, layer, contentHash: documentHash })),
  }

  const [indexedDocuments, indexedChunks] = await Promise.all([
    tableSelect<any>("agent_library_documents", (request) => request.select("path").eq("library_version_id", versionId)),
    tableSelect<any>("agent_library_chunks", (request) => request.select("chunk_index").eq("library_version_id", versionId)),
  ])
  if (indexedDocuments.length === documents.length && indexedChunks.length === chunks.length) {
    await kvSet(CURRENT_VERSION_KEY, { versionId, sourceCommit: commit, contentHash, indexedAt: new Date().toISOString() })
    return { projectId: PROJECT_ID, versionId, sourceCommit: commit, documentCount: documents.length, chunkCount: chunks.length, cacheHit: true }
  }

  await tableUpsert("agent_library_versions", {
    id: versionId,
    project_id: PROJECT_ID,
    source_commit: commit,
    source_root: ".agent-hub",
    content_hash: contentHash,
    manifest,
    document_count: documents.length,
    chunk_count: chunks.length,
    indexed_at: new Date().toISOString(),
  }, "id")
  // Rewriting a version is idempotent and prevents stale chunks when a locally
  // indexed, uncommitted document changes during development.
  await tableDeleteWhere("agent_library_chunks", "library_version_id", versionId)
  await tableDeleteWhere("agent_library_documents", "library_version_id", versionId)
  for (const document of documents) {
    await tableUpsert("agent_library_documents", {
      library_version_id: versionId,
      project_id: PROJECT_ID,
      path: document.path,
      layer: document.layer,
      content_hash: document.contentHash,
      content: document.content,
      metadata: { charCount: document.content.length },
      indexed_at: new Date().toISOString(),
    }, "library_version_id,path")
  }
  for (const chunk of chunks) {
    await tableUpsert("agent_library_chunks", {
      library_version_id: versionId,
      project_id: PROJECT_ID,
      path: chunk.path,
      layer: chunk.layer,
      chunk_index: chunk.chunkIndex,
      heading: chunk.heading,
      content: chunk.content,
      content_hash: chunk.contentHash,
    }, "library_version_id,path,chunk_index")
  }
  await kvSet(CURRENT_VERSION_KEY, { versionId, sourceCommit: commit, contentHash, indexedAt: new Date().toISOString() })
  return { projectId: PROJECT_ID, versionId, sourceCommit: commit, documentCount: documents.length, chunkCount: chunks.length, cacheHit: false }
}

export function syncAgentLibrary() {
  if (activeSync) return activeSync
  const operation = performAgentLibrarySync()
  activeSync = operation
  return operation.finally(() => {
    if (activeSync === operation) activeSync = null
  })
}

async function currentVersion() {
  const current = await kvGet<{ versionId?: string }>(CURRENT_VERSION_KEY)
  if (!current?.versionId) throw new Error("Agent Library has not been indexed. Run the sync endpoint first.")
  return current.versionId
}

function queryTerms(query: string) {
  return [...new Set(query.toLocaleLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? [])].slice(0, 20)
}

function scoreChunk(chunk: any, terms: string[]) {
  const heading = String(chunk.heading ?? "").toLocaleLowerCase()
  const content = String(chunk.content ?? "").toLocaleLowerCase()
  return terms.reduce((score, term) => score + (heading.includes(term) ? 8 : 0) + (content.split(term).length - 1), 0)
}

export async function retrieveAgentLibraryContext(input: {
  query: string
  layers?: AgentLibraryLayer[]
  maxChars?: number
}) {
  await assertIndexTables()
  const versionId = await currentVersion()
  const terms = queryTerms(String(input.query).slice(0, 2_000))
  const allowedLayers = new Set(input.layers?.filter((layer): layer is AgentLibraryLayer => ["project", "design", "backend", "database", "policy"].includes(layer)) ?? [])
  const rows = await tableSelect<any>("agent_library_chunks", (request) =>
    request
      .select("path, layer, chunk_index, heading, content, content_hash")
      .eq("project_id", PROJECT_ID)
      .eq("library_version_id", versionId)
      .order("path", { ascending: true })
      .order("chunk_index", { ascending: true }),
  )
  const candidates = rows
    .filter((row) => !allowedLayers.size || allowedLayers.has(row.layer))
    .map((row) => ({ ...row, score: scoreChunk(row, terms) }))
    .filter((row) => !terms.length || row.score > 0)
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path) || left.chunk_index - right.chunk_index)
  const maxChars = Math.min(12_000, Math.max(1_000, Number(input.maxChars ?? 6_000)))
  const selected: any[] = []
  let totalChars = 0
  for (const chunk of candidates) {
    if (totalChars + chunk.content.length > maxChars && selected.length) continue
    selected.push({ path: chunk.path, layer: chunk.layer, heading: chunk.heading, content: chunk.content, contentHash: chunk.content_hash })
    totalChars += chunk.content.length
    if (totalChars >= maxChars) break
  }
  return { projectId: PROJECT_ID, versionId, query: input.query, totalChars, chunks: selected }
}

export async function agentLibraryStatus() {
  const current = await kvGet<Record<string, unknown>>(CURRENT_VERSION_KEY)
  return { projectId: PROJECT_ID, current: current ?? null }
}
