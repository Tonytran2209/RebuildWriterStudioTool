import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react"
import type { WebsiteContentRecord } from "../types"
import {
  cancelAllWebsiteInventoryBatches,
  deleteWebsiteInventoryRecord,
  fetchWebsiteInventory,
  fetchWebsiteInventoryBatch,
  fetchWebsiteInventoryRecord,
  importWebsiteSitemap,
  scanWebsiteUrl,
  type SitemapImportResult,
  startWebsiteInventoryBatch,
  updateWebsiteInventoryRecord,
  type WebsiteInventoryBatchJob,
} from "../lib/db"
import { useI18n } from "../lib/i18n"
import { I, toast, toastErr, trackHandoff } from "./ui"
import { readInventoryCache, writeInventoryCache } from "../lib/inventoryCache"

const ACTIVE_JOB_KEY = "writer:website-inventory-active-job"
const readJobId = () => { try { return localStorage.getItem(ACTIVE_JOB_KEY) } catch { return null } }
const writeJobId = (id: string | null) => { try { if (id) localStorage.setItem(ACTIVE_JOB_KEY, id); else localStorage.removeItem(ACTIVE_JOB_KEY) } catch { /* per-viewer convenience */ } }

/** Crawled records replace their queued placeholders (by URL); new URLs go on top. */
function mergeBatchRecords(base: WebsiteContentRecord[], completed: WebsiteContentRecord[]) {
  const byUrl = new Map(completed.map((record) => [record.url, record]))
  const merged = base.map((record) => byUrl.get(record.url) ?? record)
  const known = new Set(merged.map((record) => record.url))
  return [...completed.filter((record) => !known.has(record.url)), ...merged]
}
const placeholder = (url: string, index: number): WebsiteContentRecord => ({
  id: `pending-${Date.now()}-${index}`, url, title: new URL(url).hostname, contentType: "blog", topics: [], services: [], status: "queued", crawlStatus: "queued", eligibleForInternalLink: false,
})

export type InventoryList = {
  inventory: WebsiteContentRecord[]
  setInventory: Dispatch<SetStateAction<WebsiteContentRecord[]>>
  /** True once the browser cache or the server answered. */
  loaded: boolean
  /** Shows the browser cache first (once), then asks the server with the cached revision; unchanged = no download. */
  refresh: () => Promise<void>
}

/** The inventory table list for the CRM: loaded on demand (not with the app config), cached in IndexedDB by revision. */
export function useInventoryList(railwayUrl: string): InventoryList {
  const [inventory, setInventory] = useState<WebsiteContentRecord[]>([])
  const [loaded, setLoaded] = useState(false)
  const revision = useRef<string | null>(null)
  const cacheRead = useRef(false)
  const inflight = useRef<Promise<void> | null>(null)
  const refresh = useCallback(() => {
    if (inflight.current) return inflight.current
    const run = (async () => {
      if (!cacheRead.current) {
        cacheRead.current = true
        const cached = await readInventoryCache(railwayUrl)
        if (cached && revision.current === null) { revision.current = cached.revision; setInventory(cached.records); setLoaded(true) }
      }
      try {
        const result = await fetchWebsiteInventory(railwayUrl, revision.current ?? undefined)
        if (!result.unchanged && result.records) {
          setInventory(result.records)
          void writeInventoryCache(railwayUrl, { revision: result.revision, records: result.records })
        }
        revision.current = result.revision
      } catch (error) {
        // With a cached list on screen, a failed refresh keeps it; with nothing to show, say why.
        if (revision.current === null) toastErr(error)
      } finally {
        setLoaded(true)
      }
    })().finally(() => { inflight.current = null })
    inflight.current = run
    return run
  }, [railwayUrl])
  return { inventory, setInventory, loaded, refresh }
}

export type InventoryScan = {
  job: WebsiteInventoryBatchJob | null
  running: boolean
  cancelling: boolean
  start: (jobId: string) => void
  cancel: () => Promise<void>
}

/**
 * Follows the running inventory batch for the whole CRM (not only while the "Add pages" panel is open):
 * merges finished pages into the list every 1.5 s and reloads the full list when the batch ends.
 * The job id survives a reload in localStorage, so a scan started earlier is picked up again.
 */
