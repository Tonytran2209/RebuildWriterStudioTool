import { useState } from 'react';
import type { ActionDataSource, AppConfig, DocumentFile, FileCategory, KbSubTab, WebsiteContentRecord } from '../../types';
import SourceImportPanel from './SourceImportPanel';
import WorkflowRulesPanel from './WorkflowRulesPanel';
import { useI18n } from '../../lib/i18n';

const SUBTAB_META: Record<KbSubTab, { label: string; category?: FileCategory; hint: string }> = {
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
  website: {
    label: '3. Website Inventory',
    hint: 'Danh sách URL duy nhất AI được phép đề xuất làm internal link',
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

  const sources = meta.category ? files.filter(file => file.category === meta.category).map(toSource) : [];

  const handleChange = (nextSources: ActionDataSource[]) => {
    const category = meta.category as 'kb' | 'rules';
    const otherFiles = files.filter(file => file.category !== category);
    onChange([...otherFiles, ...nextSources.map(source => toDocument(source, category))]);
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200 pb-2">
        {(Object.entries(SUBTAB_META) as [KbSubTab, typeof SUBTAB_META[KbSubTab]][]).map(([key, item]) => (
          <button
            key={key}
            onClick={() => setActiveSubTab(key)}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-[11px] font-normal transition-colors ${
              activeSubTab === key
                ? 'bg-slate-100 text-slate-900'
                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            {language === 'vi' ? item.label : key === 'kb' ? '1. Knowledge Base' : key === 'rules' ? '2. Skills & Rules' : '3. Website Inventory'}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[11px] leading-relaxed text-slate-600">
        <strong>{meta.label}:</strong> {activeSubTab === 'kb'
          ? <>{language === 'vi' ? meta.hint : 'Core knowledge, products, research, and references'}. {tr('Mọi phương thức đều được Railway xử lý và chỉ được đánh dấu sẵn sàng sau khi Supabase đã lưu nội dung thật.', 'Every import method is processed by Railway and marked ready only after Supabase stores the actual content.')}</>
          : activeSubTab === 'rules' ? <>{tr('Hiển thị rule, luồng xử lý và cách đọc dữ liệu thực sự đang điều khiển pipeline AI. Đây là cấu hình vận hành, không phải danh sách tài liệu upload.', 'Shows the rules, processing flow, and data-reading behavior that actually control the AI pipeline. This is operational configuration, not an uploaded-document list.')}</>
          : <>{tr(meta.hint, 'The authoritative URL list AI may use for internal linking. Broken or unchecked URLs are excluded from publish-ready output.')}</>}
      </div>

      {activeSubTab === 'rules' ? (
        <WorkflowRulesPanel config={config} files={files} onChange={onConfigChange} />
      ) : activeSubTab === 'website' ? (
        <WebsiteInventoryPanel records={config.websiteInventory ?? []} onChange={records => onConfigChange({ ...config, websiteInventory: records })} />
      ) : (
        <div className="space-y-4">
          <SourceImportPanel key={activeSubTab} category={meta.category ?? 'kb'} sources={sources} onChange={handleChange} railwayUrl={railwayUrl} />
          {files.filter(file => file.category === 'kb').length > 0 && <section className="rounded-xl border border-slate-200 bg-white p-3"><h3 className="text-[11px] font-medium text-slate-800">Knowledge governance</h3><p className="mt-1 text-[9px] text-slate-400">Control retrieval metadata and whether a source may appear in public content.</p><div className="mt-3 space-y-2">{files.filter(file => file.category === 'kb').map(file => { const metadata=file.knowledgeMetadata ?? {type:'reference' as const,topics:[],visibility:'internal' as const,approvedForExternalUse:false}; return <div key={file.id} className="grid gap-2 rounded-lg border border-slate-200 p-2.5 sm:grid-cols-[1fr_140px_auto]"><div className="min-w-0"><b className="block truncate text-[10px] text-slate-700">{file.name}</b><input value={metadata.topics.join(', ')} onChange={event=>onChange(files.map(item=>item.id===file.id?{...item,knowledgeMetadata:{...metadata,topics:event.target.value.split(',').map(value=>value.trim()).filter(Boolean)}}:item))} placeholder="topics, separated by commas" className="mt-1 w-full bg-transparent text-[9px] text-slate-500 outline-none"/></div><select value={metadata.type} onChange={event=>onChange(files.map(item=>item.id===file.id?{...item,knowledgeMetadata:{...metadata,type:event.target.value as typeof metadata.type}}:item))} className="rounded-md border border-slate-200 bg-white px-2 text-[9px]"><option value="reference">Reference</option><option value="usp">USP</option><option value="positioning">Positioning</option><option value="client_insight">Client insight</option><option value="case_study">Case study</option><option value="framework">Framework</option><option value="approved_claim">Approved claim</option><option value="production_insight">Production insight</option></select><label className="flex items-center gap-1.5 text-[9px] text-slate-500"><input type="checkbox" checked={metadata.approvedForExternalUse} onChange={event=>onChange(files.map(item=>item.id===file.id?{...item,knowledgeMetadata:{...metadata,approvedForExternalUse:event.target.checked,visibility:event.target.checked?'public':'internal'}}:item))}/>External use</label></div>})}</div></section>}
        </div>
      )}
    </div>
  );
}

function WebsiteInventoryPanel({ records, onChange }: { records: WebsiteContentRecord[]; onChange: (records: WebsiteContentRecord[]) => void }) {
  const [url, setUrl] = useState(''); const [title, setTitle] = useState('');
  const add = () => { try { const parsed=new URL(url); if (!/^https?:$/.test(parsed.protocol) || !title.trim()) return; const record:WebsiteContentRecord={id:`url-${Date.now()}`,url:parsed.toString(),title:title.trim(),contentType:'blog',topics:[],status:'unchecked',eligibleForInternalLink:true}; onChange([record,...records]); setUrl(''); setTitle(''); } catch { /* invalid URL stays editable */ } };
  return <div className="space-y-3"><div className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-[1fr_1fr_auto]"><input value={title} onChange={event=>setTitle(event.target.value)} placeholder="Page title" className="rounded-lg border border-slate-200 px-3 py-2 text-[10px] outline-none"/><input value={url} onChange={event=>setUrl(event.target.value)} placeholder="https://flearningstudio.com/..." className="rounded-lg border border-slate-200 px-3 py-2 text-[10px] outline-none"/><button onClick={add} className="rounded-lg bg-slate-900 px-3 py-2 text-[10px] font-medium text-white">Add URL</button></div><div className="space-y-2">{records.map(record=><div key={record.id} className="grid items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-[1fr_110px_100px_auto_auto]"><div className="min-w-0"><b className="block truncate text-[10px] text-slate-800">{record.title}</b><span className="block truncate text-[9px] text-slate-400">{record.url}</span></div><select value={record.contentType} onChange={event=>onChange(records.map(item=>item.id===record.id?{...item,contentType:event.target.value as WebsiteContentRecord['contentType']}:item))} className="rounded-md border border-slate-200 p-1.5 text-[9px]"><option value="blog">Blog</option><option value="service">Service</option><option value="portfolio">Portfolio</option><option value="landing">Landing</option><option value="about">About</option><option value="commercial">Commercial</option></select><select value={record.status} onChange={event=>onChange(records.map(item=>item.id===record.id?{...item,status:event.target.value as WebsiteContentRecord['status'],lastChecked:new Date().toISOString()}:item))} className="rounded-md border border-slate-200 p-1.5 text-[9px]"><option value="unchecked">Unchecked</option><option value="active">Active</option><option value="redirected">Redirected</option><option value="broken">Broken</option></select><label className="flex items-center gap-1 text-[9px] text-slate-500"><input type="checkbox" checked={record.eligibleForInternalLink} onChange={event=>onChange(records.map(item=>item.id===record.id?{...item,eligibleForInternalLink:event.target.checked}:item))}/>Allowed</label><button onClick={()=>onChange(records.filter(item=>item.id!==record.id))} className="text-[9px] text-rose-500">Remove</button></div>)}</div></div>;
}
