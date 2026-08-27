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
    <div className="minimal-settings fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-0 sm:p-5">
      <div className="settings-shell flex h-dvh w-full max-w-5xl flex-col border border-slate-200 bg-white sm:h-auto sm:max-h-[93dvh] sm:rounded-2xl">
        <div className="settings-panel flex flex-1 flex-col overflow-hidden bg-white sm:rounded-2xl">

          {/* Modal Header */}
          <div className="settings-header flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3.5 sm:px-5">
            <div className="min-w-0">
              <h2 className="text-sm font-medium text-slate-900">{tr('Cài đặt Writer Studio', 'Writer Studio settings')}</h2>
              <p className="mt-0.5 hidden text-[11px] text-slate-500 sm:block">{tr('Models, nguồn kiến thức và workflow rules', 'Models, knowledge sources, and workflow rules')}</p>
            </div>
            <button
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
              <X className="app-icon" aria-hidden="true" />
            </button>
          </div>

          {/* Tab nav */}
          <div className="settings-tabs-wrap shrink-0 overflow-x-auto border-b border-slate-200 px-3 pt-2 sm:px-5">
            <div className="settings-tabs flex min-w-max items-center gap-1 sm:min-w-0">
              {TABS.map(tab => {
                const TabIcon = tab.icon;
                return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-center text-[11px] font-normal transition-colors sm:flex-1 sm:px-2 ${
                    activeTab === tab.id
                      ? 'bg-slate-100 text-slate-900'
                      : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
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
          <div className="settings-content min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5">
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
          <div className="settings-footer flex shrink-0 flex-col justify-between gap-2 border-t border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
            <div className="flex items-center gap-3 min-w-0">
              <div className="hidden sm:block text-[11px] text-slate-400">
                Railway: <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-[10px]">{localConfig.railwayUrl ? '✓ kết nối' : 'Chưa cấu hình'}</code>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={onClose} className="rounded-lg px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900">
                {tr('Đóng', 'Close')}
              </button>
              <button onClick={handleSave} className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-slate-800">
                {tr('Lưu cấu hình', 'Save settings')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
