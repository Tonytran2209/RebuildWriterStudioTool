import { useMemo, useState } from 'react';
import { ChevronDown, Coins } from 'lucide-react';
import type { AICallUsage } from '../../types';
import { useI18n } from '../../lib/i18n';

interface Props {
  step: number;
  usage?: AICallUsage[];
}

export function StepUsage({ step, usage = [] }: Props) {
  const { language, tr } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const summary = useMemo(() => ({
    tokens: usage.reduce((total, item) => total + Number(item.totalTokens ?? 0), 0),
    cost: usage.reduce((total, item) => total + Number(item.costUsd ?? 0), 0),
    hasUnknownCost: usage.some(item => item.costUsd == null),
  }), [usage]);

  if (!usage.length) return null;

  return (
    <section className="step-usage" aria-label={tr(`Chi phí AI Bước ${step}`, `Step ${step} AI usage`)}>
      <button type="button" onClick={() => setExpanded(value => !value)} className="step-usage-summary" aria-expanded={expanded}>
        <Coins className="app-icon" aria-hidden="true" />
        <span>{tr(`Bước ${step}: `, `Step ${step}: `)}{usage.length} {tr('AI calls', 'AI calls')}</span>
        <span className="step-usage-divider" aria-hidden="true" />
        <span>{summary.tokens.toLocaleString()} tokens</span>
        <span className="font-mono">{summary.hasUnknownCost ? `${summary.cost ? `$${summary.cost.toFixed(4)} +` : 'USD: N/A'}` : `$${summary.cost.toFixed(4)}`}</span>
        <ChevronDown className={`app-icon step-usage-chevron ${expanded ? 'is-open' : ''}`} aria-hidden="true" />
      </button>
      {expanded && (
        <div className="step-usage-details">
          {[...usage].reverse().map(item => (
            <div key={item.id} className="step-usage-row">
              <div className="min-w-0">
                <b>{item.model}</b>
                <span>In {item.inputTokens.toLocaleString()}{item.cachedInputTokens ? ` (${item.cachedInputTokens.toLocaleString()} cached)` : ''} · Out {item.outputTokens.toLocaleString()} · Total {item.totalTokens.toLocaleString()}</span>
              </div>
              <div className="shrink-0 text-right">
                <b>{item.costUsd == null ? 'N/A' : `$${item.costUsd.toFixed(6)}`}</b>
                <span>{item.cacheHit ? 'cache · $0' : new Date(item.calledAt).toLocaleTimeString(language === 'vi' ? 'vi-VN' : 'en-US')}</span>
              </div>
            </div>
          ))}
          {summary.hasUnknownCost && <p>{tr('N/A: chưa cấu hình đơn giá cho một hoặc nhiều model.', 'N/A: pricing is not configured for one or more models.')}</p>}
        </div>
      )}
    </section>
  );
}
