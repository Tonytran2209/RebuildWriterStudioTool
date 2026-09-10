import type { Article } from '../types';
import { useI18n } from '../lib/i18n';

interface Props {
  article: Article;
  activeStep: 2 | 3 | 4;
  onNavigate: (step: 2 | 3 | 4) => void;
}

export default function VerticalWorkflowRail({ article, activeStep, onNavigate }: Props) {
  const { tr } = useI18n();
  const workflowComplete = article.status === 'done' || Boolean(article.completedAt);
  const steps = [
    { step: 2 as const, number: 1, label: tr('Article Spec', 'Article Spec'), available: true, complete: workflowComplete || Boolean(article.selectedCoreIdeaId) },
    { step: 3 as const, number: 2, label: tr('Dàn bài', 'Outline'), available: workflowComplete || Boolean(article.selectedCoreIdeaId), complete: workflowComplete || Boolean(article.outline?.length) },
    { step: 4 as const, number: 3, label: tr('Bản nháp', 'Draft'), available: workflowComplete || Boolean(article.outline?.length), complete: workflowComplete, warning: !workflowComplete && Boolean(article.draft && article.qualityReport?.status !== 'pass') },
  ];

  return (
    <nav className="workflow-rail sticky top-4 self-start" aria-label={tr('Tiến trình bài viết', 'Article progress')}>
      <ol>
        {steps.map((item, index) => (
          <li key={item.step} className="workflow-rail-item relative">
            <button
              type="button"
              disabled={!item.available}
              onClick={() => onNavigate(item.step)}
              className={`workflow-rail-button ${activeStep === item.step ? 'is-active' : ''} ${item.complete ? 'is-complete' : ''} ${item.warning ? 'has-warning' : ''}`}
              title={item.label}
              aria-label={`${item.step - 1}. ${item.label}`}
            >
              <span className="workflow-rail-marker" aria-hidden="true" />
              <span className="workflow-rail-label">{item.label}</span>
              <span className="workflow-rail-number" aria-hidden="true">{item.number}</span>
            </button>
            {index < steps.length - 1 && (
              <span className="workflow-rail-ticks" aria-hidden="true">
                {[0, 1, 2, 3, 4].map(tick => <i key={tick} />)}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
