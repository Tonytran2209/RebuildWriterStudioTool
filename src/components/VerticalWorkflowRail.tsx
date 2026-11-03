import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { Article } from '../types';
import { Check } from 'lucide-react';
import { useI18n } from '../lib/i18n';

interface Props {
  article: Article;
  activeStep: 2 | 3 | 4;
  onNavigate: (step: 2 | 3 | 4) => void;
}

export default function VerticalWorkflowRail({ article, activeStep, onNavigate }: Props) {
  const { tr } = useI18n();
  const [hoveredTick, setHoveredTick] = useState<number | null>(null);
  const workflowComplete = article.status === 'done' || Boolean(article.completedAt);
  const steps = [
    { step: 2 as const, label: 'Article Spec', available: true, complete: workflowComplete || Boolean(article.selectedCoreIdeaId) },
    { step: 3 as const, label: tr('Dàn bài', 'Outline'), available: Boolean(article.selectedCoreIdeaId) && article.currentStep >= 3, complete: workflowComplete || Boolean(article.outline?.length) },
    { step: 4 as const, label: tr('Bản nháp', 'Draft'), available: Boolean(article.outline?.length) && article.currentStep >= 4, complete: workflowComplete, warning: !workflowComplete && Boolean(article.draft && article.qualityReport?.status !== 'pass') },
  ];

  return (
    <nav className="workflow-ruler" aria-label={tr('Tiến trình bài viết', 'Article progress')} onPointerLeave={() => setHoveredTick(null)}>
      <ol>
        {steps.map((item, index) => {
          const tickIndex = index * 12;
          const state = item.complete ? tr('Hoàn tất', 'Complete') : item.warning ? tr('Cần kiểm tra', 'Needs review') : item.available ? tr('Sẵn sàng', 'Ready') : tr('Chưa mở', 'Locked');
          return (
            <li key={item.step} className="workflow-ruler-group">
              <button
                type="button"
                aria-disabled={!item.available}
                aria-current={activeStep === item.step ? 'step' : undefined}
                aria-label={`${index + 1}. ${item.label} — ${state}`}
                onClick={() => { if (item.available) onNavigate(item.step); }}
                onPointerEnter={() => setHoveredTick(tickIndex)}
                onFocus={() => setHoveredTick(tickIndex)}
                onBlur={() => setHoveredTick(null)}
                className={`workflow-ruler-stop ${activeStep === item.step ? 'is-active' : ''} ${item.complete ? 'is-complete' : ''}`}
                style={{ '--ruler-scale': hoveredTick === null ? 1 : 1 + Math.max(0, 1 - Math.abs(hoveredTick - tickIndex) / 5) } as CSSProperties}
              >
                <span className="workflow-ruler-major" aria-hidden="true" />
                <span className="workflow-ruler-tooltip" aria-hidden="true">
                  <span className="workflow-ruler-title">{item.complete && <Check size={14} />} {item.label}</span>
                  <span className="workflow-ruler-state">{state}</span>
                </span>
              </button>
              {index < steps.length - 1 && <span className="workflow-ruler-minors" aria-hidden="true">
                {Array.from({ length: 11 }, (_, offset) => {
                  const position = tickIndex + offset + 1;
                  const scale = hoveredTick === null ? 1 : 1 + 2 * Math.max(0, 1 - Math.abs(hoveredTick - position) / 5);
                  return <i key={position} onPointerEnter={() => setHoveredTick(position)} style={{ transform: `scaleX(${scale})` }} />;
                })}
              </span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
