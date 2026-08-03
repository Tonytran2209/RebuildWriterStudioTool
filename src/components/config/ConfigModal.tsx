import { useState } from 'react';
import type { AppConfig, DocumentFile, ActiveTab, KbSubTab } from '../../types';
import { PROVIDER_LABELS, STEP_LABELS } from '../../lib/defaultData';
import TabStepSetup from './TabStepSetup';
import TabModels from './TabModels';
import TabKnowledgeBase from './TabKnowledgeBase';

interface Props {
  config: AppConfig;
  files: DocumentFile[];
  onSave: (config: AppConfig, files: DocumentFile[]) => void;
  onClose: () => void;
}

const TABS: { id: ActiveTab; label: string; icon: string }[] = [
  { id: 'step-setup', label: 'Phân quyền AI theo Step', icon: '⬡' },
  { id: 'models', label: 'Quản lý AI Models', icon: '◆' },
  { id: 'knowledge-base', label: 'Kho dữ liệu (KB / AP / Rules)', icon: '▤' },
];

export default function ConfigModal({ config, files, onSave, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<ActiveTab>('step-setup');
  const [localConfig, setLocalConfig] = useState<AppConfig>({ ...config });
  const [localFiles, setLocalFiles] = useState<DocumentFile[]>([...files]);

  const handleSave = () => {
    onSave(localConfig, localFiles);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-5">
      <div className="bg-[#ebedf3] w-full max-w-5xl rounded-3xl p-1.5 shadow-2xl border border-slate-200/80 max-h-[93vh] flex flex-col">
        <div className="bg-white rounded-2xl flex-1 flex flex-col overflow-hidden">

          {/* Modal Header */}
          <div className="flex justify-between items-center border-b border-slate-100 px-6 py-4 shrink-0">
            <div>
              <h2 className="text-sm font-bold text-slate-800">Cấu hình Rules DB & Phân quyền AI Model</h2>
              <p className="text-xs text-slate-400 mt-0.5">Quản lý kho tài liệu, tích hợp Model AI và thiết lập luật truy xuất cho từng Step</p>
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
          <div className="px-6 pt-4 shrink-0">
            <div className="bg-[#eaedf3] p-1.5 rounded-2xl flex items-center space-x-1">
              {TABS.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex-1 py-2 text-xs font-semibold rounded-xl transition-all text-center flex items-center justify-center gap-1.5 ${
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
          <div className="flex-1 overflow-y-auto px-6 py-5">
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
                onActionSourcesChange={sources => setLocalConfig(c => ({ ...c, actionSources: sources }))}
              />
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 shrink-0">
            <div className="text-[11px] text-slate-400">
              Railway URL: <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">{localConfig.railwayUrl || 'Chưa cấu hình'}</code>
            </div>
            <div className="flex gap-2">
              <button onClick={onClose} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-all">
                Hủy
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