export function useInventoryScan(railwayUrl: string, setInventory: Dispatch<SetStateAction<WebsiteContentRecord[]>>, reload: () => Promise<void>): InventoryScan {
  const [jobId, setJobId] = useState<string | null>(readJobId)
  const [job, setJob] = useState<WebsiteInventoryBatchJob | null>(null)
  const [cancelling, setCancelling] = useState(false)
  useEffect(() => {
    if (!jobId) return
    let stopped = false
    const finish = async () => {
      writeJobId(null)
      setJobId(null)
      setJob(null)
      await reload()
    }
    void (async () => {
      while (!stopped) {
        try {
          const next = await fetchWebsiteInventoryBatch(jobId, railwayUrl)
          if (stopped) return
          setJob(next)
          setInventory((current) => mergeBatchRecords(current, next.recentRecords))
          if (next.status === "complete" || next.status === "cancelled") return void await finish()
          if (next.status === "failed" && next.done >= next.total) { toastErr(new Error(next.error || "Website inventory batch failed.")); return void await finish() }
        } catch (error) {
          if (stopped) return
          // A batch the server no longer knows ends here; other errors retry on the next tick.
          if (/not found/i.test(error instanceof Error ? error.message : String(error))) return void await finish()
        }
        await new Promise((resolve) => setTimeout(resolve, 1500))
      }
    })()
    return () => { stopped = true }
  }, [jobId, railwayUrl])
  return {
    job, running: Boolean(jobId), cancelling,
    start: (id) => { writeJobId(id); setJob(null); setJobId(id) },
    cancel: async () => {
      if (!jobId || cancelling) return
      setCancelling(true)
      try { await cancelAllWebsiteInventoryBatches(railwayUrl); writeJobId(null); setJobId(null); setJob(null); await reload() }
      catch (error) { toastErr(error) }
      finally { setCancelling(false) }
    },
  }
}

/** One-line scan progress, shared by the table and the "Add pages" panel. */
export function ScanProgress({ scan }: { scan: InventoryScan }) {
  const { tr } = useI18n()
  if (!scan.running) return null
  const done = scan.job?.done ?? 0, total = scan.job?.total ?? 0
  return <div role="status" aria-live="polite" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", margin: 8, padding: "8px 12px", borderRadius: 6, background: "var(--accent-bg)" }}>
    <I n="loader-2" />
    <span className="grow">{total ? tr(`Đang quét ${done}/${total} trang`, `Scanning ${done}/${total} pages`) : tr("Đang bắt đầu quét…", "Starting the scan…")}{scan.job?.summaryLimitReached ? tr(" · hết lượt AI summary hôm nay, vẫn lấy thông tin trang", " · AI summary limit reached today, metadata continues") : ""}</span>
    <span style={{ width: 120, height: 6, borderRadius: 3, background: "var(--bg4)", overflow: "hidden", display: "inline-block" }}><span style={{ display: "block", height: "100%", width: `${total ? Math.round((done / total) * 100) : 0}%`, background: "var(--accent)" }} /></span>
    <button type="button" className="btn" disabled={scan.cancelling} onClick={() => void scan.cancel()}><I n="player-stop" />{scan.cancelling ? tr("Đang dừng…", "Stopping…") : tr("Dừng", "Stop")}</button>
  </div>
}

/**
 * "Add pages" side panel: sitemap / llms.txt, pasted URLs, recheck and summarise. Starting work hands the batch
 * to useInventoryScan, so the panel can be closed while the server keeps scanning and the table keeps updating.
 */
