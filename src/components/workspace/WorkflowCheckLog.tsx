import { useEffect, useState } from 'react';
import { Check, ChevronDown, CircleAlert, Loader2, X } from 'lucide-react';
import { useI18n } from '../../lib/i18n';

type Outcome = 'running' | 'completed' | 'warning' | 'failed';

type Entry = { at: number; text: string };
type Checkpoint = { startedAt: number; finishedAt?: number; entries: Entry[] };

type Run = {
  articleId: string;
  startedAt: number;
  finishedAt?: number;
  index: number;
  outcome: Outcome;
  checkpoints: Checkpoint[];
};

export function useWorkflowCheckLog(articleId: string) {
  const [run, setRun] = useState<Run | null>(null);
  function start(text?: string) {
    const startedAt = Date.now();
    setRun({ articleId, startedAt, index: 0, outcome: 'running', checkpoints: [
      { startedAt, entries: text ? [{ at: startedAt, text }] : [] },
    ] });
    function update(outcome: Outcome, text?: string, advance = false) {
      const at = Date.now();
      setRun(current => {
        if (current?.articleId !== articleId || current.startedAt !== startedAt || current.outcome !== 'running') return current;
        const finishedAt = outcome !== 'running' ? at : undefined;
        const index = current.index + (advance ? 1 : 0);
        const checkpoints = [...current.checkpoints];
        const checkpoint = checkpoints[current.index];
        if (advance) {
          checkpoints[current.index] = { ...checkpoint, finishedAt: at };
          checkpoints[index] = { startedAt: at, entries: text ? [{ at, text }] : [] };
        } else {
          checkpoints[index] = { ...checkpoint, finishedAt, entries: text ? [...checkpoint.entries, { at, text }] : checkpoint.entries };
        }
        return { ...current, index, outcome, finishedAt, checkpoints };
      });
    }
    return {
      advance: (text?: string) => update('running', text, true),
      note: (text: string) => update('running', text),
      finish: (warning = false, text?: string) => update(warning ? 'warning' : 'completed', text),
      fail: (text: string) => update('failed', text),
    };
  }
  return { start, run: run?.articleId === articleId ? run : null };
}

function formatDuration(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export default function WorkflowCheckLog({ run, steps }: { run: Run | null; steps: string[] }) {
  const { tr } = useI18n();
  const [now, setNow] = useState(0);
  const startedAt = run?.startedAt;
  const running = run?.outcome === 'running';

  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running, startedAt]);

  if (!run) return null;
  const elapsed = formatDuration((run.finishedAt ?? now) - run.startedAt);
  const currentAction = run.checkpoints[run.index].entries.at(-1)?.text ?? steps[run.index];
  const status = {
    running: tr('Đang thực hiện', 'In progress'),
    completed: tr('Hoàn thành', 'Completed'),
    warning: tr('Đã lưu · cần xem lại', 'Saved · needs review'),
    failed: tr('Không hoàn tất', 'Could not finish'),
    pending: tr('Chờ thực hiện', 'Pending'),
  };
  const icons = {
    running: <Loader2 className="h-4 w-4 motion-safe:animate-spin" />,
    completed: <Check className="h-3.5 w-3.5 rounded-full bg-[var(--ui-secondary)] p-0.5 text-[var(--ui-surface)]" />,
    warning: <CircleAlert className="h-4 w-4 text-amber-600" />,
    failed: <X className="h-4 w-4 text-rose-600" />,
    pending: <span className="block h-3.5 w-3.5 rounded-full border border-dashed border-current" />,
  };

  return (
    <section aria-label={tr('Nhật ký xử lý AI', 'AI progress log')} className="text-sm text-[var(--ui-text)]">
      <div key={run.startedAt} className="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="font-medium">{tr('Nhật ký xử lý AI', 'AI progress log')}</h3>
          <div className="flex gap-2 text-xs text-[var(--ui-secondary)]">
            <span>{status[run.outcome]}</span>
          </div>
        </div>
        <ol>
          {steps.map((step, index) => {
            const state = index < run.index ? 'completed' : index === run.index ? run.outcome : 'pending';
            const checkpoint = run.checkpoints[index];
            return (
              <li key={step} aria-current={state === 'running' ? 'step' : undefined}>
                <details className="group">
                  <summary className={`flex min-h-11 cursor-pointer list-none items-center gap-2.5 rounded-md px-1 hover:bg-[var(--ui-control)] [&::-webkit-details-marker]:hidden ${state === 'completed' || state === 'pending' ? 'text-[var(--ui-secondary)]' : ''}`}>
                    <span aria-hidden="true" className="grid h-4 w-4 shrink-0 place-items-center">{icons[state]}</span>
                    <span className="min-w-0 flex-1">{step}<span className="sr-only"> · {status[state]}</span></span>
                    <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 group-open:rotate-180" />
                  </summary>
                  <div className="mb-2 ml-6 border-l border-[var(--ui-border)] px-3 py-2 text-xs text-[var(--ui-secondary)]">
                    <p className="flex flex-wrap gap-x-3 gap-y-1 font-medium">
                      <span>{status[state]}</span>
                      {checkpoint && <span className="tabular-nums">{formatDuration((checkpoint.finishedAt ?? now) - checkpoint.startedAt)}</span>}
                    </p>
                    {checkpoint?.entries.length ? (
                      <ul className="mt-2 space-y-1.5">
                        {checkpoint.entries.map((entry, entryIndex) => (
                          <li key={entryIndex} className="flex items-baseline gap-2">
                            <span className="shrink-0 tabular-nums">+{formatDuration(entry.at - run.startedAt)}</span>
                            <span className="min-w-0 break-words">{entry.text}</span>
                          </li>
                        ))}
                      </ul>
                    ) : !checkpoint && <p className="mt-1">{tr('Chưa có hoạt động nào ở mốc này.', 'No activity yet for this checkpoint.')}</p>}
                  </div>
                </details>
              </li>
            );
          })}
        </ol>
      </div>
      <div className="flex items-start gap-2.5 px-2 pt-3 text-[var(--ui-secondary)]">
        <span aria-hidden="true" className="mt-0.5 shrink-0">{icons[run.outcome]}</span>
        <span role="status" className="min-w-0 flex-1 break-words">{running ? currentAction : status[run.outcome]}</span>
        <span className="shrink-0 tabular-nums" aria-label={tr(`Thời gian đã chạy ${elapsed}`, `Elapsed time ${elapsed}`)}>{elapsed}</span>
      </div>
    </section>
  );
}
