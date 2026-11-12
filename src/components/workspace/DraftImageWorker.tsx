import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Check, CircleX, LoaderCircle, Sparkles } from "lucide-react";
import type { ImageSuggestion } from "../../types";
import { authenticatedRailwayFetch } from "../../lib/db";
import { imageWorkerRequest, type ImageJob, type ImageWorker, type ImageStyle } from "../../lib/imageWorkers";
import { uiInteractionStart, sendOutlinePerformanceSample } from "../../lib/performanceTelemetry";
import { useI18n } from "../../lib/i18n";

export function useDraftImageJobs(railwayUrl: string, articleId: string, enabled: boolean) {
  const [snapshot, setSnapshot] = useState<{ articleId: string; jobs: ImageJob[] }>({ articleId, jobs: [] });
  const [workers, setWorkers] = useState<ImageWorker[]>([]);
  const [styles, setStyles] = useState<ImageStyle[]>([]);
  const [failure, setFailure] = useState<{ articleId: string; text: string }>();
  const revision = useRef(0);
  const activeArticle = useRef(articleId);
  activeArticle.current = articleId;
  const path = `/articles/${encodeURIComponent(articleId)}/jobs`;
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const version = revision.current;
      try {
        const [jobs, available, approvedStyles] = await Promise.all([
          imageWorkerRequest<ImageJob[]>(railwayUrl, path),
          imageWorkerRequest<ImageWorker[]>(railwayUrl, "/workers"),
          imageWorkerRequest<ImageStyle[]>(railwayUrl, "/styles"),
        ]);
        if (active) {
          if (version === revision.current) setSnapshot({ articleId, jobs });
          setWorkers(available);
          setStyles(approvedStyles);
          setFailure(undefined);
        }
      } catch (error) {
        if (active) setFailure({ articleId, text: (error as Error).message });
      } finally {
        if (active) timer = setTimeout(poll, 5000);
      }
    }
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [articleId, enabled, path, railwayUrl]);

  const jobs = snapshot.articleId === articleId ? snapshot.jobs : [];
  return {
    path, jobs, workers, styles, error: failure?.articleId === articleId ? failure.text : "",
    update(job: ImageJob) {
      if (activeArticle.current !== articleId) return;
      revision.current++;
      setSnapshot(current => ({ articleId, jobs: [
        job, ...(current.articleId === articleId ? current.jobs.filter(item => item.suggestion_id !== job.suggestion_id) : []),
      ] }));
    },
  };
}

export function WorkerImage({ railwayUrl, jobId, alt }: { railwayUrl: string; jobId: string; alt: string }) {
  const { tr } = useI18n();
  const [source, setSource] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let url = "";
    setSource("");
    setFailed(false);
    void authenticatedRailwayFetch(`/api/image-workers/jobs/${jobId}/asset`, { signal: controller.signal }, railwayUrl)
      .then(async response => {
        if (!response.ok) throw new Error("Image unavailable");
        const data = await response.blob();
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(data);
        setSource(url);
      }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [jobId, railwayUrl]);
  if (failed) return <p role="status">{tr("Không tải được ảnh.", "Image unavailable.")}</p>;
  if (!source) return <p role="status">{tr("Đang tải ảnh…", "Loading image…")}</p>;
  return <img src={source} alt={alt} onError={() => setFailed(true)} className="my-3 block h-auto max-w-full rounded-lg" />;
}

function measureImageAction(metric: "clickLatency" | "responseTime", startedAt: number, railwayUrl: string) {
  let sent = false;
  const report = () => {
    if (sent) return;
    sent = true;
    document.removeEventListener("visibilitychange", onVisibility);
    sendOutlinePerformanceSample(metric, Math.round((performance.now() - startedAt) * 10) / 10, true, railwayUrl);
  };
  const onVisibility = () => { if (document.hidden) report(); };
  if (document.hidden) report();
  else {
    document.addEventListener("visibilitychange", onVisibility);
    requestAnimationFrame(() => requestAnimationFrame(report));
  }
}

