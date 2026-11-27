import { useEffect, useRef, useState } from "react"
import type { WebsiteContentRecord } from "../types"
import {
  cancelAllWebsiteInventoryBatches,
  deleteWebsiteInventoryRecord,
  fetchWebsiteInventory,
  fetchWebsiteInventoryBatch,
  importWebsiteSitemap,
  scanWebsiteUrl,
  type SitemapImportResult,
  startWebsiteInventoryBatch,
  updateWebsiteInventoryRecord,
} from "../lib/db"
import { useI18n } from "../lib/i18n"
import { I, toastErr, trackHandoff } from "./ui"

/**
 * Website Inventory import: sitemap / llms.txt, pasted URLs, rescan and summarise, with live progress.
 * Shown in the "Add pages" side panel of the Website Inventory object; the page list is the CRM table.
 */
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
  const [siteUrl, setSiteUrl] = useState("")
  const [onlyNew, setOnlyNew] = useState(true)
  const [importing, setImporting] = useState(false)
  const [sitemapResult, setSitemapResult] = useState<SitemapImportResult | null>(null)
  const [scanning, setScanning] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [includeAiSummary, setIncludeAiSummary] = useState(true)
  const [scanProgress, setScanProgress] = useState({ done: 0, total: 0 })
  const [summaryLimitReached, setSummaryLimitReached] = useState(false)
  const resumeStarted = useRef(false)
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
  const scan = async () => {
    const started = performance.now()
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
      const job = await trackHandoff(started, () => startWebsiteInventoryBatch(
        pending.map((item) => item.url),
        railwayUrl,
        includeAiSummary,
      ))
      localStorage.setItem("writer:website-inventory-active-job", job.id)
      setActiveJobId(job.id)
      await monitorBatch(job.id, current)
    } catch {
      setScanning(false)
    }
  }
  const importSitemap = async (eventTimeStamp: number) => {
    const target = siteUrl.trim()
    if (!target || scanning || importing) return
    setImporting(true)
    setSitemapResult(null)
    try {
      const result = await trackHandoff(eventTimeStamp, () => importWebsiteSitemap(/^https?:\/\//i.test(target) ? target : `https://${target}`, railwayUrl, includeAiSummary, onlyNew))
      setSitemapResult(result)
      if (!result.job) return
      const existing = new Set(records.map((item) => item.url))
      const pending = (result.job.urls ?? []).filter((url) => !existing.has(url)).map((url, index): WebsiteContentRecord => ({
        id: `pending-${Date.now()}-${index}`, url, title: new URL(url).hostname, contentType: "blog", topics: [], services: [], status: "queued", crawlStatus: "queued", eligibleForInternalLink: false,
      }))
      const current = [...pending, ...records]
      onChange(current)
      setSummaryLimitReached(false)
      setScanning(true)
      setScanProgress({ done: 0, total: result.job.total })
      localStorage.setItem("writer:website-inventory-active-job", result.job.id)
      setActiveJobId(result.job.id)
      await monitorBatch(result.job.id, current).catch(() => setScanning(false))
    } catch (error) {
      toastErr(error)
    } finally {
      setImporting(false)
    }
  }
  const recheckAll = async () => {
    const started = performance.now()
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
      const job = await trackHandoff(started, () => startWebsiteInventoryBatch(records.map((item) => item.url), railwayUrl, true))
      localStorage.setItem("writer:website-inventory-active-job", job.id)
      setActiveJobId(job.id)
      await monitorBatch(job.id, current)
    } catch {
      setScanning(false)
    }
  }
  const summarizeMissing = async () => {
    const started = performance.now()
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
      const job = await trackHandoff(started, () => startWebsiteInventoryBatch(pending.map((item) => item.url), railwayUrl, true))
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
  return (
    <>
      <div>
        <div className="fsec" style={{ paddingTop: 0 }}><I n="download" />&nbsp;{tr("Nhập trang", "Import pages")}</div>
        <p style={{ color: "var(--f3)", fontSize: 12, margin: "0 0 8px" }}>{tr("Nhập từ sitemap của site, hoặc dán từng URL. Railway kiểm tra từng trang và lấy thông tin tự động.", "Import from the site's sitemap, or paste URLs. Railway checks each page and extracts its metadata automatically.")}</p>
        <div className="box" style={{ marginBottom: 12 }}>
          <div className="box-row" style={{ flexWrap: "wrap" }}>
            <I n="sitemap" />
            <div className="grow" style={{ minWidth: 200 }}>
              {tr("Nhập từ sitemap / llms.txt", "Import from sitemap / llms.txt")}
              <div className="s">{tr("Đọc sitemap (khai báo trong robots.txt, hoặc /sitemap.xml) và llms.txt. Trang có mô tả trong llms.txt dùng mô tả đó thay cho AI summary.", "Reads the sitemap (declared in robots.txt, or /sitemap.xml) and llms.txt. Pages described in llms.txt use that description instead of an AI summary.")}</div>
            </div>
          </div>
          <div className="box-row" style={{ flexWrap: "wrap" }}>
            <input className="inp" style={{ flex: "1 1 240px", width: "auto" }} aria-label={tr("Địa chỉ site", "Site address")} placeholder="https://example.com" value={siteUrl} onChange={(event) => setSiteUrl(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void importSitemap(event.timeStamp) }} />
            <label style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--f2)" }}>
              <input type="checkbox" checked={onlyNew} onChange={(event) => setOnlyNew(event.target.checked)} />
              {tr("Chỉ trang chưa có", "New pages only")}
            </label>
            <button type="button" className="btn primary" disabled={scanning || importing || !siteUrl.trim()} onClick={(event) => void importSitemap(event.timeStamp)}>
              <I n={importing ? "loader-2" : "download"} />{importing ? tr("Đang đọc sitemap…", "Reading sitemap…") : tr("Nhập từ sitemap", "Import from sitemap")}
            </button>
          </div>
          {sitemapResult && <div className="box-row" style={{ display: "block" }} aria-live="polite">
            <div>{tr(`Tìm thấy ${sitemapResult.discovered} URL trong ${sitemapResult.sitemapsRead} sitemap · ${sitemapResult.queued} trang đưa vào quét`, `Found ${sitemapResult.discovered} URLs in ${sitemapResult.sitemapsRead} sitemap(s) · ${sitemapResult.queued} pages queued`)}{sitemapResult.llmsDescriptions ? tr(` · llms.txt: ${sitemapResult.llmsUsed}/${sitemapResult.llmsDescriptions} mô tả được dùng`, ` · llms.txt: ${sitemapResult.llmsUsed}/${sitemapResult.llmsDescriptions} descriptions used`) : tr(" · không có llms.txt", " · no llms.txt")}</div>
            {sitemapResult.errors.map((error) => <div key={error} className="s">{error}</div>)}
            {sitemapResult.missing.length > 0 && <details style={{ marginTop: 6 }}>
              <summary className="s" style={{ cursor: "pointer" }}>{tr(`${sitemapResult.missing.length} trang trong Inventory không còn trong sitemap`, `${sitemapResult.missing.length} inventory pages are no longer in the sitemap`)}</summary>
              <div className="s" style={{ marginTop: 4 }}>{tr("Kiểm tra rồi tự xoá hoặc bỏ duyệt nếu trang đã gỡ; tool không tự xoá.", "Review them and delete or unapprove pages that were removed; nothing is deleted automatically.")}</div>
              {sitemapResult.missing.slice(0, 50).map((page) => <div key={page.id} className="s"><a href={page.url} target="_blank" rel="noreferrer">{page.title || page.url}</a></div>)}
            </details>}
          </div>}
        </div>
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
      </div>
      <div>
        <div className="fsec"><I n="refresh" />&nbsp;{tr("Cập nhật trang đã có", "Update existing pages")}</div>
        <p style={{ color: "var(--f3)", fontSize: 12, margin: "0 0 8px" }}>{tr(`${records.length} trang · ${records.filter((item) => item.eligibleForInternalLink && ["active", "redirected"].includes(item.status)).length} được dùng làm internal link`, `${records.length} pages · ${records.filter((item) => item.eligibleForInternalLink && ["active", "redirected"].includes(item.status)).length} usable as internal links`)}</p>
        <div className="box">
          <div className="box-row" style={{ flexWrap: "wrap" }}>
            <div className="grow" style={{ minWidth: 200 }}>{tr("Quét lại tất cả", "Recheck all")}<div className="s">{tr("Kiểm tra lại trạng thái và nội dung mọi trang.", "Checks the status and content of every page again.")}</div></div>
            <button type="button" className="btn" disabled={scanning || !records.length} onClick={() => void recheckAll()}><I n="refresh" />{tr("Quét lại", "Recheck")}</button>
          </div>
          <div className="box-row" style={{ flexWrap: "wrap" }}>
            <div className="grow" style={{ minWidth: 200 }}>{tr("Tóm tắt trang còn thiếu", "Summarise missing pages")}<div className="s">{tr("AI tóm tắt các trang chưa có summary.", "AI summarises pages that have no summary yet.")}</div></div>
            <button type="button" className="btn" disabled={scanning || !records.some((item) => !item.summary && item.status !== "broken")} onClick={() => void summarizeMissing()}><I n="sparkles" />{tr("Tóm tắt", "Summarise")}</button>
          </div>
        </div>
      </div>
    </>
  )
}

const PAGE_TYPES: WebsiteContentRecord["contentType"][] = ["blog", "service", "portfolio", "landing", "about", "commercial"]
const EDITABLE_STATUSES: WebsiteContentRecord["status"][] = ["active", "redirected", "unchecked", "broken"]
const splitList = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean)

/** One inventory page in the Website Inventory side panel: what AI knows about it, edits, recheck and delete. */
export function PageDetails({ record, railwayUrl, canEdit, onChange, onDelete }: {
  record: WebsiteContentRecord
  railwayUrl: string
  canEdit: boolean
  onChange: (record: WebsiteContentRecord) => void
  onDelete: () => void
}) {
  const { tr } = useI18n()
  const [busy, setBusy] = useState(false)
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
