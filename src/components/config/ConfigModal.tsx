import { useState } from 'react';
import { Bot, Cpu, Library, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AppConfig, Article, DocumentFile, ActiveTab } from '../../types';
import TabStepSetup from './TabStepSetup';
import TabModels from './TabModels';
import TabKnowledgeBase from './TabKnowledgeBase';
import { sanitizeConfigFileAccess } from '../../lib/documentStatus';
import { useI18n } from '../../lib/i18n';

interface Props {
  config: AppConfig;
  files: DocumentFile[];
  articles: Article[];
  onSave: (config: AppConfig, files: DocumentFile[]) => void;
  onClose: () => void;
}

const TABS: { id: ActiveTab; label: string; icon: LucideIcon }[] = [
  { id: 'step-setup', label: 'Phân quyền AI theo Step', icon: Bot },
  { id: 'models', label: 'Quản lý AI Models', icon: Cpu },
  { id: 'knowledge-base', label: 'Knowledge Base & Skills', icon: Library },
];

export default function ConfigModal({ config, files, articles, onSave, onClose }: Props) {
  const { language, tr } = useI18n();
  const [activeTab, setActiveTab] = useState<ActiveTab>('step-setup');
  const [localConfig, setLocalConfig] = useState<AppConfig>({ ...config });
  const [localFiles, setLocalFiles] = useState<DocumentFile[]>([...files]);

  const handleSave = () => {
    const sanitized = sanitizeConfigFileAccess(localConfig, localFiles);
    setLocalConfig(sanitized);
    onSave(sanitized, localFiles);
    onClose();
  };

  return (
    <div className="minimal-settings fixed inset-0 bg-slate-900/30 z-50 flex items-center justify-center p-0 sm:p-5">
      <div className="settings-shell bg-[#ebedf3] w-full max-w-5xl h-dvh sm:h-auto sm:max-h-[93dvh] rounded-none sm:rounded-3xl p-1 sm:p-1.5 shadow-2xl border border-slate-200/80 flex flex-col">
        <div className="settings-panel bg-white rounded-2xl flex-1 flex flex-col overflow-hidden">

          {/* Modal Header */}
          <div className="settings-header flex justify-between items-center gap-3 border-b border-slate-100 px-3 sm:px-6 py-3 sm:py-4 shrink-0">
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-slate-800">{tr('Cấu hình Rules DB & Phân quyền AI Model', 'Rules DB & AI Model Access Settings')}</h2>
              <p className="hidden sm:block text-xs text-slate-400 mt-0.5">{tr('Quản lý kho tài liệu, tích hợp Model AI và thiết lập luật truy xuất cho từng Step', 'Manage documents, AI models, and retrieval permissions for each step')}</p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-all"
            >
              <X className="app-icon" aria-hidden="true" />
            </button>
          </div>

          {/* Tab nav */}
          <div className="settings-tabs-wrap px-2 sm:px-6 pt-2 sm:pt-4 shrink-0 overflow-x-auto">
            <div className="settings-tabs bg-[#eaedf3] p-1 sm:p-1.5 rounded-xl sm:rounded-2xl flex items-center gap-1 min-w-max sm:min-w-0">
              {TABS.map(tab => {
                const TabIcon = tab.icon;
                return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`sm:flex-1 px-3 sm:px-2 py-2 text-[11px] sm:text-xs font-semibold rounded-xl transition-all text-center flex items-center justify-center gap-1.5 ${
                    activeTab === tab.id
                      ? 'bg-white text-slate-800 shadow-sm'
                      : 'text-slate-400 hover:text-slate-700'
                  }`}
                >
                  <TabIcon className="app-icon" aria-hidden="true" />
                  <span>{language === 'vi' ? tab.label : ({
                    'step-setup': 'AI access by Step',
                    models: 'AI Model management',
                    'knowledge-base': 'Knowledge Base & Skills',
                  } as Record<ActiveTab, string>)[tab.id]}</span>
                </button>
                );
              })}
            </div>
          </div>

          {/* Tab content */}
          <div className="settings-content flex-1 min-h-0 overflow-y-auto px-2.5 sm:px-6 py-3 sm:py-5">
            {activeTab === 'step-setup' && (
              <TabStepSetup config={localConfig} files={localFiles} articles={articles} onChange={setLocalConfig} />
            )}
            {activeTab === 'models' && (
              <TabModels config={localConfig} onChange={setLocalConfig} />
            )}
            {activeTab === 'knowledge-base' && (
              <TabKnowledgeBase
                files={localFiles}
                onChange={setLocalFiles}
                railwayUrl={localConfig.railwayUrl}
                config={localConfig}
                onConfigChange={setLocalConfig}
              />
            )}
          </div>

          {/* Footer */}
          <div className="settings-footer flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3 sm:px-6 py-2.5 sm:py-4 border-t border-slate-100 shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <div className="hidden sm:block text-[11px] text-slate-400">
                Railway: <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-[10px]">{localConfig.railwayUrl ? '✓ kết nối' : 'Chưa cấu hình'}</code>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={onClose} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-all">
                {tr('Đóng', 'Close')}
              </button>
              <button onClick={handleSave} className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl shadow-sm transition-all">
                {tr('Lưu cấu hình', 'Save settings')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
