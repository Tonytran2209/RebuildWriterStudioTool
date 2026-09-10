import { useEffect, useMemo, useState } from "react"
import { Archive, BookOpen, Download, Globe2, ScrollText } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type {
  ActionDataSource,
  AppConfig,
  DocumentFile,
  FileCategory,
  KbSubTab,
  WebsiteContentRecord,
} from "../../types"
import SourceImportPanel from "./SourceImportPanel"
import WorkflowRulesPanel from "./WorkflowRulesPanel"
import { scanWebsiteUrl } from "../../lib/db"
import { isLegacyActionPlan } from "../../lib/legacyCompatibility"

const SUBTAB_META: Record<KbSubTab, {
  label: string
  category?: FileCategory
  hint: string
  icon: LucideIcon
}> = {
  kb: {
    label: "Knowledge Base",
    category: "kb",
    hint: "Kiến thức cốt lõi, sản phẩm, nghiên cứu và tài liệu tham khảo",
    icon: BookOpen,
  },
  rules: {
    label: "Skills & Rules",
    category: "rules",
    hint: "Taxonomy, tone of voice, cấu trúc và quy tắc bắt buộc",
    icon: ScrollText,
  },
  website: {
    label: "Website Inventory",
    hint: "Danh sách URL duy nhất AI được phép đề xuất làm internal link",
    icon: Globe2,
  },
  "legacy-action": {
    label: "Legacy Action Plans",
    hint: "Kho chỉ đọc cho Action Plan từ phiên bản cũ",
    icon: Archive,
  },
}

interface Props {
  files: DocumentFile[]
  onChange: (files: DocumentFile[]) => void
  railwayUrl: string
  config: AppConfig
  onConfigChange: (config: AppConfig) => void
}

function toSource(file: DocumentFile): ActionDataSource {
  return {
    ...file,
    sourceType: file.sourceType ?? "file",
    addedAt: file.addedAt ?? file.uploadedAt,
  } as ActionDataSource
}

function toDocument(
  source: ActionDataSource,
  category: "kb" | "rules",
): DocumentFile {
  return {
    ...source,
    category,
    uploadedAt:
      (source as ActionDataSource & { uploadedAt?: string }).uploadedAt ??
      source.addedAt,
    size: source.size ?? `${new Blob([source.content ?? ""]).size} B`,
    fileType: (source.fileType ??
      (source.sourceType === "manual"
        ? "csv"
        : "txt")) as DocumentFile["fileType"],
  }
}

