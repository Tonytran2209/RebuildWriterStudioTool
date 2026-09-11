import { useEffect, useState } from 'react';
import { Check, Info, X } from 'lucide-react';

export type WorkspaceNoticeKind = 'success' | 'error' | 'warning';

type WorkspaceNotice = { id: number; message: string; kind: WorkspaceNoticeKind };
const EVENT_NAME = 'writer:workspace-notice';

export function notifyWorkspace(message: string, kind: WorkspaceNoticeKind = 'warning') {
  if (!message.trim()) return;
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { id: Date.now(), message, kind } }));
}

export default function WorkspaceNotificationHost() {
  const [notice, setNotice] = useState<WorkspaceNotice | null>(null);

  useEffect(() => {
    const receive = (event: Event) => setNotice((event as CustomEvent<WorkspaceNotice>).detail);
    window.addEventListener(EVENT_NAME, receive);
    return () => window.removeEventListener(EVENT_NAME, receive);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(current => current?.id === notice.id ? null : current), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  if (!notice) return null;
  const StatusIcon = notice.kind === 'success' ? Check : notice.kind === 'error' ? X : Info;
  return (
    <div className="workspace-notification" role={notice.kind === 'error' ? 'alert' : 'status'} aria-live="polite">
      <span className={`workspace-notification-status is-${notice.kind}`} aria-hidden="true"><StatusIcon className="app-icon" /></span>
      <p>{notice.message}</p>
      <button type="button" onClick={() => setNotice(null)} aria-label="Close notification" title="Close">
        <X className="app-icon" aria-hidden="true" />
      </button>
    </div>
  );
}
