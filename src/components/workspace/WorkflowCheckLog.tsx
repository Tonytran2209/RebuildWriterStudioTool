import { useEffect, useState } from 'react';
import { Check, CircleAlert, Loader2, X } from 'lucide-react';
import { useI18n } from '../../lib/i18n';

type Outcome = 'running' | 'completed' | 'warning' | 'failed';

type Run = {
  articleId: string;
  startedAt: number;
  finishedAt?: number;
  index: number;
  outcome: Outcome;
};

export function useWorkflowCheckLog(articleId: string) {
  const [run, setRun] = useState<Run | null>(null);
  function start() {
    const startedAt = Date.now();
    setRun({ articleId, startedAt, index: 0, outcome: 'running' });
    function update(outcome: Outcome, index?: number) {
      const finishedAt = outcome === 'running' ? undefined : Date.now();
      setRun(current => current?.articleId === articleId && current.startedAt === startedAt
        ? { ...current, index: index ?? current.index, outcome, finishedAt }
        : current);
    }
    return {
      advance: (index: number) => update('running', index),
      finish: (warning = false) => update(warning ? 'warning' : 'completed'),
      fail: () => update('failed'),
    };
  }
  return { start, run: run?.articleId === articleId ? run : null };
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
  const seconds = Math.max(0, Math.floor(((run.finishedAt ?? now) - run.startedAt) / 1000));
  const elapsed = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
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
    <section aria-label={tr('Nhật ký xử lý AI', 'AI progress log')} className="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-surface)] p-4 text-sm text-[var(--ui-text)]">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="font-medium">{tr('Nhật ký xử lý AI', 'AI progress log')}</h3>
        <div className="flex gap-2 text-xs text-[var(--ui-secondary)]">
          <span role="status">{status[run.outcome]}{running && <span className="sr-only"> · {steps[run.index]}</span>}</span>
          <span className="tabular-nums">{elapsed}</span>
        </div>
      </div>
      <ol className="space-y-2">
        {steps.map((step, index) => {
          const state = index < run.index ? 'completed' : index === run.index ? run.outcome : 'pending';
          return (
            <li key={step} aria-current={state === 'running' ? 'step' : undefined} className={`flex items-start gap-2.5 ${state === 'completed' || state === 'pending' ? 'text-[var(--ui-secondary)]' : ''}`}>
              <span aria-hidden="true" className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center">{icons[state]}</span>
              <span>{step}<span className="sr-only"> · {status[state]}</span></span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