export default function DraftImageWorker({ railwayUrl, suggestion, disabled, imageJobs }: {
  railwayUrl: string; suggestion: ImageSuggestion; disabled: boolean;
  imageJobs: ReturnType<typeof useDraftImageJobs>;
}) {
  const { tr } = useI18n();
  const [styleSelection, setStyleSelection] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [reviewedJob, setReviewedJob] = useState("");
  const job = imageJobs.jobs.find(item => item.suggestion_id === suggestion.id);
  const defaultWorker = imageJobs.workers.find(worker => worker.preferred);
  const workerState = (worker: typeof defaultWorker) => !worker ? "" : worker.busy ? tr("Bận", "Busy") : worker.online ? tr("Sẵn sàng", "Online") : tr("Ngoại tuyến", "Offline");
  const styles = imageJobs.styles;
  const selectedStyle = styles.find(style => style.id === styleSelection)?.id ??
    styles.find(style => style.id === job?.style_id)?.id ??
    (suggestion.type === "comparison" ? styles.find(style => style.id === "comparison-v1")?.id
      : suggestion.type === "diagram" ? styles.find(style => style.id === "clean-diagram-v1")?.id : undefined) ?? styles[0]?.id ?? "";
  const status = {
    queued: tr("Đang chờ worker", "Waiting for worker"),
    running: tr("Đang tạo ảnh", "Generating image"),
    ready: tr("Sẵn sàng duyệt", "Ready to review"),
    inserted: tr("Đã chèn vào bài", "Inserted into draft"),
    failed: tr("Tạo ảnh không thành công", "Image generation failed"),
  };

  async function act(event: MouseEvent<HTMLButtonElement>, path: string, method: string, body?: unknown) {
    if (pending || disabled) return;
    const startedAt = uiInteractionStart(event.timeStamp);
    setPending(true);
    setError("");
    measureImageAction("clickLatency", startedAt, railwayUrl);
    try {
      imageJobs.update(await imageWorkerRequest<ImageJob>(railwayUrl, path, method, body));
      measureImageAction("responseTime", startedAt, railwayUrl);
    } catch (error) { setError((error as Error).message); }
    finally { setPending(false); }
  }

  const statusTone = pending ? "" : job ? `is-${job.status}` : "";
  return <div className="ips-worker">
    {(job || pending) && <p role="status" className={`ips-worker-status ${statusTone}`}>
      {pending || job?.status === "queued" || job?.status === "running"
        ? <LoaderCircle className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
        : job?.status === "failed" ? <CircleX className="h-3.5 w-3.5" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />}
      {pending ? tr("Đang gửi yêu cầu…", "Submitting…") : job && status[job.status]}
    </p>}
    {(error || imageJobs.error) && <p role="alert" className="ips-worker-error">{error || imageJobs.error}</p>}
    {job?.status === "failed" && job.error_code && <p role="alert" className="ips-worker-error">
      {job.error_code === "STYLE_MODEL_MISSING" ? tr("Mac cần SDXL, IPAdapter và CLIP Vision tương thích với style này.", "This style needs compatible SDXL, IPAdapter and CLIP Vision on the Mac.")
        : job.error_code === "STYLE_SYNC_FAILED" ? tr("Mac không tải hoặc xác minh được style đã duyệt.", "The Mac could not download or verify the approved style.")
        : job.error_code === "STYLE_VERSION_MISMATCH" ? tr("Phiên bản style đã lưu không khớp. Hãy tạo lại job.", "The saved style version does not match. Create a new job.")
        : `${tr("Mã lỗi tạo ảnh", "Image error code")}: ${job.error_code}`}
    </p>}
    {job?.status === "ready" && <WorkerImage railwayUrl={railwayUrl} jobId={job.id} alt={suggestion.altText} />}
    {!disabled && <>
      {(!job || job.status === "failed") && <div className="space-y-2">
        <label className="grid gap-1 text-xs text-[var(--ui-secondary)]">{tr("Phong cách ảnh", "Image style")}
          <select className="min-h-11 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-control)] px-2.5 text-[var(--ui-text)]"
            value={selectedStyle} disabled={pending || !styles.length} onChange={event => setStyleSelection(event.target.value)}>
            {!styles.length && <option value="">{tr("Chưa có phong cách đã duyệt", "No approved styles")}</option>}
            {styles.map(style => <option key={style.id} value={style.id}>{style.name}</option>)}
          </select>
          <span>{styles.find(style => style.id === selectedStyle)?.description}</span>
        </label>
        <div className="ips-worker-row">
          <p className="ips-worker-default">{defaultWorker
            ? <>{tr("Worker mặc định", "Default worker")}: <span className="ips-worker-name">{defaultWorker.name}</span> · {workerState(defaultWorker)}</>
            : tr("Chưa có worker mặc định. Chọn trong Settings › Image Workers.", "No default worker. Choose one in Settings › Image Workers.")}</p>
          <button type="button" className="ips-btn ips-btn-primary" disabled={pending || !defaultWorker || !selectedStyle}
            onClick={event => defaultWorker && void act(event, imageJobs.path, "POST", {workerId:defaultWorker.id, suggestionId:suggestion.id,
              styleId:selectedStyle, styleVersion:styles.find(style => style.id === selectedStyle)?.version})}>
            <Sparkles className="h-3.5 w-3.5" aria-hidden />{job?.status === "failed" ? tr("Tạo lại ảnh", "Retry image") : tr("Tạo ảnh", "Generate image")}
          </button>
        </div>
      </div>}
      {job?.status === "ready" && <div className="space-y-2">
        <label className="flex items-start gap-2 text-xs text-[var(--ui-secondary)]">
          <input type="checkbox" className="mt-0.5" checked={reviewedJob === job.id}
            onChange={event => setReviewedJob(event.target.checked ? job.id : "")} />
          {tr("Tôi đã kiểm tra ảnh bám sát brief, không thêm chi tiết hoặc chữ không được duyệt, và đúng phong cách.",
            "I checked that the image follows the brief, adds no unapproved details or text, and matches the style.")}
        </label>
        <div className="ips-worker-actions">
          <button type="button" className="ips-btn ips-btn-primary" disabled={pending || reviewedJob !== job.id}
            onClick={event => void act(event, `/jobs/${job.id}/insert`, "POST", { reviewed: true })}>
            {tr("Chèn vào bài", "Insert into draft")}
          </button>
          <button type="button" className="ips-btn ips-btn-ghost" disabled={pending}
            onClick={event => void act(event, `/jobs/${job.id}`, "DELETE")}>
            {tr("Bỏ ảnh này", "Discard image")}
          </button>
        </div>
      </div>}
    </>}
  </div>;
}
