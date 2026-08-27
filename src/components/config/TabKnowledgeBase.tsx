import { useState } from 'react';
import type { ActionDataSource, AppConfig, DocumentFile, FileCategory, KbSubTab } from '../../types';
import SourceImportPanel from './SourceImportPanel';
import WorkflowRulesPanel from './WorkflowRulesPanel';
import { useI18n } from '../../lib/i18n';

const SUBTAB_META: Record<KbSubTab, { label: string; category: FileCategory; hint: string }> = {
  kb: {
    label: '1. Knowledge Base',
    category: 'kb',
    hint: 'Kiến thức cốt lõi, sản phẩm, nghiên cứu và tài liệu tham khảo',
  },
  rules: {
    label: '2. Skills & Rules',
    category: 'rules',
    hint: 'Taxonomy, tone of voice, cấu trúc và quy tắc bắt buộc',
  },
};

interface Props {
  files: DocumentFile[];
  onChange: (files: DocumentFile[]) => void;
  railwayUrl: string;
  config: AppConfig;
  onConfigChange: (config: AppConfig) => void;
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
  railwayUrl,
  config,
  onConfigChange,
}: Props) {
  const { language, tr } = useI18n();
  const [activeSubTab, setActiveSubTab] = useState<KbSubTab>('kb');
  const meta = SUBTAB_META[activeSubTab];

  const sources = files.filter(file => file.category === meta.category).map(toSource);

  const handleChange = (nextSources: ActionDataSource[]) => {
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
            {language === 'vi' ? item.label : key === 'kb' ? '1. Knowledge Base' : '2. Skills & Rules'}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-2 text-[11px] text-blue-700">
        <strong>{meta.label}:</strong> {activeSubTab === 'kb'
          ? <>{language === 'vi' ? meta.hint : 'Core knowledge, products, research, and references'}. {tr('Mọi phương thức đều được Railway xử lý và chỉ được đánh dấu sẵn sàng sau khi Supabase đã lưu nội dung thật.', 'Every import method is processed by Railway and marked ready only after Supabase stores the actual content.')}</>
          : <>{tr('Hiển thị rule, luồng xử lý và cách đọc dữ liệu thực sự đang điều khiển pipeline AI. Đây là cấu hình vận hành, không phải danh sách tài liệu upload.', 'Shows the rules, processing flow, and data-reading behavior that actually control the AI pipeline. This is operational configuration, not an uploaded-document list.')}</>}
      </div>

      {activeSubTab === 'rules' ? (
        <WorkflowRulesPanel config={config} files={files} onChange={onConfigChange} />
      ) : (
        <SourceImportPanel
          key={activeSubTab}
          category={meta.category}
          sources={sources}
          onChange={handleChange}
          railwayUrl={railwayUrl}
        />
      )}
    </div>
  );
}
