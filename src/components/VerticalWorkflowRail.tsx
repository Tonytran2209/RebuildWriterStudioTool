import { Check } from 'lucide-react';
import type { Article } from '../types';
import { useI18n } from '../lib/i18n';

interface Props {
  article: Article;
  activeStep: 2 | 3 | 4;
  onNavigate: (step: 2 | 3 | 4) => void;
}

export default function VerticalWorkflowRail({ article, activeStep, onNavigate }: Props) {
  const { tr } = useI18n();
  const steps = [
    { step: 2 as const, label: tr('Article Spec', 'Article Spec'), available: true, complete: Boolean(article.selectedCoreIdeaId) },
    { step: 3 as const, label: tr('Dàn bài', 'Outline'), available: Boolean(article.selectedCoreIdeaId), complete: Boolean(article.outline?.length) },
    { step: 4 as const, label: tr('Bản nháp', 'Draft'), available: Boolean(article.outline?.length), complete: article.status === 'done', warning: Boolean(article.draft && article.qualityReport?.status !== 'pass') },
  ];

  return (
    <nav className="workflow-rail sticky top-4 self-start" aria-label={tr('Tiến trình bài viết', 'Article progress')}>
      <ol>
        {steps.map((item, index) => (
          <li key={item.step} className="workflow-rail-item relative">
            {index < steps.length - 1 && <span className={`workflow-rail-line ${item.complete ? 'is-complete' : ''}`} aria-hidden="true" />}
            <button
              type="button"
              disabled={!item.available}
              onClick={() => onNavigate(item.step)}
              className={`workflow-rail-button ${activeStep === item.step ? 'is-active' : ''} ${item.complete ? 'is-complete' : ''} ${item.warning ? 'has-warning' : ''}`}
              title={item.label}
              aria-label={`${item.step - 1}. ${item.label}`}
            >
              <span className="workflow-rail-dot">{item.complete ? <Check aria-hidden="true" /> : item.step - 1}</span>
              <span className="workflow-rail-label">{item.label}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
