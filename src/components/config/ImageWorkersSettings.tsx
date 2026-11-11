import { useEffect, useState } from "react";
import { imageWorkerRequest, type ImageWorker } from "../../lib/imageWorkers";
import { useI18n } from "../../lib/i18n";

export default function ImageWorkersSettings({ railwayUrl }: { railwayUrl: string }) {
  const { tr } = useI18n();
  const [workers, setWorkers] = useState<ImageWorker[]>([]);
  const [name, setName] = useState("");
  const [agent, setAgent] = useState("claude");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setWorkers(await imageWorkerRequest<ImageWorker[]>(railwayUrl, "/workers"));
  }

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const result = await imageWorkerRequest<ImageWorker[]>(railwayUrl, "/workers");
        if (active) setWorkers(result);
      } catch (error) { if (active) setError((error as Error).message); }
    };
    void poll();
    const timer = setInterval(poll, 10000);
    return () => { active = false; clearInterval(timer); };
  }, [railwayUrl]);

  async function update(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try { await action(); await refresh(); }
    catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }

  const control = "min-h-11 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-control)] px-3 py-2 text-sm disabled:opacity-50";
  return <div className="space-y-4 text-[var(--ui-text)]">
    <form className="flex flex-wrap items-end gap-2" onSubmit={event => {
      event.preventDefault();
      void update(async () => {
        const result = await imageWorkerRequest<{token: string}>(railwayUrl, "/workers", "POST", { name, agent });
        setToken(result.token);
        setName("");
      });
    }}>
      <label className="grid flex-1 gap-1 text-xs">{tr("Tên worker hoặc máy Mac", "Worker or Mac name")}
        <input className={control} value={name} onChange={event => setName(event.target.value)} maxLength={80} required />
      </label>
      <label className="grid gap-1 text-xs">Agent
        <select className={control} value={agent} onChange={event => setAgent(event.target.value)}>
          <option value="claude">Claude Code</option><option value="codex">Codex</option>
        </select>
      </label>
      <button className={control} disabled={busy || !name.trim()}>{tr("Đăng ký worker", "Register worker")}</button>
    </form>
    {token && <label className="grid gap-2 text-sm">
      {tr("Token ghép nối hiện một lần. Đặt giá trị này vào WRITER_IMAGE_WORKER_TOKEN trên máy Mac.", "This pairing token is shown once. Set it as WRITER_IMAGE_WORKER_TOKEN on the Mac.")}
      <input className={control} value={token} readOnly onFocus={event => event.target.select()} />
    </label>}
    {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
    <ul className="divide-y divide-[var(--ui-border)]">
      {workers.map(worker => <li key={worker.id} className="flex flex-wrap items-center gap-2 py-3">
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-medium">{worker.name}</p>
          <p className="text-xs text-[var(--ui-secondary)]">{worker.agent} · {worker.busy ? tr("Đang bận", "Busy") : worker.online ? tr("Sẵn sàng", "Online") : tr("Ngoại tuyến", "Offline")}</p>
        </div>
        <button className={control} disabled={busy || worker.preferred}
          onClick={() => void update(async () => { await imageWorkerRequest(railwayUrl, `/workers/${worker.id}`, "PATCH", {action:"default"}); })}>
          {worker.preferred ? tr("Mặc định", "Default") : tr("Đặt mặc định", "Set default")}
        </button>
        <button className={control} disabled={busy} onClick={() => {
          if (!window.confirm(tr(`Ngắt kết nối “${worker.name}”?`, `Disconnect “${worker.name}”?`))) return;
          void update(async () => { await imageWorkerRequest(railwayUrl, `/workers/${worker.id}`, "PATCH", {action:"revoke"}); });
        }}>{tr("Ngắt kết nối", "Disconnect")}</button>
      </li>)}
    </ul>
  </div>;
}
