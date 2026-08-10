import { useState, useRef } from 'react';
import type { AppConfig, ActionDataSource, DocumentFile, ActiveTab } from '../../types';
import TabStepSetup from './TabStepSetup';
import TabModels from './TabModels';
import TabKnowledgeBase from './TabKnowledgeBase';
import { saveConfig } from '../../lib/db';
import { sanitizeConfigFileAccess } from '../../lib/documentStatus';

interface Props {
  config: AppConfig;
  files: DocumentFile[];
  onSave: (config: AppConfig, files: DocumentFile[]) => void;
  onClose: () => void;
}

const TABS: { id: ActiveTab; label: string; icon: string }[] = [
  { id: 'step-setup',      label: 'Phân quyền AI theo Step',       icon: '⬡' },
  { id: 'models',          label: 'Quản lý AI Models',             icon: '◆' },
  { id: 'knowledge-base',  label: 'Kho dữ liệu (KB / AP / Rules)', icon: '▤' },
];

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export default function ConfigModal({ config, files, onSave, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<ActiveTab>('step-setup');
  const [localConfig, setLocalConfig] = useState<AppConfig>({ ...config });
  const [localFiles, setLocalFiles] = useState<DocumentFile[]>([...files]);
  const [autoSaveState, setAutoSaveState] = useState<SaveState>('idle');
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSave = () => {
    const sanitized = sanitizeConfigFileAccess(localConfig, localFiles);
    setLocalConfig(sanitized);
    onSave(sanitized, localFiles);
    onClose();
  };

  // Auto-save actionSources immediately to Supabase whenever they change
  const handleActionSourcesChange = async (sources: ActionDataSource[]) => {
    const updated = sanitizeConfigFileAccess({ ...localConfig, actionSources: sources }, localFiles);
    setLocalConfig(updated);

    // Debounce slightly to batch rapid changes
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      setAutoSaveState('saving');
      try {
        await saveConfig(updated);
        setAutoSaveState('saved');
        // Sync parent state so modal close doesn't lose the change
        onSave(updated, localFiles);
        setTimeout(() => setAutoSaveState('idle'), 2000);
      } catch {
        setAutoSaveState('error');
        setTimeout(() => setAutoSaveState('idle'), 3000);
      }
    }, 400);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-0 sm:p-5">
      <div className="bg-[#ebedf3] w-full max-w-5xl h-dvh sm:h-auto sm:max-h-[93dvh] rounded-none sm:rounded-3xl p-1 sm:p-1.5 shadow-2xl border border-slate-200/80 flex flex-col">
        <div className="bg-white rounded-2xl flex-1 flex flex-col overflow-hidden">

          {/* Modal Header */}
          <div className="flex justify-between items-center gap-3 border-b border-slate-100 px-3 sm:px-6 py-3 sm:py-4 shrink-0">
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-slate-800">Cấu hình Rules DB & Phân quyền AI Model</h2>
              <p className="hidden sm:block text-xs text-slate-400 mt-0.5">Quản lý kho tài liệu, tích hợp Model AI và thiết lập luật truy xuất cho từng Step</p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-all"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Tab nav */}
          <div className="px-2 sm:px-6 pt-2 sm:pt-4 shrink-0 overflow-x-auto">
            <div className="bg-[#eaedf3] p-1 sm:p-1.5 rounded-xl sm:rounded-2xl flex items-center gap-1 min-w-max sm:min-w-0">
              {TABS.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`sm:flex-1 px-3 sm:px-2 py-2 text-[11px] sm:text-xs font-semibold rounded-xl transition-all text-center flex items-center justify-center gap-1.5 ${
                    activeTab === tab.id
                      ? 'bg-white text-slate-800 shadow-sm'
                      : 'text-slate-400 hover:text-slate-700'
                  }`}
                >
                  <span>{tab.icon}</span>
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Tab content */}
          <div className="flex-1 min-h-0 overflow-y-auto px-2.5 sm:px-6 py-3 sm:py-5">
            {activeTab === 'step-setup' && (
              <TabStepSetup config={localConfig} files={localFiles} onChange={setLocalConfig} />
            )}
            {activeTab === 'models' && (
              <TabModels config={localConfig} onChange={setLocalConfig} />
            )}
            {activeTab === 'knowledge-base' && (
              <TabKnowledgeBase
                files={localFiles}
                onChange={setLocalFiles}
                actionSources={localConfig.actionSources ?? []}
                onActionSourcesChange={handleActionSourcesChange}
                railwayUrl={localConfig.railwayUrl}
              />
            )}
          </div>

          {/* Footer */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3 sm:px-6 py-2.5 sm:py-4 border-t border-slate-100 shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              {/* Auto-save indicator for Action Plan */}
              {activeTab === 'knowledge-base' && autoSaveState !== 'idle' && (
                <div className={`flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-lg ${
                  autoSaveState === 'saving' ? 'bg-blue-50 text-blue-600' :
                  autoSaveState === 'saved'  ? 'bg-emerald-50 text-emerald-600' :
                                               'bg-red-50 text-red-600'
                }`}>
                  {autoSaveState === 'saving' && (
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                  )}
                  {autoSaveState === 'saved'  && <span>✓</span>}
                  {autoSaveState === 'error'  && <span>✗</span>}
                  {autoSaveState === 'saving' ? 'Đang lưu...' : autoSaveState === 'saved' ? 'Đã lưu vào Supabase' : 'Lỗi lưu dữ liệu'}
                </div>
              )}
              <div className="hidden sm:block text-[11px] text-slate-400">
                Railway: <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-[10px]">{localConfig.railwayUrl ? '✓ kết nối' : 'Chưa cấu hình'}</code>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={onClose} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-all">
                Đóng
              </button>
              <button onClick={handleSave} className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl shadow-sm transition-all">
                Lưu cấu hình
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
