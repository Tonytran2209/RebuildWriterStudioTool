import { useState } from 'react';
import { BookOpen, Globe2, ScrollText } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ActionDataSource, AppConfig, DocumentFile, FileCategory, KbSubTab, WebsiteContentRecord } from '../../types';
import SourceImportPanel from './SourceImportPanel';
import WorkflowRulesPanel from './WorkflowRulesPanel';

const SUBTAB_META: Record<KbSubTab, { label: string; category?: FileCategory; hint: string; icon: LucideIcon }> = {
  kb: {
    label: 'Knowledge Base',
    category: 'kb',
    hint: 'Kiến thức cốt lõi, sản phẩm, nghiên cứu và tài liệu tham khảo',
    icon: BookOpen,
  },
  rules: {
    label: 'Skills & Rules',
    category: 'rules',
    hint: 'Taxonomy, tone of voice, cấu trúc và quy tắc bắt buộc',
    icon: ScrollText,
  },
  website: {
    label: 'Website Inventory',
    hint: 'Danh sách URL duy nhất AI được phép đề xuất làm internal link',
    icon: Globe2,
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
  const [activeSubTab, setActiveSubTab] = useState<KbSubTab>('kb');
  const meta = SUBTAB_META[activeSubTab];

  const sources = meta.category ? files.filter(file => file.category === meta.category).map(toSource) : [];

  const handleChange = (nextSources: ActionDataSource[]) => {
    const category = meta.category as 'kb' | 'rules';
    const otherFiles = files.filter(file => file.category !== category);
    onChange([...otherFiles, ...nextSources.map(source => toDocument(source, category))]);
  };

  return (
    <div className="space-y-7">
      <div className="settings-subnav flex gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1">
        {(Object.entries(SUBTAB_META) as [KbSubTab, typeof SUBTAB_META[KbSubTab]][]).map(([key, item]) => (
          <button
            key={key}
            onClick={() => setActiveSubTab(key)}
            aria-current={activeSubTab === key ? 'page' : undefined}
            className={`inline-flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              activeSubTab === key
                ? 'is-active bg-white text-slate-900'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <item.icon className="app-icon shrink-0" aria-hidden="true" />
            {item.label}
          </button>
        ))}
      </div>

      {activeSubTab === 'rules' ? (
        <WorkflowRulesPanel config={config} files={files} onChange={onConfigChange} />
      ) : activeSubTab === 'website' ? (
        <WebsiteInventoryPanel records={config.websiteInventory ?? []} onChange={records => onConfigChange({ ...config, websiteInventory: records })} />
      ) : (
        <div className="space-y-4">
          <SourceImportPanel key={activeSubTab} category={meta.category ?? 'kb'} sources={sources} onChange={handleChange} railwayUrl={railwayUrl} knowledgeGovernance />
        </div>
      )}
    </div>
  );
}

function WebsiteInventoryPanel({ records, onChange }: { records: WebsiteContentRecord[]; onChange: (records: WebsiteContentRecord[]) => void }) {
  const [url, setUrl] = useState(''); const [title, setTitle] = useState('');
  const add = () => { try { const parsed=new URL(url); if (!/^https?:$/.test(parsed.protocol) || !title.trim()) return; const record:WebsiteContentRecord={id:`url-${Date.now()}`,url:parsed.toString(),title:title.trim(),contentType:'blog',topics:[],status:'unchecked',eligibleForInternalLink:true}; onChange([record,...records]); setUrl(''); setTitle(''); } catch { /* invalid URL stays editable */ } };
  return <div className="space-y-7"><section><h2 className="text-sm font-medium text-slate-800">Website inventory</h2><p className="mt-1 text-xs leading-5 text-slate-400">Only active or redirected URLs can pass the internal-link Quality Gate.</p><div className="mt-4 grid gap-2 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-[1fr_1.4fr_auto]"><input value={title} onChange={event=>setTitle(event.target.value)} placeholder="Page title" className="h-10 rounded-lg border border-slate-200 px-3 text-sm outline-none"/><input value={url} onChange={event=>setUrl(event.target.value)} placeholder="https://flearningstudio.com/..." className="h-10 rounded-lg border border-slate-200 px-3 text-sm outline-none"/><button onClick={add} className="h-10 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white">Add URL</button></div></section><section><h3 className="mb-3 text-sm font-medium text-slate-800">Approved pages <span className="ml-1 font-normal text-slate-400">{records.length}</span></h3><div className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">{records.length===0?<p className="px-4 py-8 text-center text-sm text-slate-400">No website pages added.</p>:records.map(record=><div key={record.id} className="website-inventory-row px-4 py-3.5"><div className="flex flex-col gap-3 lg:flex-row lg:items-center"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-slate-800">{record.title}</p><p className="mt-0.5 truncate text-xs text-slate-400">{record.url}</p></div><div className="flex flex-wrap items-center gap-2"><select aria-label="Content type" value={record.contentType} onChange={event=>onChange(records.map(item=>item.id===record.id?{...item,contentType:event.target.value as WebsiteContentRecord['contentType']}:item))} className="h-9 rounded-lg border border-slate-200 px-2.5 text-sm"><option value="blog">Blog</option><option value="service">Service</option><option value="portfolio">Portfolio</option><option value="landing">Landing</option><option value="about">About</option><option value="commercial">Commercial</option></select><select aria-label="URL status" value={record.status} onChange={event=>onChange(records.map(item=>item.id===record.id?{...item,status:event.target.value as WebsiteContentRecord['status'],lastChecked:new Date().toISOString()}:item))} className="h-9 rounded-lg border border-slate-200 px-2.5 text-sm"><option value="unchecked">Unchecked</option><option value="active">Active</option><option value="redirected">Redirected</option><option value="broken">Broken</option></select><label className="flex items-center gap-2 px-1 text-sm text-slate-500"><input type="checkbox" checked={record.eligibleForInternalLink} onChange={event=>onChange(records.map(item=>item.id===record.id?{...item,eligibleForInternalLink:event.target.checked}:item))}/>Allowed</label><button onClick={()=>onChange(records.filter(item=>item.id!==record.id))} className="rounded-lg px-2.5 py-2 text-xs text-red-500">Remove</button></div></div></div>)}</div></section></div>;
}
