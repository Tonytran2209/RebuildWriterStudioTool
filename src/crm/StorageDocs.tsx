import { useRef, useState, type ReactNode } from "react"
import type { ActionDataSource, ActionSourceType, DocumentFile, FileCategory, KnowledgeMetadata, ManualRow } from "../types"
import { uploadDocumentToRailway } from "../lib/railwayUpload"
import { importSourceThroughRailway } from "../lib/railwayImport"
import { downloadDocumentFromRailway } from "../lib/railwayDownload"
import { isDocumentReady } from "../lib/documentStatus"
import { useI18n } from "../lib/i18n"
import { updateFileGroup } from "../lib/db"
import { DOC_GROUPS, groupOf } from "./model"
import { BRAND_CONTEXT_TYPES, storageGroupInfo } from "../../shared/gateDocuments"
import { I, trackHandoff } from "./ui"

const uid = () => Math.random().toString(36).slice(2, 9)
const now = () => new Date().toISOString()
const shortDate = () => new Date().toLocaleDateString("vi-VN")
const rowsOf = (text: string) => text.split("\n").filter(Boolean).length
const head = (text: string, n = 4) => text.split("\n").slice(0, n).join("\n")

/** Server import/upload record → library document (same mapping as the former Knowledge & Rules page). */
export function toDocument(source: ActionDataSource & { uploadedAt?: string }, category: FileCategory): DocumentFile {
  return {
    ...source, category,
    uploadedAt: source.uploadedAt ?? source.addedAt ?? now(),
    size: source.size ?? `${new Blob([source.content ?? ""]).size} B`,
    fileType: (source.fileType ?? (source.sourceType === "manual" ? "csv" : "txt")) as DocumentFile["fileType"],
  } as DocumentFile
}

const MODES: Array<[ActionSourceType, string, string]> = [
  ["file", "upload", "File"], ["paste", "clipboard-text", "Paste"], ["url", "link", "URL / API"], ["gsheet", "table", "Google Sheets"],
  ["manual", "table-plus", "Manual"], ["supabase", "database", "Supabase"], ["airtable", "plug", "Airtable"],
]

