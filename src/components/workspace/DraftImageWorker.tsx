import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Check, CircleX, LoaderCircle } from "lucide-react";
import type { ImageSuggestion } from "../../types";
import { authenticatedRailwayFetch } from "../../lib/db";
import { imageWorkerRequest, type ImageJob, type ImageWorker } from "../../lib/imageWorkers";
import { uiInteractionStart, sendOutlinePerformanceSample } from "../../lib/performanceTelemetry";
import { useI18n } from "../../lib/i18n";

export function useDraftImageJobs(railwayUrl: string, articleId: string, enabled: boolean) {
  const [snapshot, setSnapshot] = useState<{ articleId: string; jobs: ImageJob[] }>({ articleId, jobs: [] });
  const [workers, setWorkers] = useState<ImageWorker[]>([]);
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
        const [jobs, available] = await Promise.all([
          imageWorkerRequest<ImageJob[]>(railwayUrl, path),
          imageWorkerRequest<ImageWorker[]>(railwayUrl, "/workers"),
        ]);
        if (active) {
          if (version === revision.current) setSnapshot({ articleId, jobs });
          setWorkers(available);
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
    path, jobs, workers, error: failure?.articleId === articleId ? failure.text : "",
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
  const [selection, setSelection] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const job = imageJobs.jobs.find(item => item.suggestion_id === suggestion.id);
  const workers = imageJobs.workers;
  const selected = workers.find(worker => worker.id === selection)?.id ??
    workers.find(worker => worker.id === job?.worker_id)?.id ??
    workers.find(worker => worker.preferred)?.id ?? workers[0]?.id ?? "";
  const status = {
    queued: tr("Đang chờ worker", "Waiting for worker"),
    running: tr("Đang tạo ảnh", "Generating image"),
    ready: tr("Sẵn sàng duyệt", "Ready to review"),
    inserted: tr("Đã chèn vào bài", "Inserted into draft"),
    failed: tr("Tạo ảnh không thành công", "Image generation failed"),
  };
  const control = "ips-btn ips-btn-secondary";

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
    {job?.status === "ready" && <WorkerImage railwayUrl={railwayUrl} jobId={job.id} alt={suggestion.altText} />}
    {!disabled && <>
      {(!job || job.status === "queued" || job.status === "failed") && <>
        <label>{tr("Worker tạo ảnh", "Image worker")}
          <select value={selected} disabled={pending || !workers.length} onChange={event => setSelection(event.target.value)}>
            {!workers.length && <option value="">{tr("Đăng ký worker trong Settings", "Register a worker in Settings")}</option>}
            {workers.map(worker => <option key={worker.id} value={worker.id}>
              {worker.name} · {worker.busy ? tr("Bận", "Busy") : worker.online ? tr("Sẵn sàng", "Online") : tr("Ngoại tuyến", "Offline")}
            </option>)}
          </select>
        </label>
        <div className="ips-worker-actions">
          {job?.status === "queued" ? <button type="button" className={control} disabled={pending || !selected || selected === job.worker_id}
            onClick={event => void act(event, `/jobs/${job.id}/worker`, "PATCH", {workerId:selected})}>
            {tr("Đổi worker", "Switch worker")}
          </button> : <button type="button" className="ips-btn ips-btn-primary" disabled={pending || !selected}
            onClick={event => void act(event, imageJobs.path, "POST", {workerId:selected, suggestionId:suggestion.id})}>
            {job?.status === "failed" ? tr("Tạo lại ảnh", "Retry image") : tr("Tạo ảnh", "Generate image")}
          </button>}
        </div>
      </>}
      {job?.status === "ready" && <div className="ips-worker-actions">
        <button type="button" className="ips-btn ips-btn-primary" disabled={pending} onClick={event => void act(event, `/jobs/${job.id}/insert`, "POST")}>
          {tr("Chèn vào bài", "Insert into draft")}
        </button>
        <button type="button" className="ips-btn ips-btn-ghost" disabled={pending} onClick={event => void act(event, `/jobs/${job.id}`, "DELETE")}>
          {tr("Bỏ ảnh này", "Discard image")}
        </button>
      </div>}
    </>}
  </div>;
}
