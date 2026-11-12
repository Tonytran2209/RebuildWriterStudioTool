import { useEffect, useState, type FormEvent, type MouseEvent } from "react";
import { imageWorkerRequest, type ImageStyle } from "../../lib/imageWorkers";
import { useI18n } from "../../lib/i18n";
import { uiInteractionStart, sendOutlinePerformanceSample } from "../../lib/performanceTelemetry";

type ManagedStyle = ImageStyle & { visualRules: string; modelFamily: "sdxl" | "text-only";
  status: "draft" | "approved"; referenceName: string | null; hasGuide: boolean };
type Preview = { guide: string | null; referenceBase64: string | null; referenceMime: string | null };
const control = "min-h-11 w-full rounded border border-[var(--ui-border)] bg-[var(--ui-control)] px-3 py-2 text-sm text-[var(--ui-text)]";
function reportMetric(metric: "clickLatency" | "responseTime", start: number, railwayUrl: string) {
  let sent = false;
  const finish = () => {
    if (sent) return;
    sent = true;
    document.removeEventListener("visibilitychange", onVisibility);
    sendOutlinePerformanceSample(metric, Math.max(0, performance.now() - start), true, railwayUrl);
  };
  const onVisibility = () => { if (document.hidden) finish(); };
  if (document.hidden) finish();
  else { document.addEventListener("visibilitychange", onVisibility); requestAnimationFrame(() => requestAnimationFrame(finish)); }
}