/** Body of the Storage "Add document" panel: upload or import, saved on the server before it reaches the list. */
export function AddDocForm({ railwayUrl, onAdded, onSourceData }: { railwayUrl: string; onAdded: (docs: DocumentFile[]) => Promise<void>; onSourceData?: () => void }) {
  const { tr } = useI18n()
  const [group, setGroup] = useState(DOC_GROUPS[0][0])
  const info = DOC_GROUPS.find(([g]) => g === group)
  const category: FileCategory = info?.[1] ?? "kb"
  const [mode, setMode] = useState<ActionSourceType>("file")
  const [busy, setBusy] = useState("")
  const [error, setError] = useState("")
  const [done, setDone] = useState("")
  const [name, setName] = useState("")
  const [text, setText] = useState("")
  const [fmt, setFmt] = useState<"csv" | "json" | "text">("csv")
  const [url, setUrl] = useState("")
  const [headers, setHeaders] = useState<Array<[string, string]>>([])
  const [query, setQuery] = useState("SELECT * FROM keywords LIMIT 100;")
  const [air, setAir] = useState({ key: "", base: "", table: "" })
  const [columns, setColumns] = useState(["Từ khóa", "Volume", "Độ khó"])
  const [rows, setRows] = useState<ManualRow[]>([{ id: uid(), cells: ["", "", ""] }])
  const fileRef = useRef<HTMLInputElement>(null)
  const sheetId = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1] ?? null

  const finish = async (docs: DocumentFile[], failures: string[] = []) => {
    // The group is saved on each stored record so Storage and Settings › Shipper list it in the same place.
    const grouped = await Promise.all(docs.map(d => updateFileGroup(d.id, group)))
    if (grouped.length) await onAdded(grouped)
    setError(failures.join("\n"))
    setDone(grouped.length ? tr(`Đã lưu ${grouped.length} tài liệu vào ${group}.`, `Saved ${grouped.length} document(s) to ${group}.`) : "")
  }
  const upload = async (list: FileList | null) => {
    if (!list?.length || busy) return
    const started = performance.now()
    setBusy(tr("Đang trích xuất và lưu…", "Extracting and saving…")); setError(""); setDone("")
    const docs: DocumentFile[] = [], failures: string[] = []
    for (const [i, f] of Array.from(list).entries()) {
      setBusy(`${i + 1}/${list.length}: ${f.name}`)
      try {
        if (f.size > 15 * 1024 * 1024) throw new Error(tr("File vượt quá 15 MB", "File exceeds 15 MB"))
        const { record } = await trackHandoff(started, () => uploadDocumentToRailway(f, category, railwayUrl))
        docs.push(toDocument({ ...(record as ActionDataSource), sourceType: "file" }, category))
      } catch (err) { failures.push(`${f.name}: ${err instanceof Error ? err.message : String(err)}`) }
    }
    try { await finish(docs, failures) } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(""); if (fileRef.current) fileRef.current.value = "" }
  }
  const sourceFor = (): ActionDataSource | null => {
    const base = { id: uid(), addedAt: now() }
    if (mode === "paste") return text.trim() ? { ...base, name: name || `Paste ${fmt.toUpperCase()} ${shortDate()}`, sourceType: "paste", contentUpdatedAt: now(), content: text, preview: head(text), rowCount: rowsOf(text) } : null
    if (mode === "url") return url ? { ...base, name: name || url, sourceType: "url", url, headers: headers.length ? Object.fromEntries(headers) : undefined, contentUpdatedAt: now(), preview: url } : null
    if (mode === "gsheet") return sheetId ? { ...base, name: name || `Google Sheets — ${sheetId.slice(0, 8)}`, sourceType: "gsheet", url: `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`, contentUpdatedAt: now(), preview: "Google Sheets public CSV" } : null
    if (mode === "supabase") return query.trim() ? { ...base, name: name || `Supabase Query ${shortDate()}`, sourceType: "supabase", query, preview: query } : null
    if (mode === "airtable") return air.key && air.base && air.table ? { ...base, name: name || `Airtable — ${air.table}`, sourceType: "airtable", airtableKey: air.key, airtableBase: air.base, airtableTable: air.table, preview: `Airtable: ${air.base} / ${air.table}` } : null
    if (mode === "manual") { const content = [columns.join(","), ...rows.map(r => r.cells.join(","))].join("\n"); return { ...base, name: name || `Bảng thủ công ${shortDate()}`, sourceType: "manual", columns, rows, content, contentUpdatedAt: now(), preview: head(content), rowCount: rows.length } }
    return null
  }
  const importSource = async () => {
    const source = sourceFor()
    if (!source || busy) return
    const started = performance.now()
    setBusy(tr("Đang nhập và lưu nội dung…", "Importing and saving content…")); setError(""); setDone("")
    try {
      const { record } = await trackHandoff(started, () => importSourceThroughRailway(source, category, railwayUrl))
      await finish([toDocument(record as ActionDataSource, category)])
      setName(""); setText(""); setUrl(""); setHeaders([]); setAir({ key: "", base: "", table: "" }); setRows([{ id: uid(), cells: columns.map(() => "") }])
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy("") }
  }
  const ready = mode !== "file" && Boolean(sourceFor())
  const lbl = (label: string, el: ReactNode) => <label style={{ display: "flex", flexDirection: "column", gap: 6, color: "var(--f3)", fontSize: 12 }}>{label}{el}</label>

  return <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
    <div className="fields" style={{ paddingTop: 0 }}>
      <div className="frow"><div className="flabel"><I n="folder" />Group</div><div className="fval"><select aria-label="Group" value={group} disabled={Boolean(busy)} onChange={e => { setGroup(e.target.value); setError(""); setDone("") }}>{DOC_GROUPS.map(([g]) => <option key={g} value={g}>{g}</option>)}<option value="Source data">Source data · Content Plan</option></select></div></div>
    </div>
    {!info ? <>
      <div className="muted" style={{ color: "var(--f3)" }}>{tr("Content Plan / source data được AI đọc và phân loại thành topic, không lưu như tài liệu tham khảo.", "Content plans / source data are read by AI and classified into topics, not stored as reference documents.")}</div>
      {onSourceData && <button className="btn primary lg" style={{ justifyContent: "center" }} onClick={onSourceData}><I n="sparkles" />{tr("Thêm Content Plan", "Add Content Plan")}</button>}
    </> : <>
    <div className="muted" style={{ color: "var(--f3)" }}>{tr(info[2], info[3])} {tr("Tài liệu mới chưa được cấp cho gate nào — bật trong Settings › Shipper.", "New documents are not given to any gate yet — enable them in Settings › Shipper.")}</div>
    <div role="tablist" aria-label={tr("Cách nhập", "Import method")} style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {MODES.map(([id, icon, label]) => <button key={id} role="tab" aria-selected={mode === id} className={`btn${mode === id ? " primary" : ""}`} onClick={() => { setMode(id); setError(""); setDone("") }}><I n={icon} />{label}</button>)}
    </div>

    {mode === "file" && <button type="button" className="box" disabled={Boolean(busy)} onClick={() => fileRef.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void upload(e.dataTransfer.files) }} style={{ padding: 24, textAlign: "center", borderStyle: "dashed", background: "var(--bg2)", cursor: "pointer", color: "var(--f2)" }}>
      <I n="upload" s={{ fontSize: 24, color: "var(--f3)" }} /><div style={{ marginTop: 6 }}>{tr("Kéo thả hoặc chọn nhiều file", "Drop or choose files")}</div>
      <div style={{ color: "var(--f3)", fontSize: 12, marginTop: 2 }}>DOCX · PDF · TXT · MD · CSV · XLSX · JSON · XML · TSV · 15 MB/file</div>
      <input ref={fileRef} type="file" multiple hidden aria-label={tr("Chọn file", "Choose files")} accept=".docx,.md,.csv,.xlsx,.json,.pdf,.txt,.xml,.tsv" onChange={e => void upload(e.target.files)} />
    </button>}
    {mode !== "file" && lbl(tr("Tên nguồn (tuỳ chọn)", "Source name (optional)"), <input className="inp" value={name} onChange={e => setName(e.target.value)} />)}
    {mode === "paste" && <>
      <div style={{ display: "flex", gap: 4 }}>{(["csv", "json", "text"] as const).map(f => <button key={f} className={`btn${fmt === f ? " primary" : " ghost"}`} onClick={() => setFmt(f)}>{f.toUpperCase()}</button>)}</div>
      <textarea className="inp" aria-label={tr("Nội dung", "Content")} rows={8} style={{ height: "auto", padding: 8, fontFamily: "monospace" }} value={text} onChange={e => setText(e.target.value)} placeholder={fmt === "csv" ? "keyword,volume,difficulty\ncontent marketing,8100,45" : fmt === "json" ? '[{"keyword":"content marketing","volume":8100}]' : tr("Văn bản thuần…", "Plain text…")} />
      <div style={{ color: "var(--f3)", fontSize: 12 }}>{rowsOf(text)} {tr("dòng", "rows")} · {text.length} {tr("ký tự", "characters")}</div>
    </>}
    {mode === "url" && <>
      {lbl("URL", <input className="inp" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://api.example.com/keywords" />)}
      <div style={{ color: "var(--f3)", fontSize: 12 }}>Headers (Authorization, API-Key…)</div>
      {headers.map(([k, v], i) => <div key={i} style={{ display: "flex", gap: 6 }}><input className="inp" aria-label="Header key" value={k} onChange={e => setHeaders(h => h.map((x, j) => j === i ? [e.target.value, x[1]] : x))} /><input className="inp" aria-label="Header value" value={v} onChange={e => setHeaders(h => h.map((x, j) => j === i ? [x[0], e.target.value] : x))} /><button className="icon-btn" aria-label={tr("Xoá header", "Remove header")} onClick={() => setHeaders(h => h.filter((_, j) => j !== i))}><I n="x" /></button></div>)}
      <button className="btn ghost" style={{ alignSelf: "flex-start" }} onClick={() => setHeaders(h => [...h, ["", ""]])}><I n="plus" />Header</button>
      <div style={{ color: "var(--f3)", fontSize: 12 }}>{tr("Railway gọi URL, kiểm tra HTTP và chỉ lưu khi nhận được nội dung hợp lệ.", "Railway fetches the URL, checks HTTP and saves only valid content.")}</div>
    </>}
    {mode === "gsheet" && <>
      {lbl("Google Sheets URL", <input className="inp" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." />)}
      <div style={{ color: "var(--f3)", fontSize: 12 }}>{tr("Sheet phải được chia sẻ công khai (Anyone with the link → Viewer).", "The sheet must be public (Anyone with the link → Viewer).")}{sheetId && <> · Sheet ID: {sheetId}</>}</div>
    </>}
    {mode === "supabase" && <>
      {lbl("SQL (SELECT)", <textarea className="inp" rows={5} style={{ height: "auto", padding: 8, fontFamily: "monospace" }} value={query} onChange={e => setQuery(e.target.value)} />)}
      <div style={{ color: "var(--f3)", fontSize: 12 }}>{tr("Railway thực thi query trên Supabase project đã kết nối. Chỉ dùng SELECT.", "Railway runs the query on the connected Supabase project. SELECT only.")}</div>
    </>}
    {mode === "airtable" && <>
      {lbl("Personal Access Token", <input className="inp" type="password" autoComplete="off" value={air.key} onChange={e => setAir(a => ({ ...a, key: e.target.value }))} placeholder="pat..." />)}
      <div style={{ display: "flex", gap: 8 }}>{lbl("Base ID", <input className="inp" value={air.base} onChange={e => setAir(a => ({ ...a, base: e.target.value }))} placeholder="app..." />)}{lbl("Table", <input className="inp" value={air.table} onChange={e => setAir(a => ({ ...a, table: e.target.value }))} />)}</div>
      <div style={{ color: "var(--f3)", fontSize: 12 }}>{tr("Token chỉ gửi một lần cho Railway để import và không được lưu.", "The token is sent once to Railway for the import and is not stored.")}</div>
    </>}
    {mode === "manual" && <>
      <div className="box" style={{ overflowX: "auto" }}><table className="tbl" style={{ width: "100%" }}><thead><tr>{columns.map((c, ci) => <th key={ci} style={{ position: "static" }}><span style={{ display: "flex", gap: 4 }}><input className="inp" aria-label={tr(`Tên cột ${ci + 1}`, `Column ${ci + 1} name`)} value={c} onChange={e => setColumns(cs => cs.map((x, j) => j === ci ? e.target.value : x))} />{columns.length > 1 && <button className="icon-btn" aria-label={tr("Xoá cột", "Remove column")} onClick={() => { setColumns(cs => cs.filter((_, j) => j !== ci)); setRows(rs => rs.map(r => ({ ...r, cells: r.cells.filter((_, j) => j !== ci) }))) }}><I n="x" /></button>}</span></th>)}<th style={{ position: "static", width: 32 }} /></tr></thead>
        <tbody>{rows.map(r => <tr key={r.id}>{r.cells.map((cell, ci) => <td key={ci}><input className="inp" aria-label={tr(`Ô ${columns[ci]}`, `${columns[ci]} cell`)} value={cell} onChange={e => setRows(rs => rs.map(x => x.id === r.id ? { ...x, cells: x.cells.map((v, j) => j === ci ? e.target.value : v) } : x))} /></td>)}<td><button className="icon-btn" aria-label={tr("Xoá hàng", "Remove row")} onClick={() => setRows(rs => rs.filter(x => x.id !== r.id))}><I n="x" /></button></td></tr>)}</tbody></table></div>
      <div style={{ display: "flex", gap: 6 }}><button className="btn ghost" onClick={() => { setColumns(cs => [...cs, `Cột ${cs.length + 1}`]); setRows(rs => rs.map(r => ({ ...r, cells: [...r.cells, ""] }))) }}><I n="plus" />{tr("Cột", "Column")}</button><button className="btn ghost" onClick={() => setRows(rs => [...rs, { id: uid(), cells: columns.map(() => "") }])}><I n="plus" />{tr("Hàng", "Row")}</button></div>
    </>}

    {busy && <div role="status" style={{ color: "var(--accent)" }}><I n="loader-2" /> {busy}</div>}
    {done && !busy && <div role="status" style={{ color: "var(--c-green)" }}><I n="circle-check" /> {done}</div>}
    {error && <div role="alert" style={{ color: "var(--danger)", whiteSpace: "pre-line" }}>{error}</div>}
    {mode !== "file" && <button className="btn primary lg" disabled={!ready || Boolean(busy)} onClick={() => void importSource()}><I n="download" />{tr("Nhập qua Railway", "Import through Railway")}</button>}
    </>}
  </div>
}

const KNOWLEDGE_TYPES: KnowledgeMetadata["type"][] = ["reference", "usp", "positioning", "brand_voice", "client_insight", "case_study", "framework", "approved_claim", "production_insight"]
const DEFAULT_META: KnowledgeMetadata = { type: "reference", topics: [], visibility: "internal", approvedForExternalUse: false }

/** Real-file part of the Storage document panel: governance, preview, download and delete. */
export function DocDetails({ file, railwayUrl, canEdit, onSave, onGroup, onDelete }: { file: DocumentFile; railwayUrl: string; canEdit: boolean; onSave: (file: DocumentFile) => Promise<void>; onGroup?: (group: string) => Promise<void>; onDelete: () => Promise<void> }) {
  const { tr } = useI18n()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [topics, setTopics] = useState((file.knowledgeMetadata ?? DEFAULT_META).topics.join(", "))
  const meta = file.knowledgeMetadata ?? DEFAULT_META
  const run = async (job: () => Promise<void>) => { setBusy(true); setError(""); try { await job() } catch (err) { setError(err instanceof Error ? err.message : String(err)) } finally { setBusy(false) } }
  const setMeta = (patch: Partial<KnowledgeMetadata>) => run(() => onSave({ ...file, knowledgeMetadata: { ...meta, ...patch } }))
  const ready = isDocumentReady(file)
  return <>
    <div className="fsec"><I n="file-info" />&nbsp;{tr("Tài liệu", "Document")}</div>
    <div className="fields" style={{ paddingTop: 0 }}>
      <div className="frow"><div className="flabel"><I n="folder" />Group</div><div className="fval">{canEdit && onGroup && file.category === "rules" ? <select aria-label="Group" value={groupOf(file)} disabled={busy} onChange={e => void run(() => onGroup(e.target.value))}>{DOC_GROUPS.filter(([, c]) => c === "rules").map(([g]) => <option key={g} value={g}>{g}</option>)}</select> : groupOf(file)}{file.category === "rules" && storageGroupInfo(file).guessed && <div className="s" style={{ color: "var(--warn, var(--f2))" }}>{tr("Nhóm đang được đoán theo tên file. Chọn lại nhóm để xác nhận.", "The group is guessed from the file name. Pick a group to confirm it.")}{canEdit && onGroup && <> <button className="btn" style={{ marginLeft: 6 }} disabled={busy} onClick={() => void run(() => onGroup(groupOf(file)))}>{tr("Xác nhận", "Confirm")}</button></>}</div>}</div></div>
      <div className="frow"><div className="flabel"><I n="file" />{tr("Nguồn", "Source")}</div><div className="fval">{(file.sourceType ?? "file").toUpperCase()}{file.size ? ` · ${file.size}` : ""}{file.rowCount ? ` · ${file.rowCount} ${tr("dòng", "rows")}` : ""}</div></div>
      <div className="frow"><div className="flabel"><I n="eye" />AI</div><div className="fval">{ready ? <span className="tag t-green">{tr("Đọc được", "Readable")}</span> : <span className="tag t-red">{tr("Cần tải lại", "Needs re-upload")}</span>}</div></div>
    </div>
    {file.category === "kb" && <>
      <div className="fsec"><I n="shield-lock" />&nbsp;{tr("Quyền sử dụng", "Usage")}</div>
      <div className="fields" style={{ paddingTop: 0 }}>
        <div className="frow"><div className="flabel"><I n="category" />{tr("Loại", "Type")}</div><div className="fval"><select aria-label={tr("Loại kiến thức", "Knowledge type")} disabled={!canEdit || busy} value={meta.type} onChange={e => void setMeta({ type: e.target.value as KnowledgeMetadata["type"] })}>{KNOWLEDGE_TYPES.map(t => <option key={t} value={t}>{t.replace("_", " ")}{BRAND_CONTEXT_TYPES.has(t) ? " · Brand context" : " · Evidence"}</option>)}</select><div className="s">{BRAND_CONTEXT_TYPES.has(meta.type) ? tr("Brand context: luôn gửi nguyên văn cho AI, dùng để thể hiện góc nhìn và giọng thương hiệu.", "Brand context: always sent whole; used for the brand's point of view and voice.") : tr("Evidence: chỉ gửi đoạn liên quan đến bài; là nguồn duy nhất cho số liệu và dẫn chứng.", "Evidence: only the parts relevant to the article are sent; the only source of facts.")}</div></div></div>
        <div className="frow"><div className="flabel"><I n="tags" />Topics</div><div className="fval"><input aria-label="Topics" disabled={!canEdit || busy} value={topics} placeholder="healthcare, animation" onChange={e => setTopics(e.target.value)} onBlur={() => { const next = topics.split(",").map(t => t.trim()).filter(Boolean); if (next.join(",") !== meta.topics.join(",")) void setMeta({ topics: next }) }} /></div></div>
        <div className="frow"><div className="flabel"><I n="world" />{tr("Công khai", "Public")}</div><div className="fval"><button role="switch" aria-checked={meta.approvedForExternalUse} aria-label={tr("Cho phép xuất hiện trong nội dung công khai", "Allow use in public content")} disabled={!canEdit || busy} className={`toggle${meta.approvedForExternalUse ? " on" : ""}`} onClick={() => void setMeta({ approvedForExternalUse: !meta.approvedForExternalUse, visibility: meta.approvedForExternalUse ? "internal" : "public" })} /></div></div>
      </div>
      <div style={{ color: "var(--f3)", fontSize: 12 }}>{meta.approvedForExternalUse ? tr("AI có thể nhắc tên nguồn này trong nội dung xuất bản.", "AI may name this source in published content.") : tr("AI được dùng kiến thức nhưng tên file được ẩn khỏi output.", "AI may use the knowledge; the file name stays hidden from output.")}</div>
    </>}
    <details style={{ marginTop: 12 }}><summary style={{ cursor: "pointer", color: "var(--f2)" }}>{tr("Xem nội dung AI đọc", "View the text AI reads")}</summary>
      <pre style={{ marginTop: 8, maxHeight: 320, overflow: "auto", whiteSpace: "pre-wrap", background: "var(--bg2)", border: "1px solid var(--b2)", borderRadius: 6, padding: 10, fontSize: 12, color: "var(--f2)" }}>{(file.content || file.preview || tr("Không có nội dung.", "No content.")).slice(0, 20000)}</pre>
    </details>
    {error && <div role="alert" style={{ color: "var(--danger)", marginTop: 8 }}>{error}</div>}
    <div style={{ display: "flex", gap: 6, marginTop: 14 }}>
      <button className="btn" disabled={!ready || busy} onClick={() => void run(() => downloadDocumentFromRailway(file.id, file.name, railwayUrl))}><I n="download" />{tr("Tải về", "Download")}</button>
      {canEdit && <button className="btn" style={{ marginLeft: "auto", color: "var(--danger)" }} disabled={busy} onClick={() => { if (window.confirm(tr(`Xoá "${file.name}" khỏi Storage? AI sẽ không dùng tài liệu này nữa.`, `Delete "${file.name}" from Storage? AI will stop using it.`))) void run(onDelete) }}><I n="trash" />{tr("Xoá", "Delete")}</button>}
    </div>
  </>
}

/** Read-only archive of Action Plans from the old workflow (never sent to prompts). */
export function LegacyArchive({ files }: { files: DocumentFile[] }) {
  const { tr } = useI18n()
  const download = (file: DocumentFile) => {
    const href = URL.createObjectURL(new Blob([file.content ?? file.preview ?? ""], { type: "text/plain;charset=utf-8" }))
    const link = document.createElement("a"); link.href = href; link.download = file.name; link.click(); URL.revokeObjectURL(href)
  }
  return <section><h2>Legacy Action Plans</h2><p className="desc">{tr("Chỉ để xem và tải lại. Không được đưa vào prompt của workflow hiện tại.", "View and download only. Never sent to the current workflow's prompts.")}</p>
    {files.length ? <div className="box">{files.map(f => <details key={f.id} className="box-row" style={{ display: "block" }}>
      <summary style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", listStyle: "none" }}><I n="archive" /><div className="grow">{f.name}<div className="s">{f.fileType?.toUpperCase()} · {f.size} · {f.uploadedAt}</div></div><button className="icon-btn" aria-label={`Download ${f.name}`} onClick={e => { e.preventDefault(); download(f) }}><I n="download" /></button></summary>
      <pre style={{ marginTop: 8, maxHeight: 320, overflow: "auto", whiteSpace: "pre-wrap", background: "var(--bg2)", borderRadius: 6, padding: 10, fontSize: 12, color: "var(--f2)" }}>{f.content || f.preview || tr("Không có nội dung preview.", "No preview content.")}</pre>
    </details>)}</div> : <div className="empty-state"><I n="archive" /><h3>{tr("Không có Action Plan legacy", "No legacy Action Plans")}</h3></div>}
  </section>
}
