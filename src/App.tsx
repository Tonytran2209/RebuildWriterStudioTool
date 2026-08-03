import { useState, useEffect, useCallback } from 'react';
import type { Article, AppConfig, DocumentFile } from './types';
import { DEFAULT_CONFIG, DEFAULT_FILES, DEFAULT_ARTICLES } from './lib/defaultData';
import * as db from './lib/db';
import Sidebar from './components/Sidebar';
import StepNav from './components/StepNav';
import ConfigModal from './components/config/ConfigModal';
import Step1ContentType from './components/workspace/Step1ContentType';
import Step2CoreIdea from './components/workspace/Step2CoreIdea';
import Step3Outline from './components/workspace/Step3Outline';
import Step4Draft from './components/workspace/Step4Draft';

function generateId() {
  return `art-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function createNewArticle(): Article {
  return {
    id: generateId(),
    title: 'Bài viết mới',
    currentStep: 1,
    status: 'planning',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

type SyncStatus = 'idle' | 'loading' | 'saving' | 'error';

export default function App() {
  const [articles, setArticles] = useState<Article[]>(DEFAULT_ARTICLES);
  const [activeId, setActiveId] = useState<string>(DEFAULT_ARTICLES[0].id);
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [files, setFiles] = useState<DocumentFile[]>(DEFAULT_FILES);
  const [showConfig, setShowConfig] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('loading');

  // Load all data from Supabase on mount
  useEffect(() => {
    const load = async () => {
      setSyncStatus('loading');
      try {
        const [remoteArticles, remoteConfig, remoteFiles] = await Promise.all([
          db.fetchArticles(),
          db.fetchConfig(),
          db.fetchFiles(),
        ]);

        if (remoteArticles && remoteArticles.length > 0) {
          setArticles(remoteArticles);
          setActiveId(remoteArticles[0].id);
        }
        if (remoteConfig) setConfig(remoteConfig);
        if (remoteFiles && remoteFiles.length > 0) setFiles(remoteFiles);

        setSyncStatus('idle');
      } catch {
        // Supabase not deployed yet — use defaults silently
        setSyncStatus('idle');
      }
    };
    load();
  }, []);

  const persistArticles = useCallback(async (updated: Article[]) => {
    setSyncStatus('saving');
    try {
      // Save the full list (upsert all at once)
      await Promise.all(updated.map(a => db.saveArticle(a)));
      setSyncStatus('idle');
    } catch {
      setSyncStatus('error');
    }
  }, []);

  const handleUpdateArticle = useCallback((id: string, updates: Partial<Article>) => {
    setArticles(prev => {
      const next = prev.map(a =>
        a.id === id ? { ...a, ...updates, updatedAt: new Date().toISOString() } : a
      );
      // Fire-and-forget persist of just the changed article
      const changed = next.find(a => a.id === id);
      if (changed) {
        setSyncStatus('saving');
        db.updateArticle(id, updates)
          .then(() => setSyncStatus('idle'))
          .catch(() => setSyncStatus('error'));
      }
      return next;
    });
  }, []);

  const handleNewArticle = () => {
    const newArt = createNewArticle();
    const next = [newArt, ...articles];
    setArticles(next);
    setActiveId(newArt.id);
    setSyncStatus('saving');
    db.saveArticle(newArt)
      .then(() => setSyncStatus('idle'))
      .catch(() => setSyncStatus('error'));
  };

  const handleSaveConfig = async (newConfig: AppConfig, newFiles: DocumentFile[]) => {
    setConfig(newConfig);
    setFiles(newFiles);
    setSyncStatus('saving');
    try {
      await Promise.all([db.saveConfig(newConfig), db.saveFiles(newFiles)]);
      setSyncStatus('idle');
    } catch {
      setSyncStatus('error');
    }
  };

  const article = articles.find(a => a.id === activeId) || articles[0];

  const handleStepChange = (step: number) => {
    handleUpdateArticle(article.id, { currentStep: step });
  };

  const handleNext = () => {
    const next = Math.min(article.currentStep + 1, 4);
    const status = next === 4 ? 'review' : 'in_progress';
    handleUpdateArticle(article.id, { currentStep: next, status });
  };

  const handlePrev = () => {
    handleUpdateArticle(article.id, { currentStep: Math.max(article.currentStep - 1, 1) });
  };

  const stepCfg = config.stepConfigs[article?.currentStep ?? 1];
  const currentModel =
    config.models.find(m => m.id === stepCfg?.modelId && m.enabled) ||
    config.models.find(m => m.enabled);

  if (syncStatus === 'loading') {
    return (
      <div className="h-screen flex items-center justify-center bg-[#f4f5f8]">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 rounded-2xl bg-slate-900 text-white flex items-center justify-center font-bold text-lg mx-auto">W</div>
          <div className="text-sm font-semibold text-slate-700">Đang tải Writer Studio...</div>
          <div className="text-xs text-slate-400">Kết nối Supabase</div>
          <div className="w-40 h-1 bg-slate-200 rounded-full overflow-hidden mx-auto">
            <div className="h-full bg-slate-800 rounded-full animate-[shimmer_1s_ease-in-out_infinite]" style={{ width: '60%' }} />
          </div>
        </div>
      </div>
    );
  }

  if (!article) return null;

  return (
    <div className="h-screen flex overflow-hidden bg-[#f4f5f8]">
      <Sidebar
        articles={articles}
        activeArticleId={activeId}
        onSelectArticle={id => setActiveId(id)}
        onNewArticle={handleNewArticle}
        onOpenConfig={() => setShowConfig(true)}
      />

      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <StepNav
          currentStep={article.currentStep}
          onStepChange={handleStepChange}
          currentModel={currentModel}
          syncStatus={syncStatus}
        />

        <main className="flex-1 overflow-hidden p-5">
          {article.currentStep === 1 && (
            <Step1ContentType
              article={article}
              onUpdate={u => handleUpdateArticle(article.id, u)}
              onNext={handleNext}
            />
          )}
          {article.currentStep === 2 && (
            <Step2CoreIdea
              article={article}
              model={currentModel || config.models[0]}
              railwayUrl={config.railwayUrl}
              onUpdate={u => handleUpdateArticle(article.id, u)}
              onNext={handleNext}
              onPrev={handlePrev}
            />
          )}
          {article.currentStep === 3 && (
            <Step3Outline
              article={article}
              model={currentModel || config.models[0]}
              railwayUrl={config.railwayUrl}
              onUpdate={u => handleUpdateArticle(article.id, u)}
              onNext={handleNext}
              onPrev={handlePrev}
            />
          )}
          {article.currentStep === 4 && (
            <Step4Draft
              article={article}
              model={currentModel || config.models[0]}
              railwayUrl={config.railwayUrl}
              onUpdate={u => handleUpdateArticle(article.id, u)}
              onPrev={handlePrev}
            />
          )}
        </main>
      </div>

      {showConfig && (
        <ConfigModal
          config={config}
          files={files}
          onSave={handleSaveConfig}
          onClose={() => setShowConfig(false)}
        />
      )}
    </div>
  );
}
