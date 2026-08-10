import { useState } from 'react';
import type { ActionDataSource, DocumentFile, FileCategory, KbSubTab } from '../../types';
import ActionPlanTab from './ActionPlanTab';
import { useI18n } from '../../lib/i18n';

const SUBTAB_META: Record<KbSubTab, { label: string; category: FileCategory; hint: string }> = {
  kb: {
    label: '1. Knowledge Base',
    category: 'kb',
    hint: 'Kiến thức cốt lõi, sản phẩm, nghiên cứu và tài liệu tham khảo',
  },
  action: {
    label: '2. Action Plan',
    category: 'action',
    hint: 'Keyword, timeline, content calendar và kế hoạch thực thi',
  },
  rules: {
    label: '3. Rules & Guidelines',
    category: 'rules',
    hint: 'Taxonomy, tone of voice, cấu trúc và quy tắc bắt buộc',
  },
};

interface Props {
  files: DocumentFile[];
  onChange: (files: DocumentFile[]) => void;
  actionSources: ActionDataSource[];
  onActionSourcesChange: (sources: ActionDataSource[]) => void;
  railwayUrl: string;
}

function toSource(file: DocumentFile): ActionDataSource {
  return {
    ...file,
    sourceType: file.sourceType ?? 'file',
    addedAt: file.addedAt ?? file.uploadedAt,
  } as ActionDataSource;
}

function toDocument(source: ActionDataSource, category: 'kb' | 'rules'): DocumentFile {
  return {
    ...source,
    category,
    uploadedAt: (source as ActionDataSource & { uploadedAt?: string }).uploadedAt ?? source.addedAt,
    size: source.size ?? `${new Blob([source.content ?? '']).size} B`,
    fileType: (source.fileType ?? (source.sourceType === 'manual' ? 'csv' : 'txt')) as DocumentFile['fileType'],
  };
}

export default function TabKnowledgeBase({
  files,
  onChange,
  actionSources,
  onActionSourcesChange,
  railwayUrl,
}: Props) {
  const { language, tr } = useI18n();
  const [activeSubTab, setActiveSubTab] = useState<KbSubTab>('kb');
  const meta = SUBTAB_META[activeSubTab];

  const sources = activeSubTab === 'action'
    ? actionSources
    : files.filter(file => file.category === meta.category).map(toSource);

  const handleChange = (nextSources: ActionDataSource[]) => {
    if (activeSubTab === 'action') {
      onActionSourcesChange(nextSources);
      return;
    }
    const category = meta.category as 'kb' | 'rules';
    const otherFiles = files.filter(file => file.category !== category);
    onChange([...otherFiles, ...nextSources.map(source => toDocument(source, category))]);
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b border-slate-200 pb-3 overflow-x-auto">
        {(Object.entries(SUBTAB_META) as [KbSubTab, typeof SUBTAB_META[KbSubTab]][]).map(([key, item]) => (
          <button
            key={key}
            onClick={() => setActiveSubTab(key)}
            className={`shrink-0 px-3 sm:px-4 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              activeSubTab === key
                ? 'bg-slate-900 text-white'
                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
            }`}
          >
            {language === 'vi' ? item.label : key === 'kb' ? '1. Knowledge Base' : key === 'action' ? '2. Action Plan' : '3. Rules & Guidelines'}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-2 text-[11px] text-blue-700">
        <strong>{meta.label}:</strong> {language === 'vi' ? meta.hint : tr(meta.hint, activeSubTab === 'kb' ? 'Core knowledge, products, research, and references' : activeSubTab === 'action' ? 'Keywords, timeline, content calendar, and execution plan' : 'Taxonomy, tone of voice, structure, and mandatory rules')}. {tr('Mọi phương thức đều được Railway xử lý và chỉ được đánh dấu sẵn sàng sau khi Supabase đã lưu nội dung thật.', 'Every import method is processed by Railway and marked ready only after Supabase stores the actual content.')}
      </div>

      <ActionPlanTab
        key={activeSubTab}
        category={meta.category}
        sources={sources}
        onChange={handleChange}
        railwayUrl={railwayUrl}
      />
    </div>
  );
}