export default function TabKnowledgeBase({
  files,
  onChange,
  railwayUrl,
  config,
  onConfigChange,
}: Props) {
  const [activeSubTab, setActiveSubTab] = useState<KbSubTab>("kb")
  const meta = SUBTAB_META[activeSubTab]

  const sources = meta.category
    ? files.filter((file) => file.category === meta.category).map(toSource)
    : []

  const handleChange = (nextSources: ActionDataSource[]) => {
    const category = meta.category as "kb" | "rules"
    const otherFiles = files.filter((file) => file.category !== category)
    onChange([
      ...otherFiles,
      ...nextSources.map((source) => toDocument(source, category)),
    ])
  }

  return (
    <div className="space-y-7">
      <div className="settings-subnav flex gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1">
        {(Object.entries(
          SUBTAB_META,
        ) as [KbSubTab, typeof SUBTAB_META[KbSubTab]][]).map(([key, item]) => (
          <button
            key={key}
            onClick={() => setActiveSubTab(key)}
            aria-current={activeSubTab === key ? "page" : undefined}
            className={`inline-flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              activeSubTab === key
                ? "is-active bg-white text-slate-900"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            <item.icon className="app-icon shrink-0" aria-hidden="true" />
            {item.label}
          </button>
        ))}
      </div>

      {activeSubTab === "rules" ? (
        <WorkflowRulesPanel
          config={config}
          files={files}
          onChange={onConfigChange}
        />
      ) : activeSubTab === "website" ? (
        <WebsiteInventoryPanel
          records={config.websiteInventory ?? []}
          railwayUrl={railwayUrl}
          onChange={(records) =>
            onConfigChange({ ...config, websiteInventory: records })
          }
        />
      ) : activeSubTab === "legacy-action" ? (
        <LegacyActionPlanArchive files={files.filter(isLegacyActionPlan)} />
      ) : (
        <div className="space-y-4">
          <SourceImportPanel
            key={activeSubTab}
            category={meta.category ?? "kb"}
            sources={sources}
            onChange={handleChange}
            railwayUrl={railwayUrl}
            knowledgeGovernance
          />
        </div>
      )}
    </div>
  )
}

function LegacyActionPlanArchive({ files }: { files: DocumentFile[] }) {
  const download = (file: DocumentFile) => {
    const content = file.content ?? file.preview ?? ""
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }))
    const link = document.createElement("a")
    link.href = url
    link.download = file.name
    link.click()
    URL.revokeObjectURL(url)
  }
  return (
    <section>
      <h2 className="text-sm font-medium text-slate-800">Legacy Action Plan archive</h2>
      <p className="mt-1 text-xs leading-5 text-slate-400">
        Các nguồn này chỉ dùng để xem và tải lại. Chúng không được đưa vào prompt của workflow hiện tại.
      </p>
      <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {!files.length ? (
          <p className="px-4 py-8 text-center text-sm text-slate-400">Không tìm thấy Action Plan legacy trong kho file hiện tại.</p>
        ) : files.map((file) => (
          <details key={file.id} className="border-b border-slate-200 last:border-b-0">
            <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-800">{file.name}</div>
                <div className="mt-1 text-xs text-slate-400">{file.fileType?.toUpperCase()} · {file.size} · {file.uploadedAt}</div>
              </div>
              <button type="button" onClick={(event) => { event.preventDefault(); download(file) }} className="settings-secondary-action rounded-md p-2 text-slate-500" aria-label={`Download ${file.name}`}>
                <Download className="app-icon" aria-hidden="true" />
              </button>
            </summary>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap border-t border-slate-100 bg-slate-50 px-4 py-4 text-xs leading-5 text-slate-600">{file.content || file.preview || "Không có nội dung preview."}</pre>
          </details>
        ))}
      </div>
    </section>
  )
}

function WebsiteInventoryPanel({
  records,
  railwayUrl,
  onChange,
}: {
  records: WebsiteContentRecord[]
  railwayUrl: string
  onChange: (records: WebsiteContentRecord[]) => void
}) {
  const [input, setInput] = useState("")
  const [scanning, setScanning] = useState(false)
  const [includeAiSummary, setIncludeAiSummary] = useState(true)
  const [scanProgress, setScanProgress] = useState({ done: 0, total: 0 })
  const [inventoryQuery, setInventoryQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [typeFilter, setTypeFilter] = useState("all")
  const [page, setPage] = useState(1)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())
  const pageSize = 25
  const filteredRecords = useMemo(() => {
    const query = inventoryQuery.trim().toLocaleLowerCase()
    return records
      .filter((record) => statusFilter === "all" || record.status === statusFilter)
      .filter((record) => typeFilter === "all" || record.contentType === typeFilter)
      .filter((record) => !query || [
        record.url, record.title, record.summary, record.primaryTopic,
        ...(record.topics ?? []), ...(record.services ?? []), ...(record.internalLinkAnchors ?? []),
      ].some((value) => String(value ?? "").toLocaleLowerCase().includes(query)))
      .sort((left, right) => String(right.lastChecked ?? "").localeCompare(String(left.lastChecked ?? "")))
  }, [inventoryQuery, records, statusFilter, typeFilter])
  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / pageSize))
  const visibleRecords = filteredRecords.slice((page - 1) * pageSize, page * pageSize)
  useEffect(() => setPage((current) => Math.min(current, totalPages)), [totalPages])
  const toggleExpanded = (id: string) => setExpandedIds((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const update = (id: string, patch: Partial<WebsiteContentRecord>) =>
    onChange(
      records.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    )
  const scan = async () => {
    const urls = [...new Set(input.split(/[\n,]+/).flatMap((value) => {
          try {
            const parsed = new URL(value.trim())
            return ["http:", "https:"].includes(parsed.protocol)
              ? [parsed.toString()]
              : []
          } catch {
            return []
          }
        }))]
    if (!urls.length || scanning) return
    const existing = new Set(records.map((item) => item.url))
    const pending = urls
      .filter((url) => !existing.has(url))
      .map(
        (url, index): WebsiteContentRecord => ({
          id: `pending-${Date.now()}-${index}`,
          url,
          title: new URL(url).hostname,
          contentType: "blog",
          topics: [],
          services: [],
          status: "queued",
          crawlStatus: "queued",
          eligibleForInternalLink: false,
        }),
      )
    let current = [...pending, ...records]
    onChange(current)
    setInput("")
    setScanning(true)
    setScanProgress({ done: 0, total: pending.length })
    let cursor = 0
    const worker = async () => {
      while (cursor < pending.length) {
        const item = pending[cursor++]
        current = current.map((record) =>
          record.id === item.id
            ? { ...record, status: "checking", crawlStatus: "checking" }
            : record,
        )
        onChange(current)
        try {
          const result = await scanWebsiteUrl(item.url, railwayUrl, includeAiSummary)
          current = current.map((record) =>
            record.id === item.id ? result : record,
          )
        } catch (error) {
          current = current.map((record) =>
            record.id === item.id
              ? {
                  ...record,
                  status: "broken",
                  crawlStatus: "failed",
                  lastChecked: new Date().toISOString(),
                  lastError:
                    error instanceof Error ? error.message : String(error),
                }
              : record,
          )
        }
        onChange(current)
        setScanProgress((progress) => ({ ...progress, done: progress.done + 1 }))
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(3, pending.length) }, worker),
    )
    setScanning(false)
  }
  const recheck = async (record: WebsiteContentRecord) => {
    update(record.id, { status: "checking", crawlStatus: "checking" })
    try {
      const result = await scanWebsiteUrl(record.url, railwayUrl, true)
      onChange(
        records.map((item) =>
          item.id === record.id ? { ...result, id: record.id } : item,
        ),
      )
    } catch (error) {
      update(record.id, {
        status: "broken",
        crawlStatus: "failed",
        lastChecked: new Date().toISOString(),
        lastError: error instanceof Error ? error.message : String(error),
      })
    }
  }
  const recheckAll = async () => {
    if (scanning || !records.length) return
    setScanning(true)
    setScanProgress({ done: 0, total: records.length })
    let current: WebsiteContentRecord[] = records.map((item) => ({
      ...item,
      status: "queued" as const,
      crawlStatus: "queued" as const,
    }))
    onChange(current)
    let cursor = 0
    const worker = async () => {
      while (cursor < records.length) {
        const original = records[cursor++]
        current = current.map((item) =>
          item.id === original.id
            ? { ...item, status: "checking", crawlStatus: "checking" }
            : item,
        )
        onChange(current)
        try {
          const result = await scanWebsiteUrl(original.url, railwayUrl, true)
          current = current.map((item) =>
            item.id === original.id ? { ...result, id: original.id } : item,
          )
        } catch (error) {
          current = current.map((item) =>
            item.id === original.id
              ? {
                  ...item,
                  status: "broken",
                  crawlStatus: "failed",
                  eligibleForInternalLink: false,
                  lastChecked: new Date().toISOString(),
                  lastError:
                    error instanceof Error ? error.message : String(error),
                }
              : item,
          )
        }
        onChange(current)
        setScanProgress((progress) => ({ ...progress, done: progress.done + 1 }))
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(3, records.length) }, worker),
    )
    setScanning(false)
  }
  const summarizeMissing = async () => {
    const pending = records.filter((record) => !record.summary && record.status !== "broken")
    if (scanning || !pending.length) return
    setScanning(true)
    setScanProgress({ done: 0, total: pending.length })
    let current = records
    let cursor = 0
    const worker = async () => {
      while (cursor < pending.length) {
        const original = pending[cursor++]
        current = current.map((item) => item.id === original.id
          ? { ...item, crawlStatus: "summarizing" }
          : item)
        onChange(current)
        try {
          const result = await scanWebsiteUrl(original.url, railwayUrl, true)
          current = current.map((item) => item.id === original.id ? { ...result, id: original.id } : item)
        } catch (error) {
          current = current.map((item) => item.id === original.id ? {
            ...item,
            crawlStatus: "failed",
            lastError: error instanceof Error ? error.message : String(error),
          } : item)
        }
        onChange(current)
        setScanProgress((progress) => ({ ...progress, done: progress.done + 1 }))
      }
    }
    await Promise.all(Array.from({ length: Math.min(2, pending.length) }, worker))
    setScanning(false)
  }
  return (
    <div className="space-y-7">
      <section>
        <h2 className="text-sm font-medium text-slate-800">
          Website inventory
        </h2>
        <p className="mt-1 text-xs leading-5 text-slate-400">
          Paste one URL per line. Railway checks each page and extracts its
          metadata automatically.
        </p>
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
          <textarea
            rows={4}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={
              "https://flearningstudio.com/page-one\nhttps://flearningstudio.com/page-two"
            }
            className="w-full resize-y rounded-lg border border-slate-200 px-3 py-2.5 text-sm"
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <div>
              <label className="flex items-center gap-2 text-xs text-slate-500">
                <input type="checkbox" checked={includeAiSummary} onChange={(event) => setIncludeAiSummary(event.target.checked)} />
                AI summary và semantic classification
              </label>
              <p className="mt-1 text-xs text-slate-400">
              {scanning
                ? `Scanning ${scanProgress.done}/${scanProgress.total} pages…`
                : "Private-network URLs and non-HTML files are blocked."}
              </p>
            </div>
            <button
              disabled={scanning || !input.trim()}
              onClick={() => void scan()}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {includeAiSummary ? "Import, scan & summarize" : "Import metadata only"}
            </button>
          </div>
        </div>
      </section>
      <section>
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-sm font-medium text-slate-800">
            Indexed pages{" "}
            <span className="ml-1 font-normal text-slate-400">
              {records.length}
            </span>
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-400">
              {
                records.filter(
                  (item) =>
                    item.eligibleForInternalLink &&
                    ["active", "redirected"].includes(item.status),
                ).length
              }{" "}
              approved
            </span>
            <button
              disabled={scanning || !records.some((item) => !item.summary && item.status !== "broken")}
              onClick={() => void summarizeMissing()}
              className="settings-secondary-action rounded-md px-2.5 py-1.5 text-xs text-slate-600 disabled:opacity-40"
            >
              Summarize missing
            </button>
            <button
              disabled={scanning || !records.length}
              onClick={() => void recheckAll()}
              className="settings-secondary-action rounded-md px-2.5 py-1.5 text-xs text-slate-600 disabled:opacity-40"
            >
              Recheck all
            </button>
          </div>
        </div>
        <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_140px_140px]">
          <input
            value={inventoryQuery}
            onChange={(event) => { setInventoryQuery(event.target.value); setPage(1) }}
            placeholder="Search URL, title, topic or service…"
            className="h-9 w-full px-3 text-xs"
          />
          <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1) }} className="h-9 px-2 text-xs">
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="redirected">Redirected</option>
            <option value="broken">Broken</option>
            <option value="unchecked">Unchecked</option>
            <option value="queued">Queued</option>
            <option value="checking">Checking</option>
          </select>
          <select value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value); setPage(1) }} className="h-9 px-2 text-xs">
            <option value="all">All page types</option>
            <option value="blog">Blog</option>
            <option value="service">Service</option>
            <option value="portfolio">Portfolio</option>
            <option value="landing">Landing</option>
            <option value="about">About</option>
            <option value="commercial">Commercial</option>
          </select>
        </div>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="website-inventory-list divide-y divide-slate-200">
            {filteredRecords.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-400">
                {records.length ? "No pages match the current filters." : "No website pages indexed."}
              </p>
            ) : (
              visibleRecords.map((record) => (
                <div
                  key={record.id}
                  className="website-inventory-row px-4 py-4 sm:px-5"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                    <input
                      aria-label="Title"
                      value={record.title}
                      onChange={(event) => update(record.id, { title: event.target.value })}
                        className="h-8 w-full min-w-0 border-0 bg-transparent px-0 text-sm font-medium text-slate-800 outline-none"
                    />
                      <a
                        href={record.redirectTarget || record.canonicalUrl || record.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate text-[11px] text-slate-400 hover:text-slate-600"
                        title={record.url}
                      >
                        {record.url}
                      </a>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                    <select
                      aria-label="Status"
                      value={record.status}
                      disabled={record.status === "queued" || record.status === "checking"}
                      title={record.lastError}
                      onChange={(event) => {
                        const status = event.target.value as WebsiteContentRecord["status"]
                        update(record.id, {
                          status,
                          eligibleForInternalLink: status === "active" || status === "redirected",
                        })
                      }}
                      className="h-8 w-full shrink-0 px-2 text-xs sm:w-28"
                    >
                      <option value="queued">Queued</option>
                      <option value="checking">Checking</option>
                      <option value="unchecked">Unchecked</option>
                      <option value="active">Active</option>
                      <option value="redirected">Redirected</option>
                      <option value="broken">Broken</option>
                    </select>
                      <button type="button" onClick={() => toggleExpanded(record.id)} className="settings-secondary-action h-8 rounded-md px-2.5 text-xs text-slate-500" aria-expanded={expandedIds.has(record.id)}>
                        {expandedIds.has(record.id) ? "Close" : "Details"}
                      </button>
                    </div>
                  </div>

                  {record.summary && !expandedIds.has(record.id) && (
                    <p className="mt-2 truncate text-[11px] leading-5 text-slate-400" title={record.summary}>{record.summary}</p>
                  )}

                  {expandedIds.has(record.id) && <>
                  {record.summary && <p className="mt-3 text-xs leading-5 text-slate-500">{record.summary}</p>}
                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <label className="min-w-0 text-[10px] font-medium text-slate-400">
                      Page type
                      <select
                        value={record.contentType}
                        onChange={(event) => update(record.id, { contentType: event.target.value as WebsiteContentRecord["contentType"] })}
                        className="mt-1 h-9 w-full px-2 text-xs"
                      >
                        <option value="blog">Blog</option>
                        <option value="service">Service</option>
                        <option value="portfolio">Portfolio</option>
                        <option value="landing">Landing</option>
                        <option value="about">About</option>
                        <option value="commercial">Commercial</option>
                      </select>
                    </label>
                    <label className="min-w-0 text-[10px] font-medium text-slate-400">
                      Topics
                      <input
                        value={record.topics.join(", ")}
                        onChange={(event) => update(record.id, { topics: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })}
                        className="mt-1 h-9 w-full min-w-0 px-2 text-xs"
                      />
                    </label>
                    <label className="min-w-0 text-[10px] font-medium text-slate-400">
                      Services
                      <input
                        value={(record.services ?? []).join(", ")}
                        onChange={(event) => update(record.id, { services: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })}
                        className="mt-1 h-9 w-full min-w-0 px-2 text-xs"
                      />
                    </label>
                  </div>
                  </>}

                  <div className="mt-3 flex flex-col gap-2 border-t border-slate-100 pt-3 text-[10px] text-slate-400 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span>Checked {record.lastChecked ? new Date(record.lastChecked).toLocaleString() : "—"}</span>
                      {record.summarizedAt && <span>{record.summaryCacheHit ? "Cached" : record.aiModel || "AI"} · {new Date(record.summarizedAt).toLocaleDateString()}</span>}
                      {record.searchIntent && <span className="capitalize">{record.searchIntent}</span>}
                    </div>
                    <div className="flex items-center gap-1 self-end sm:self-auto">
                    <button
                      onClick={() => void recheck(record)}
                      className="settings-secondary-action rounded-md px-2 py-1 text-xs text-slate-500"
                    >
                      Check
                    </button>
                    <button
                      onClick={() =>
                        onChange(
                          records.filter((item) => item.id !== record.id),
                        )
                      }
                      className="rounded-md px-1 py-1 text-xs text-red-500"
                      aria-label="Remove URL"
                    >
                      ×
                    </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
        {filteredRecords.length > pageSize && (
          <div className="mt-3 flex flex-col gap-2 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
            <span>Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filteredRecords.length)} of {filteredRecords.length}</span>
            <div className="flex items-center gap-2">
              <button disabled={page === 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="settings-secondary-action rounded-md px-3 py-1.5 disabled:opacity-40">Previous</button>
              <span>Page {page} / {totalPages}</span>
              <button disabled={page === totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))} className="settings-secondary-action rounded-md px-3 py-1.5 disabled:opacity-40">Next</button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