export default function WebsiteInventory({ records, railwayUrl, onChange, scan, reload }: {
  records: WebsiteContentRecord[]
  railwayUrl: string
  onChange: (records: WebsiteContentRecord[]) => void
  scan: InventoryScan
  reload: () => Promise<void>
}) {
  const { tr } = useI18n()
  const [input, setInput] = useState("")
  const [siteUrl, setSiteUrl] = useState("")
  const [onlyNew, setOnlyNew] = useState(true)
  const [aiSummary, setAiSummary] = useState(true)
  const [importing, setImporting] = useState(false)
  const [sitemapResult, setSitemapResult] = useState<SitemapImportResult | null>(null)
  const busy = scan.running || importing
  const queue = (urls: string[]) => {
    const existing = new Set(records.map((item) => item.url))
    onChange([...urls.filter((url) => !existing.has(url)).map(placeholder), ...records])
  }
  const startBatch = async (eventTimeStamp: number, urls: string[], summarize: boolean, mark: (records: WebsiteContentRecord[]) => WebsiteContentRecord[]) => {
    if (!urls.length || busy) return
    onChange(mark(records))
    try {
      const job = await trackHandoff(eventTimeStamp, () => startWebsiteInventoryBatch(urls, railwayUrl, summarize))
      scan.start(job.id)
      toast(tr(`Đã bắt đầu quét ${urls.length} trang. Có thể đóng panel, bảng vẫn cập nhật.`, `Scanning ${urls.length} pages. You can close the panel; the table keeps updating.`))
    } catch (error) {
      toastErr(error)
      await reload()
    }
  }
  const importPasted = (eventTimeStamp: number) => {
    const urls = [...new Set(input.split(/[\n,]+/).flatMap((value) => {
      try { const parsed = new URL(value.trim()); return ["http:", "https:"].includes(parsed.protocol) ? [parsed.toString()] : [] } catch { return [] }
    }))]
    const fresh = urls.filter((url) => !records.some((item) => item.url === url))
    if (!fresh.length) return toast(tr("Không có URL mới hợp lệ.", "No new valid URL."))
    setInput("")
    void startBatch(eventTimeStamp, fresh, aiSummary, (current) => { const existing = new Set(current.map((item) => item.url)); return [...fresh.filter((url) => !existing.has(url)).map(placeholder), ...current] })
  }
  const importSitemap = async (eventTimeStamp: number) => {
    const target = siteUrl.trim()
    if (!target || busy) return
    setImporting(true)
    setSitemapResult(null)
    try {
      const result = await trackHandoff(eventTimeStamp, () => importWebsiteSitemap(/^https?:\/\//i.test(target) ? target : `https://${target}`, railwayUrl, aiSummary, onlyNew))
      setSitemapResult(result)
      if (result.job) { queue(result.job.urls ?? []); scan.start(result.job.id) }
    } catch (error) {
      toastErr(error)
    } finally {
      setImporting(false)
    }
  }
  const recheckAll = (eventTimeStamp: number) =>
    void startBatch(eventTimeStamp, records.map((item) => item.url), true, (current) => current.map((item) => ({ ...item, status: "queued" as const, crawlStatus: "queued" as const })))
  const missingSummary = records.filter((record) => !record.summary && !record.hasSummary && record.status !== "broken")
  const summarizeMissing = (eventTimeStamp: number) =>
    void startBatch(eventTimeStamp, missingSummary.map((item) => item.url), true, (current) => current.map((item) => missingSummary.some((record) => record.id === item.id) ? { ...item, crawlStatus: "summarizing" as const } : item))
  const usable = records.filter((item) => item.eligibleForInternalLink && ["active", "redirected"].includes(item.status)).length
  const hint = { color: "var(--f3)", fontSize: 12 } as const
  return <>
    <ScanProgress scan={scan} />

    <div className="fsec" style={{ paddingTop: 4 }}><I n="sitemap" />&nbsp;{tr("Từ sitemap / llms.txt", "From sitemap / llms.txt")}</div>
    <div className="fields" style={{ paddingTop: 0 }}>
      <div className="frow"><div className="flabel"><I n="world" />Site</div><div className="fval"><input aria-label={tr("Địa chỉ site", "Site address")} placeholder="https://example.com" value={siteUrl} disabled={busy} onChange={(event) => setSiteUrl(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void importSitemap(event.timeStamp) }} /></div></div>
      <div className="frow"><div className="flabel"><I n="filter" />{tr("Chỉ trang mới", "New pages only")}</div><div className="fval"><button role="switch" aria-checked={onlyNew} aria-label={tr("Chỉ quét trang chưa có trong Inventory", "Only scan pages not yet in the inventory")} className={`toggle${onlyNew ? " on" : ""}`} onClick={() => setOnlyNew((value) => !value)} /></div></div>
      <div className="frow"><div className="flabel"><I n="sparkles" />AI summary</div><div className="fval"><button role="switch" aria-checked={aiSummary} aria-label={tr("AI tóm tắt và phân loại trang", "AI summary and classification")} className={`toggle${aiSummary ? " on" : ""}`} onClick={() => setAiSummary((value) => !value)} /><span className="s" style={{ marginLeft: 6 }}>{tr("trang có mô tả trong llms.txt không cần AI", "pages described in llms.txt skip AI")}</span></div></div>
    </div>
    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
      <button type="button" className="btn primary" disabled={busy || !siteUrl.trim()} onClick={(event) => void importSitemap(event.timeStamp)}><I n={importing ? "loader-2" : "download"} />{importing ? tr("Đang đọc sitemap…", "Reading sitemap…") : tr("Nhập từ sitemap", "Import from sitemap")}</button>
    </div>
    {sitemapResult && <div className="box" style={{ marginTop: 8 }} aria-live="polite">
      <div className="box-row" style={{ display: "block" }}>
        <div>{tr(`${sitemapResult.discovered} URL trong ${sitemapResult.sitemapsRead} sitemap · ${sitemapResult.queued} trang đưa vào quét`, `${sitemapResult.discovered} URLs in ${sitemapResult.sitemapsRead} sitemap(s) · ${sitemapResult.queued} pages queued`)}</div>
        <div className="s">{sitemapResult.llmsDescriptions ? tr(`llms.txt: ${sitemapResult.llmsUsed}/${sitemapResult.llmsDescriptions} mô tả được dùng`, `llms.txt: ${sitemapResult.llmsUsed}/${sitemapResult.llmsDescriptions} descriptions used`) : tr("Không có llms.txt", "No llms.txt")}</div>
        {sitemapResult.errors.map((error) => <div key={error} className="s" style={{ color: "var(--danger)" }}>{error}</div>)}
      </div>
      {sitemapResult.missing.length > 0 && <div className="box-row" style={{ display: "block" }}>
        <details>
          <summary className="s" style={{ cursor: "pointer" }}>{tr(`${sitemapResult.missing.length} trang trong Inventory không còn trong sitemap`, `${sitemapResult.missing.length} inventory pages are no longer in the sitemap`)}</summary>
          <div className="s" style={{ margin: "4px 0" }}>{tr("Kiểm tra rồi tự xoá hoặc tắt Internal link nếu trang đã gỡ; tool không tự xoá.", "Review them and delete or turn off Internal link for removed pages; nothing is deleted automatically.")}</div>
          {sitemapResult.missing.slice(0, 50).map((page) => <div key={page.id} className="s" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><a href={page.url} target="_blank" rel="noreferrer">{page.title || page.url}</a></div>)}
        </details>
      </div>}
    </div>}

    <div className="fsec"><I n="clipboard-text" />&nbsp;{tr("Dán URL", "Paste URLs")}</div>
    <textarea rows={3} className="inp" style={{ height: 76, padding: 8, resize: "vertical", width: "100%" }} aria-label="Website URLs" value={input} disabled={busy} onChange={(event) => setInput(event.target.value)} placeholder={tr("Mỗi dòng một URL", "One URL per line")} />
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
      <span className="grow" style={hint}>{tr("Chặn địa chỉ mạng nội bộ và file không phải HTML.", "Private-network addresses and non-HTML files are blocked.")}</span>
      <button type="button" className="btn primary" disabled={busy || !input.trim()} onClick={(event) => importPasted(event.timeStamp)}><I n={aiSummary ? "sparkles" : "world"} />{tr("Nhập URL", "Import URLs")}</button>
    </div>

    <div className="fsec"><I n="refresh" />&nbsp;{tr("Trang đã có", "Existing pages")}<span className="muted" style={{ fontWeight: 400 }}>&nbsp;· {tr(`${records.length} trang, ${usable} dùng làm internal link`, `${records.length} pages, ${usable} usable as internal links`)}</span></div>
    <div className="box">
      <div className="box-row"><div className="grow">{tr("Quét lại tất cả", "Recheck all")}<div className="s">{tr("Kiểm tra lại trạng thái và nội dung mọi trang.", "Checks every page's status and content again.")}</div></div><button type="button" className="btn" disabled={busy || !records.length} onClick={(event) => recheckAll(event.timeStamp)}><I n="refresh" />{tr("Quét lại", "Recheck")}</button></div>
      <div className="box-row"><div className="grow">{tr("Tóm tắt trang còn thiếu", "Summarise missing")}<div className="s">{tr(`${missingSummary.length} trang chưa có summary.`, `${missingSummary.length} pages have no summary.`)}</div></div><button type="button" className="btn" disabled={busy || !missingSummary.length} onClick={(event) => summarizeMissing(event.timeStamp)}><I n="sparkles" />{tr("Tóm tắt", "Summarise")}</button></div>
    </div>
  </>
}

const PAGE_TYPES: WebsiteContentRecord["contentType"][] = ["blog", "service", "portfolio", "landing", "about", "commercial"]
const EDITABLE_STATUSES: WebsiteContentRecord["status"][] = ["active", "redirected", "unchecked", "broken"]
const splitList = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean)

/** One inventory page in the Website Inventory side panel: what AI knows about it, edits, recheck and delete. */
export function PageDetails({ record: listRecord, railwayUrl, canEdit, onChange, onDelete }: {
  record: WebsiteContentRecord
  railwayUrl: string
  canEdit: boolean
  onChange: (record: WebsiteContentRecord) => void
  onDelete: () => void
}) {
  const { tr } = useI18n()
  const [busy, setBusy] = useState(false)
  // The table list is light; the summary, anchors and claims come with the full record, fetched once per open.
  const [full, setFull] = useState<WebsiteContentRecord | null>(null)
  useEffect(() => {
    let stale = false
    setFull(null)
    fetchWebsiteInventoryRecord(listRecord.id, railwayUrl).then((next) => { if (!stale) setFull(next) }, () => { /* the light record still shows */ })
    return () => { stale = true }
  }, [listRecord.id, railwayUrl])
  // List fields (kept current by edits and rechecks) over the full record's summary, anchors and claims.
  const record: WebsiteContentRecord = full ? { ...full, ...listRecord } : listRecord
  const [topics, setTopics] = useState(record.topics.join(", "))
  const [services, setServices] = useState((record.services ?? []).join(", "))
  useEffect(() => { setTopics(record.topics.join(", ")); setServices((record.services ?? []).join(", ")) }, [record.id, record.topics, record.services])
  const save = async (patch: Partial<WebsiteContentRecord>) => {
    const previous = record
    onChange({ ...record, ...patch })
    try { await updateWebsiteInventoryRecord(record.id, patch, railwayUrl) } catch (error) { onChange(previous); toastErr(error) }
  }
  const recheck = async () => {
    setBusy(true)
    try { onChange({ ...(await scanWebsiteUrl(record.url, railwayUrl, true)), id: record.id }) }
    catch (error) { toastErr(error) }
    finally { setBusy(false) }
  }
  const remove = async () => {
    if (!window.confirm(tr(`Xoá ${record.url} khỏi Website Inventory? AI sẽ không đề xuất URL này làm internal link nữa.`, `Remove ${record.url} from Website Inventory? AI will stop suggesting it as an internal link.`))) return
    setBusy(true)
    try { await deleteWebsiteInventoryRecord(record.id, railwayUrl); onDelete() } catch (error) { toastErr(error) } finally { setBusy(false) }
  }
  const usable = record.eligibleForInternalLink && ["active", "redirected"].includes(record.status)
  const source = record.summarySource === "llms.txt" || record.aiModel === "llms.txt" ? "llms.txt" : record.summarizedAt ? (record.summaryCacheHit ? tr("AI (cache)", "AI (cached)") : record.aiModel || "AI") : null
  return <>
    <div className="fsec"><I n="world" />&nbsp;{tr("Trang", "Page")}</div>
    <div className="fields" style={{ paddingTop: 0 }}>
      <div className="frow"><div className="flabel"><I n="link" />URL</div><div className="fval"><a href={record.url} target="_blank" rel="noreferrer" title={record.url} style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{record.url}</a></div></div>
      {(record.redirectTarget || (record.canonicalUrl && record.canonicalUrl !== record.url)) && <div className="frow"><div className="flabel"><I n="arrow-forward" />{record.redirectTarget ? "Redirect" : "Canonical"}</div><div className="fval"><span className="muted" title={record.redirectTarget || record.canonicalUrl}>{record.redirectTarget || record.canonicalUrl}</span></div></div>}
      <div className="frow"><div className="flabel"><I n="progress-check" />Status</div><div className="fval">{canEdit && EDITABLE_STATUSES.includes(record.status) ? <select aria-label="Status" value={record.status} disabled={busy} onChange={(event) => { const status = event.target.value as WebsiteContentRecord["status"]; void save({ status, eligibleForInternalLink: status === "active" || status === "redirected" }) }}>{EDITABLE_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}</select> : record.status}</div></div>
      <div className="frow"><div className="flabel"><I n="category" />{tr("Loại trang", "Page type")}</div><div className="fval">{canEdit ? <select aria-label={tr("Loại trang", "Page type")} value={record.contentType} disabled={busy} onChange={(event) => void save({ contentType: event.target.value as WebsiteContentRecord["contentType"] })}>{PAGE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select> : record.contentType}</div></div>
      <div className="frow"><div className="flabel"><I n="link-plus" />Internal link</div><div className="fval"><button role="switch" aria-checked={record.eligibleForInternalLink} aria-label={tr("Cho AI dùng trang này làm internal link", "Let AI use this page as an internal link")} disabled={!canEdit || busy} className={`toggle${record.eligibleForInternalLink ? " on" : ""}`} onClick={() => void save({ eligibleForInternalLink: !record.eligibleForInternalLink })} />{record.eligibleForInternalLink && !usable && <span className="s" style={{ marginLeft: 6 }}>{tr("chưa dùng được: trang không hoạt động", "not usable: page is not live")}</span>}</div></div>
      <div className="frow"><div className="flabel"><I n="target" />{tr("Chủ đề chính", "Primary topic")}</div><div className="fval">{record.primaryTopic || <span className="empty">Empty</span>}</div></div>
      <div className="frow"><div className="flabel"><I n="tags" />Topics</div><div className="fval"><input aria-label="Topics" disabled={!canEdit || busy} value={topics} onChange={(event) => setTopics(event.target.value)} onBlur={() => { const next = splitList(topics); if (next.join(",") !== record.topics.join(",")) void save({ topics: next }) }} /></div></div>
      <div className="frow"><div className="flabel"><I n="briefcase" />Services</div><div className="fval"><input aria-label="Services" disabled={!canEdit || busy} value={services} onChange={(event) => setServices(event.target.value)} onBlur={() => { const next = splitList(services); if (next.join(",") !== (record.services ?? []).join(",")) void save({ services: next }) }} /></div></div>
      <div className="frow"><div className="flabel"><I n="search" />Intent</div><div className="fval">{record.searchIntent ?? <span className="empty">Empty</span>}</div></div>
      <div className="frow"><div className="flabel"><I n="calendar" />{tr("Kiểm tra lúc", "Checked")}</div><div className="fval">{record.lastChecked ? new Date(record.lastChecked).toLocaleString() : "—"}{record.httpStatus ? <span className="muted">&nbsp;· HTTP {record.httpStatus}</span> : null}</div></div>
      {record.lastError && <div className="frow"><div className="flabel"><I n="alert-triangle" />{tr("Lỗi", "Error")}</div><div className="fval"><span style={{ color: "var(--danger)" }} title={record.lastError}>{record.lastError}</span></div></div>}
    </div>
    <div className="fsec"><I n="file-description" />&nbsp;{tr("AI đọc gì về trang này", "What AI knows about this page")}</div>
    <div className="fields" style={{ paddingTop: 0 }}>
      <div className="frow"><div className="flabel"><I n="sparkles" />{tr("Nguồn tóm tắt", "Summary source")}</div><div className="fval">{source ?? <span className="empty">{tr("Chưa có", "None")}</span>}</div></div>
    </div>
    <p style={{ color: "var(--f2)", margin: "4px 0 8px", whiteSpace: "pre-wrap" }}>{record.summary || record.description || <span style={{ color: "var(--f4)" }}>{tr("Chưa có tóm tắt.", "No summary yet.")}</span>}</p>
    {(record.internalLinkAnchors?.length ?? 0) > 0 && <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>{record.internalLinkAnchors!.map((anchor) => <span key={anchor} className="tag t-blue">{anchor}</span>)}</div>}
    <div style={{ display: "flex", gap: 6, marginTop: 14 }}>
      <button className="btn" disabled={busy} onClick={() => void recheck()}><I n={busy ? "loader-2" : "refresh"} />{tr("Quét lại", "Recheck")}</button>
      {canEdit && <button className="btn" style={{ marginLeft: "auto", color: "var(--danger)" }} disabled={busy} onClick={() => void remove()}><I n="trash" />{tr("Xoá", "Delete")}</button>}
    </div>
  </>
}
