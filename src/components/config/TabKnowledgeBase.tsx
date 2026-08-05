import { useRef } from 'react';
import { useState } from 'react';
import type { ActionDataSource, DocumentFile, FileCategory, KbSubTab } from '../../types';
import ActionPlanTab from './ActionPlanTab';
import { isDocumentReady } from '../../lib/documentStatus';
import { uploadDocumentToRailway } from '../../lib/railwayUpload';
import { downloadDocumentFromRailway } from '../../lib/railwayDownload';

const FILE_ICONS: Record<string, { icon: string; color: string }> = {
  pdf: { icon: '📄', color: 'text-red-500' },
  docx: { icon: '📝', color: 'text-blue-500' },
  csv: { icon: '📊', color: 'text-emerald-600' },
  xlsx: { icon: '📈', color: 'text-emerald-700' },
  txt: { icon: '📃', color: 'text-amber-500' },
  md: { icon: '📋', color: 'text-slate-600' },
  json: { icon: '🗂', color: 'text-slate-500' },
};

const SUBTAB_META: Record<KbSubTab, { label: string; color: string; bg: string; border: string; uploadLabel: string; uploadHint: string; accept: string; category: FileCategory }> = {
  kb: {
    label: '1. Knowledge Base', color: 'text-indigo-600', bg: 'bg-indigo-50/30', border: 'border-indigo-200 hover:border-indigo-500',
    uploadLabel: 'Tải lên tài liệu Knowledge Base (.pdf, .docx)',
    uploadHint: 'Tài liệu kiến thức cốt lõi, bảng giá, thông tin sản phẩm, phân tích đối thủ',
    accept: '.pdf,.docx,.json', category: 'kb',
  },
  action: {
    label: '2. Action Plan', color: 'text-emerald-600', bg: 'bg-emerald-50/30', border: 'border-emerald-200 hover:border-emerald-500',
    uploadLabel: 'Tải lên file Action Plan (.csv, .xlsx)',
    uploadHint: 'Danh sách từ khóa, kế hoạch thực thi, lộ trình nội dung, content calendar',
    accept: '.csv,.xlsx,.xls', category: 'action',
  },
  rules: {
    label: '3. Rules & Guidelines', color: 'text-amber-600', bg: 'bg-amber-50/30', border: 'border-amber-200 hover:border-amber-500',
    uploadLabel: 'Tải lên file Rules & Tone Guidelines (.txt, .md)',
    uploadHint: 'Quy tắc văn phong, từ ngữ cấm, định dạng bắt buộc, brand guidelines',
    accept: '.txt,.md,.docx', category: 'rules',
  },
};

interface Props {
  files: DocumentFile[];
  onChange: (files: DocumentFile[]) => void;
  actionSources: ActionDataSource[];
  onActionSourcesChange: (sources: ActionDataSource[]) => void;
  railwayUrl: string;
}

