import { useEffect, useMemo, useRef, useState } from "react"
import type { WebsiteContentRecord } from "../types"
import {
  cancelAllWebsiteInventoryBatches,
  deleteWebsiteInventoryRecord,
  fetchWebsiteInventory,
  fetchWebsiteInventoryBatch,
  scanWebsiteUrl,
  startWebsiteInventoryBatch,
  updateWebsiteInventoryRecord,
} from "../lib/db"
import { useI18n } from "../lib/i18n"
import { I, toastErr } from "./ui"

/** Settings › Website inventory (port of the old WebsiteInventoryPanel, CRM markup). */
export default function WebsiteInventory({
  records,
  railwayUrl,
  onChange,
}: {
  records: WebsiteContentRecord[]
  railwayUrl: string
  onChange: (records: WebsiteContentRecord[]) => void
}) {
  const { tr } = useI18n()
  const [input, setInput] = useState("")
  const [scanning, setScanning] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [includeAiSummary, setIncludeAiSummary] = useState(true)
  const [scanProgress, setScanProgress] = useState({ done: 0, total: 0 })
  const [summaryLimitReached, setSummaryLimitReached] = useState(false)
  const [inventoryQuery, setInventoryQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [typeFilter, setTypeFilter] = useState("all")
  const [page, setPage] = useState(1)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())
  const resumeStarted = useRef(false)
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
  const mergeBatchRecords = (
    baseRecords: WebsiteContentRecord[],
    completed: WebsiteContentRecord[],
  ) => {
    const byUrl = new Map(completed.map((record) => [record.url, record]))
    const merged = baseRecords.map((record) => byUrl.get(record.url) ?? record)
    const known = new Set(merged.map((record) => record.url))
    return [...completed.filter((record) => !known.has(record.url)), ...merged]
  }
  const monitorBatch = async (
    jobId: string,
    baseRecords: WebsiteContentRecord[],
    cancelled: () => boolean = () => false,
  ) => {
    let mergedRecords = baseRecords
    while (!cancelled()) {
      const job = await fetchWebsiteInventoryBatch(jobId, railwayUrl)
      if (cancelled()) return
      setScanProgress({ done: job.done, total: job.total })
      if (job.summaryLimitReached) setSummaryLimitReached(true)
      mergedRecords = mergeBatchRecords(mergedRecords, job.recentRecords)
      onChange(mergedRecords)
      if (job.status === "complete") {
        onChange(await fetchWebsiteInventory(railwayUrl))
        localStorage.removeItem("writer:website-inventory-active-job")
        setActiveJobId(null)
        setScanning(false)
        return
      }
      if (job.status === "cancelled") {
        onChange(await fetchWebsiteInventory(railwayUrl))
        localStorage.removeItem("writer:website-inventory-active-job")
        setActiveJobId(null)
        setScanning(false)
        return
      }
      if (job.status === "failed" && job.done >= job.total) {
        localStorage.removeItem("writer:website-inventory-active-job")
        setScanning(false)
        throw new Error(job.error || "Website inventory batch failed.")
      }
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
  }
  useEffect(() => {
    if (resumeStarted.current) return
    resumeStarted.current = true
    const jobId = localStorage.getItem("writer:website-inventory-active-job")
    if (!jobId) return
    let cancelled = false
    setActiveJobId(jobId)
    setScanning(true)
    setSummaryLimitReached(false)
    void monitorBatch(jobId, records, () => cancelled).catch(() => setScanning(false))
    return () => { cancelled = true }
  }, [])
  const update = (id: string, patch: Partial<WebsiteContentRecord>) =>
    onChange(
      records.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    )
  const persistUpdate = (id: string, patch: Partial<WebsiteContentRecord>) =>
    updateWebsiteInventoryRecord(id, patch, railwayUrl).catch((error) => toastErr(error))
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
    const current = [...pending, ...records]
    onChange(current)
    setInput("")
    setSummaryLimitReached(false)
    setScanning(true)
    setScanProgress({ done: 0, total: pending.length })
    try {
      const job = await startWebsiteInventoryBatch(
        pending.map((item) => item.url),
        railwayUrl,
        includeAiSummary,
      )
      localStorage.setItem("writer:website-inventory-active-job", job.id)
      setActiveJobId(job.id)
      await monitorBatch(job.id, current)
    } catch {
      setScanning(false)
    }
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
    setSummaryLimitReached(false)
    setScanning(true)
    setScanProgress({ done: 0, total: records.length })
    const current: WebsiteContentRecord[] = records.map((item) => ({
      ...item,
      status: "queued" as const,
      crawlStatus: "queued" as const,
    }))
    onChange(current)
    try {
      const job = await startWebsiteInventoryBatch(records.map((item) => item.url), railwayUrl, true)
      localStorage.setItem("writer:website-inventory-active-job", job.id)
      setActiveJobId(job.id)
      await monitorBatch(job.id, current)
    } catch {
      setScanning(false)
    }
  }
  const summarizeMissing = async () => {
    const pending = records.filter((record) => !record.summary && record.status !== "broken")
    if (scanning || !pending.length) return
    setSummaryLimitReached(false)
    setScanning(true)
    setScanProgress({ done: 0, total: pending.length })
    const current = records.map((item) => pending.some((record) => record.id === item.id)
      ? { ...item, crawlStatus: "summarizing" as const }
      : item)
    onChange(current)
    try {
      const job = await startWebsiteInventoryBatch(pending.map((item) => item.url), railwayUrl, true)
      localStorage.setItem("writer:website-inventory-active-job", job.id)
      setActiveJobId(job.id)
      await monitorBatch(job.id, current)
    } catch {
      setScanning(false)
    }
  }
  const cancelScan = async () => {
    if (!activeJobId || cancelling) return
    setCancelling(true)
    try {
      await cancelAllWebsiteInventoryBatches(railwayUrl)
      localStorage.removeItem("writer:website-inventory-active-job")
      setActiveJobId(null)
      setScanning(false)
      onChange(await fetchWebsiteInventory(railwayUrl))
    } finally {
      setCancelling(false)
    }
  }
  const splitList = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean)
  const statusColor: Record<string, string> = { active: "green", redirected: "blue", broken: "red", queued: "orange", checking: "orange", unchecked: "gray" }
  const muted = { color: "var(--f3)", fontSize: 12 } as const
  const field = { display: "flex", flexDirection: "column", gap: 4, color: "var(--f3)", fontSize: 12, flex: "1 1 160px", minWidth: 0 } as const
  return (
    <>
      <section>
        <h2>Website inventory</h2>
        <p className="desc">Paste one URL per line. Railway checks each page and extracts its metadata automatically.</p>
        <div className="box">
          <div className="box-row" style={{ display: "block" }}>
            <textarea
              rows={4}
              className="inp"
              style={{ height: "auto", padding: 8, resize: "vertical" }}
              aria-label="Website URLs"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={"https://flearningstudio.com/page-one\nhttps://flearningstudio.com/page-two"}
            />
          </div>
          <div className="box-row" style={{ flexWrap: "wrap" }}>
            <div className="grow" style={{ minWidth: 200 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" checked={includeAiSummary} onChange={(event) => setIncludeAiSummary(event.target.checked)} />
                {tr("AI summary và semantic classification", "AI summary and semantic classification")}
              </label>
              <div className="s" aria-live="polite">
                {summaryLimitReached
                  ? tr(`Đã hết lượt AI summary hôm nay. Metadata vẫn tiếp tục scan (${scanProgress.done}/${scanProgress.total}).`, `AI summary limit reached for today. Metadata scan continues (${scanProgress.done}/${scanProgress.total}).`)
                  : scanning
                    ? `Scanning ${scanProgress.done}/${scanProgress.total} pages…`
                    : "Private-network URLs and non-HTML files are blocked."}
              </div>
            </div>
            {scanning && activeJobId && (
              <button type="button" className="btn danger" disabled={cancelling} onClick={() => void cancelScan()}>
                <I n="player-stop" />
                {cancelling ? tr("Đang dừng…", "Stopping…") : tr("Dừng scan", "Stop scan")}
              </button>
            )}
            <button type="button" className="btn primary" disabled={scanning || !input.trim()} onClick={() => void scan()}>
              <I n={includeAiSummary ? "sparkles" : "world"} />
              {includeAiSummary ? "Import, scan & summarize" : "Import metadata only"}
            </button>
          </div>
        </div>
      </section>
      <section>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <h2 style={{ flex: 1 }}>Indexed pages <span style={{ color: "var(--f3)", fontWeight: 400 }}>{records.length}</span></h2>
          <span style={muted}>
            {records.filter((item) => item.eligibleForInternalLink && ["active", "redirected"].includes(item.status)).length} approved
          </span>
          <button type="button" className="btn" disabled={scanning || !records.some((item) => !item.summary && item.status !== "broken")} onClick={() => void summarizeMissing()}>
            <I n="sparkles" />Summarize missing
          </button>
          <button type="button" className="btn" disabled={scanning || !records.length} onClick={() => void recheckAll()}>
            <I n="refresh" />Recheck all
          </button>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <input
            className="inp"
            style={{ flex: "1 1 220px", width: "auto" }}
            aria-label="Search inventory"
            value={inventoryQuery}
            onChange={(event) => { setInventoryQuery(event.target.value); setPage(1) }}
            placeholder="Search URL, title, topic or service…"
          />
          <select className="inp" style={{ width: 140 }} aria-label="Status filter" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1) }}>
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="redirected">Redirected</option>
            <option value="broken">Broken</option>
            <option value="unchecked">Unchecked</option>
            <option value="queued">Queued</option>
            <option value="checking">Checking</option>
          </select>
          <select className="inp" style={{ width: 140 }} aria-label="Page type filter" value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value); setPage(1) }}>
            <option value="all">All page types</option>
            <option value="blog">Blog</option>
            <option value="service">Service</option>
            <option value="portfolio">Portfolio</option>
            <option value="landing">Landing</option>
            <option value="about">About</option>
            <option value="commercial">Commercial</option>
          </select>
        </div>
        <div className="box website-inventory-list">
          {filteredRecords.length === 0 ? (
            <div className="box-row" style={{ justifyContent: "center", color: "var(--f3)", padding: "24px 12px" }}>
              {records.length ? "No pages match the current filters." : "No website pages indexed."}
            </div>
          ) : (
            visibleRecords.map((record) => {
              const expanded = expandedIds.has(record.id)
              return (
                <div key={record.id} className="box-row website-inventory-row" style={{ display: "block" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <div className="grow" style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={record.title}>
                        {record.title || "Untitled page"}
                      </div>
                      <a
                        href={record.redirectTarget || record.canonicalUrl || record.url}
                        target="_blank"
                        rel="noreferrer"
                        title={record.url}
                        style={{ ...muted, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      >
                        {record.url}
                      </a>
                    </div>
                    <span className={`tag t-${statusColor[record.status] ?? "gray"}`} aria-hidden="true" style={{ textTransform: "capitalize" }}>{record.status}</span>
                    <select
                      className="inp"
                      style={{ width: 120 }}
                      aria-label="Status"
                      value={record.status}
                      disabled={record.status === "queued" || record.status === "checking"}
                      title={record.lastError}
                      onChange={(event) => {
                        const status = event.target.value as WebsiteContentRecord["status"]
                        const patch = {
                          status,
                          eligibleForInternalLink: status === "active" || status === "redirected",
                        }
                        update(record.id, patch)
                        void persistUpdate(record.id, patch)
                      }}
                    >
                      <option value="queued">Queued</option>
                      <option value="checking">Checking</option>
                      <option value="unchecked">Unchecked</option>
                      <option value="active">Active</option>
                      <option value="redirected">Redirected</option>
                      <option value="broken">Broken</option>
                    </select>
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => toggleExpanded(record.id)}
                      aria-expanded={expanded}
                      aria-label={expanded ? "Close details" : "View details"}
                      title={expanded ? "Close details" : "View details"}
                    >
                      <I n={expanded ? "x" : "search"} />
                    </button>
                  </div>

                  {record.summary && !expanded && (
                    <div style={{ ...muted, marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={record.summary}>{record.summary}</div>
                  )}

                  {expanded && <>
                    {record.summary && <p style={{ color: "var(--f2)", margin: "8px 0 0", whiteSpace: "pre-wrap" }}>{record.summary}</p>}
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                      <label style={field}>
                        Page type
                        <select
                          className="inp"
                          value={record.contentType}
                          onChange={(event) => {
                            const patch = { contentType: event.target.value as WebsiteContentRecord["contentType"] }
                            update(record.id, patch)
                            void persistUpdate(record.id, patch)
                          }}
                        >
                          <option value="blog">Blog</option>
                          <option value="service">Service</option>
                          <option value="portfolio">Portfolio</option>
                          <option value="landing">Landing</option>
                          <option value="about">About</option>
                          <option value="commercial">Commercial</option>
                        </select>
                      </label>
                      <label style={field}>
                        Topics
                        <input
                          className="inp"
                          value={record.topics.join(", ")}
                          onChange={(event) => update(record.id, { topics: splitList(event.target.value) })}
                          onBlur={(event) => void persistUpdate(record.id, { topics: splitList(event.target.value) })}
                        />
                      </label>
                      <label style={field}>
                        Services
                        <input
                          className="inp"
                          value={(record.services ?? []).join(", ")}
                          onChange={(event) => update(record.id, { services: splitList(event.target.value) })}
                          onBlur={(event) => void persistUpdate(record.id, { services: splitList(event.target.value) })}
                        />
                      </label>
                    </div>
                  </>}

                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--b3)", ...muted }}>
                    <span>Checked {record.lastChecked ? new Date(record.lastChecked).toLocaleString() : "—"}</span>
                    {record.summarizedAt && <span>{record.summaryCacheHit ? "Cached" : record.aiModel || "AI"} · {new Date(record.summarizedAt).toLocaleDateString()}</span>}
                    {record.searchIntent && <span className="rchip" style={{ textTransform: "capitalize" }}>{record.searchIntent}</span>}
                    <span style={{ flex: 1 }} />
                    <button type="button" className="btn ghost" onClick={() => void recheck(record)} aria-label="Recheck URL" title="Recheck URL">
                      <I n="refresh" />
                    </button>
                    <button
                      type="button"
                      className="btn ghost"
                      style={{ color: "var(--danger)" }}
                      onClick={() => {
                        if (!window.confirm(tr(`Xoá ${record.url} khỏi Website Inventory? AI sẽ không đề xuất URL này làm internal link nữa.`, `Remove ${record.url} from Website Inventory? AI will stop suggesting it as an internal link.`))) return
                        void deleteWebsiteInventoryRecord(record.id, railwayUrl)
                          .then(() => onChange(records.filter((item) => item.id !== record.id)))
                          .catch((error) => toastErr(error))
                      }}
                      aria-label="Remove URL"
                      title="Remove URL"
                    >
                      <I n="trash" />
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
        {filteredRecords.length > pageSize && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 12, ...muted }}>
            <span style={{ flex: 1 }}>Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filteredRecords.length)} of {filteredRecords.length}</span>
            <button type="button" className="btn" disabled={page === 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
            <span>Page {page} / {totalPages}</span>
            <button type="button" className="btn" disabled={page === totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Next</button>
          </div>
        )}
      </section>
    </>
  )
}