export default function ImageStylesSettings({ railwayUrl }: { railwayUrl: string }) {
  const { tr } = useI18n();
  const [styles, setStyles] = useState<ManagedStyle[]>([]);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visualRules, setVisualRules] = useState("");
  const [modelFamily, setModelFamily] = useState<"sdxl" | "text-only">("text-only");
  const [guide, setGuide] = useState("");
  const [guideName, setGuideName] = useState("");
  const [reference, setReference] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<{ key:string; data:Preview } | null>(null);

  async function refresh() { setStyles(await imageWorkerRequest<ManagedStyle[]>(railwayUrl, "/styles/manage")); }
  useEffect(() => { void refresh().catch(error => setError((error as Error).message)); }, [railwayUrl]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const startedAt = uiInteractionStart(event.timeStamp);
    setBusy(true); setError(""); setNotice("");
    reportMetric("clickLatency", startedAt, railwayUrl);
    try {
      if (reference && (reference.size > 4_000_000 || modelFamily !== "sdxl"))
        throw new Error(tr("Ảnh tham chiếu dưới 4 MB cần style SDXL.", "A reference under 4 MB requires an SDXL style."));
      const referenceBase64 = reference ? await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(reference);
      }) : null;
      const result = await imageWorkerRequest<{id:string;version:number}>(railwayUrl, "/styles", "POST", {
        id, name, description, visualRules, modelFamily, guide: guide || null,
        referenceBase64, referenceName: reference?.name || null,
      });
      reportMetric("responseTime", startedAt, railwayUrl);
      await refresh();
      setNotice(tr(`Đã lưu bản nháp ${result.id} v${result.version}. Hãy kiểm tra và duyệt bên dưới.`,
        `Saved draft ${result.id} v${result.version}. Review and approve it below.`));
      setGuide(""); setGuideName(""); setReference(null);
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }

  async function approve(style: ManagedStyle, event: MouseEvent<HTMLButtonElement>) {
    if (busy) return;
    const startedAt = uiInteractionStart(event.timeStamp);
    setBusy(true); setError(""); setNotice("");
    reportMetric("clickLatency", startedAt, railwayUrl);
    try {
      if (preview?.key !== `${style.id}:${style.version}`) throw new Error(tr("Xem trước phiên bản trước khi duyệt.", "Preview the version before approving."));
      await imageWorkerRequest(railwayUrl, `/styles/${style.id}/${style.version}/approve`, "POST", { reviewed:true });
      reportMetric("responseTime", startedAt, railwayUrl);
      await refresh();
      setNotice(tr(`Đã duyệt ${style.name} v${style.version}. Worker sẽ tự đồng bộ.`,
        `Approved ${style.name} v${style.version}. The worker will sync it automatically.`));
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }

  async function inspect(style: ManagedStyle) {
    setError("");
    try {
      const data = await imageWorkerRequest<Preview>(railwayUrl, `/styles/${style.id}/${style.version}/preview`);
      setPreview({ key:`${style.id}:${style.version}`, data });
    } catch (error) { setError((error as Error).message); }
  }

  return <div className="space-y-5 text-[var(--ui-text)]">
    <p className="text-sm text-[var(--ui-secondary)]">{tr("Tạo bản nháp, tải style-guide.md và ảnh tham chiếu lên Railway, sau đó duyệt phiên bản. Worker trên Mac tự tải bản đã duyệt.",
      "Create a draft, upload a style guide and reference image to Railway, then approve the version. The Mac worker syncs approved versions.")}</p>
    <form onSubmit={event => void save(event)} className="grid gap-3 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface)] p-4">
      <label className="grid gap-1 text-xs">Style ID <input className={control} value={id} onChange={event => setId(event.target.value)} pattern="[a-z][a-z0-9-]{2,49}" placeholder="editorial-brand" required /></label>
      <label className="grid gap-1 text-xs">{tr("Tên style", "Style name")} <input className={control} value={name} onChange={event => setName(event.target.value)} maxLength={80} required /></label>
      <label className="grid gap-1 text-xs">{tr("Mô tả", "Description")} <input className={control} value={description} onChange={event => setDescription(event.target.value)} maxLength={240} /></label>
      <label className="grid gap-1 text-xs">{tr("Quy tắc hình ảnh", "Visual rules")} <textarea className={control} value={visualRules} onChange={event => setVisualRules(event.target.value)} maxLength={2000} rows={3} required /></label>
      <label className="grid gap-1 text-xs">{tr("Khả năng tương thích", "Compatibility")}
        <select className={control} value={modelFamily} onChange={event => setModelFamily(event.target.value as "sdxl" | "text-only")}>
          <option value="text-only">{tr("Chỉ mô tả chữ", "Text rules only")}</option><option value="sdxl">SDXL + IPAdapter</option>
        </select>
      </label>
      <label className="grid gap-1 text-xs">style-guide.md · {guideName || tr("Chưa chọn", "None")}
        <input className={control} type="file" accept=".md,text/markdown,text/plain" onChange={event => {
          const file = event.target.files?.[0];
          if (!file) return;
          void file.text().then(text => { setGuide(text); setGuideName(file.name); });
        }} />
      </label>
      <label className="grid gap-1 text-xs">{tr("Ảnh tham chiếu (SDXL, tối đa 4 MB)", "Reference image (SDXL, max 4 MB)")}
        <input className={control} type="file" accept="image/png,image/jpeg,image/webp" disabled={modelFamily !== "sdxl"}
          onChange={event => setReference(event.target.files?.[0] || null)} />
      </label>
      <button className="min-h-11 rounded bg-[var(--ui-primary-bg)] px-3 text-sm text-[var(--ui-primary-text)] disabled:opacity-50" disabled={busy || !railwayUrl}>
        {busy ? tr("Đang lưu…", "Saving…") : tr("Lưu bản nháp style", "Save style draft")}
      </button>
    </form>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {notice && <p role="status" className="text-sm text-green-700">{notice}</p>}
    <section className="space-y-2"><h2 className="text-base font-semibold">{tr("Phiên bản đã lưu", "Saved versions")}</h2>
      {!styles.length && <p className="text-sm text-[var(--ui-secondary)]">{tr("Chưa có style tạo trong app.", "No app-managed styles yet.")}</p>}
      {styles.map(style => <article key={`${style.id}-${style.version}`} className="rounded-lg border border-[var(--ui-border)] p-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2"><strong>{style.name} · v{style.version}</strong><span>{style.status}</span></div>
        <p className="mt-1 text-[var(--ui-secondary)]">{style.id} · {style.modelFamily} · {style.hasGuide ? "MD" : tr("Không có MD", "No MD")} · {style.referenceName || tr("Không có ảnh mẫu", "No reference")}</p>
        <p className="mt-2 whitespace-pre-wrap">{style.visualRules}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="min-h-11 rounded border border-[var(--ui-border)] px-3" onClick={() => void inspect(style)}>
            {tr("Xem trước file", "Preview files")}
          </button>
          {style.status === "draft" && <button type="button" className="min-h-11 rounded border border-[var(--ui-border)] px-3 disabled:opacity-50"
            disabled={busy || preview?.key !== `${style.id}:${style.version}`} onClick={event => void approve(style, event)}>{tr("Duyệt phiên bản", "Approve version")}</button>}
        </div>
        {preview?.key === `${style.id}:${style.version}` && <div className="mt-3 space-y-2 border-t border-[var(--ui-border)] pt-3">
          {preview.data.guide && <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--ui-control)] p-3 text-xs">{preview.data.guide}</pre>}
          {preview.data.referenceBase64 && preview.data.referenceMime && <img alt={tr("Ảnh tham chiếu của style", "Style reference")}
            className="max-h-64 max-w-full rounded object-contain" src={`data:${preview.data.referenceMime};base64,${preview.data.referenceBase64}`} />}
          {!preview.data.guide && !preview.data.referenceBase64 && <p>{tr("Phiên bản chỉ có quy tắc chữ.", "This version has text rules only.")}</p>}
        </div>}
      </article>)}
    </section>
  </div>;
}