export default function TabKnowledgeBase({ files, onChange, actionSources, onActionSourcesChange, railwayUrl }: Props) {
  const [activeSubTab, setActiveSubTab] = useState<KbSubTab>('kb');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState('');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const meta = SUBTAB_META[activeSubTab];
  const catFiles = files.filter(f => f.category === meta.category);

  const handleFileInput = async (fileList: FileList | null) => {
    if (!fileList) return;
    setReading(true);
    setReadError('');
    try {
      const newFiles: DocumentFile[] = [];
      for (const f of Array.from(fileList)) {
        const result = await uploadDocumentToRailway(f, meta.category, railwayUrl);
        newFiles.push(result.record as DocumentFile);
      }
      onChange([...files, ...newFiles]);
    } catch (error: unknown) {
      setReadError(error instanceof Error ? error.message : String(error));
    } finally {
      setReading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeFile = (id: string) => {
    onChange(files.filter(f => f.id !== id));
  };

  const downloadFile = async (file: DocumentFile) => {
    setDownloadingId(file.id);
    setReadError('');
    try {
      await downloadDocumentFromRailway(file.id, file.name, railwayUrl);
    } catch (error: unknown) {
      setReadError(error instanceof Error ? error.message : String(error));
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Sub-tab nav */}
      <div className="flex gap-2 border-b border-slate-200 pb-3">
        {(Object.entries(SUBTAB_META) as [KbSubTab, typeof SUBTAB_META[KbSubTab]][]).map(([key, m]) => (
          <button
            key={key}
            onClick={() => setActiveSubTab(key)}
            className={`px-4 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              activeSubTab === key
                ? 'bg-slate-900 text-white'
                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Action Plan subtab — multi-mode data input */}
      {activeSubTab === 'action' ? (
        <ActionPlanTab sources={actionSources} onChange={onActionSourcesChange} railwayUrl={railwayUrl} />
      ) : (
        <>
          {/* Upload zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); handleFileInput(e.dataTransfer.files); }}
            onClick={() => !reading && fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all ${meta.bg} ${meta.border} ${dragging ? 'scale-[0.99] opacity-80' : ''}`}
          >
            <div className="text-2xl mb-2">☁</div>
            <p className="text-xs font-bold text-slate-700">{reading ? 'Đang trích xuất nội dung tài liệu...' : meta.uploadLabel}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">{meta.uploadHint}</p>
            <p className="text-[10px] text-slate-300 mt-2">Kéo thả hoặc nhấp để chọn file</p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={meta.accept}
              className="hidden"
              onChange={e => handleFileInput(e.target.files)}
            />
            {readError && <p className="text-[11px] text-red-600 mt-2">{readError}</p>}
          </div>

          {/* File table */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3">
            <div className="flex items-center justify-between mb-3 px-1">
              <h4 className="text-xs font-bold text-slate-800">
                {meta.label} Files <span className="text-slate-400 font-normal">({catFiles.length})</span>
              </h4>
            </div>

            {catFiles.length === 0 ? (
              <div className="text-center py-8">
                <div className="text-2xl mb-2">📂</div>
                <p className="text-xs text-slate-400">Chưa có file nào. Tải lên tài liệu ở trên.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-[10px] text-slate-400 uppercase border-b border-slate-200">
                      <th className="pb-2 font-bold pl-1">Tên File</th>
                      <th className="pb-2 font-bold">Kích thước</th>
                      <th className="pb-2 font-bold">Ngày tải lên</th>
                      <th className="pb-2 font-bold">Dữ liệu DB</th>
                      <th className="pb-2 font-bold text-right pr-1">Hành động</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/60">
                    {catFiles.map(f => {
                      const iconMeta = FILE_ICONS[f.fileType] || FILE_ICONS.txt;
                      const ready = isDocumentReady(f);
                      return (
                        <tr key={f.id} className="group hover:bg-white transition-colors">
                          <td className="py-2.5 pl-1">
                            <div className="flex items-center gap-2">
                              <span className={`text-sm ${iconMeta.color}`}>{iconMeta.icon}</span>
                              <span className="font-semibold text-slate-800 truncate max-w-[200px]">{f.name}</span>
                            </div>
                          </td>
                          <td className="py-2.5 text-slate-500 font-mono text-[11px]">{f.size}</td>
                          <td className="py-2.5 text-slate-500">{f.uploadedAt}</td>
                          <td className="py-2.5">
                            <span className={`text-[9px] font-bold rounded-md border px-2 py-0.5 ${
                              ready
                                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                                : 'bg-red-50 border-red-200 text-red-700'
                            }`}>
                              {ready ? `${f.content!.length.toLocaleString('vi-VN')} ký tự` : 'Thiếu nội dung — tải lại'}
                            </span>
                          </td>
                          <td className="py-2.5 text-right pr-1">
                            <div className="flex justify-end items-center gap-1">
                              <button
                                onClick={() => downloadFile(f)}
                                disabled={downloadingId === f.id || !ready}
                                title={f.storagePath ? 'Tải file gốc từ Supabase' : 'Tải nội dung đã scan'}
                                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold text-blue-600 hover:bg-blue-50 disabled:opacity-40 transition-colors"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v12m0 0l-4-4m4 4l4-4M5 19h14" />
                                </svg>
                                {downloadingId === f.id ? 'Đang tải' : 'Tải về'}
                              </button>
                              <button
                                onClick={() => removeFile(f.id)}
                                title="Xóa tài liệu"
                                className="text-slate-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 p-1"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
