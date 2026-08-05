import { useState, useEffect, useCallback, useRef } from 'react';
import type { Article, AppConfig, DocumentFile } from './types';
import { DEFAULT_CONFIG, mergeWithLatestModelCatalog } from './lib/defaultData';
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
  const [articles, setArticles] = useState<Article[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [files, setFiles] = useState<DocumentFile[]>([]);
  const [showConfig, setShowConfig] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('loading');
  const [initialLoadError, setInitialLoadError] = useState<string | null>(null);
  const [articleActionError, setArticleActionError] = useState<string | null>(null);
  const [completionSavingId, setCompletionSavingId] = useState<string | null>(null);
  const articleMutationQueue = useRef<Promise<void>>(Promise.resolve());

  const enqueueArticleMutation = useCallback((operation: () => Promise<Article>): Promise<Article> => {
    const result = articleMutationQueue.current.then(operation, operation);
    articleMutationQueue.current = result.then(() => undefined, () => undefined);
    return result;
  }, []);

  // Load all data from Supabase / Railway on mount
  useEffect(() => {
    const load = async () => {
      setSyncStatus('loading');
      setInitialLoadError(null);
      let loaded = false;
      try {
        const [remoteArticles, remoteConfig, remoteFiles] = await Promise.all([
          db.fetchArticles(),
          db.fetchConfig(),
          db.fetchFiles(),
        ]);

        if (remoteArticles?.length) {
          setArticles(remoteArticles);
          setActiveId(remoteArticles[0].id);
        }
        if (remoteConfig) {
          setConfig(mergeWithLatestModelCatalog(remoteConfig));
          // Restore railwayUrl to localStorage for aiService
          if (remoteConfig.railwayUrl) {
            localStorage.setItem('writer:railwayUrl', remoteConfig.railwayUrl);
          }
        }
        if (remoteFiles?.length) setFiles(remoteFiles);
        loaded = true;
      } catch (error: unknown) {
        setInitialLoadError(error instanceof Error ? error.message : String(error));
        setSyncStatus('error');
      } finally {
        if (loaded) setSyncStatus('idle');
      }
    };
    load();
  }, []);

  const handleUpdateArticle = useCallback((id: string, updates: Partial<Article>) => {
    setArticles(prev => prev.map(a =>
      a.id === id ? { ...a, ...updates, updatedAt: new Date().toISOString() } : a
    ));
    setSyncStatus('saving');
    enqueueArticleMutation(() => db.updateArticle(id, updates))
      .then(() => setSyncStatus('idle'))
      .catch((error: unknown) => {
        setArticleActionError(`Không đồng bộ được bài viết với Supabase: ${error instanceof Error ? error.message : String(error)}`);
        setSyncStatus('error');
      });
  }, [enqueueArticleMutation]);

  const handleNewArticle = async () => {
    const newArt = createNewArticle();
    setArticleActionError(null);
    setSyncStatus('saving');
    try {
      const savedArticle = await enqueueArticleMutation(() => db.saveArticle(newArt));
      setArticles(prev => [savedArticle, ...prev.filter(item => item.id !== savedArticle.id)]);
      setActiveId(savedArticle.id);
      setSyncStatus('idle');
    } catch (error: unknown) {
      setArticleActionError(`Không tạo được bài viết trong Supabase: ${error instanceof Error ? error.message : String(error)}`);
      setSyncStatus('error');
    }
  };

  const handleToggleComplete = useCallback(async (target: Article) => {
    if (completionSavingId) return;
    const isDone = target.status === 'done';
    const updates: Partial<Article> = isDone
      ? { status: 'review', completedAt: null }
      : { status: 'done', currentStep: 4, completedAt: new Date().toISOString() };

    setArticleActionError(null);
    setCompletionSavingId(target.id);
    setSyncStatus('saving');
    try {
      const savedArticle = await enqueueArticleMutation(() => db.updateArticle(target.id, updates));
      setArticles(prev => prev.map(item => item.id === target.id ? savedArticle : item));
      setSyncStatus('idle');
    } catch (error: unknown) {
      setArticleActionError(`Không lưu được trạng thái bài viết vào Supabase: ${error instanceof Error ? error.message : String(error)}`);
      setSyncStatus('error');
    } finally {
      setCompletionSavingId(null);
    }
  }, [completionSavingId, enqueueArticleMutation]);

  const handleSaveConfig = async (newConfig: AppConfig, newFiles: DocumentFile[]) => {
    setConfig(newConfig);
    setFiles(newFiles);
    if (newConfig.railwayUrl) localStorage.setItem('writer:railwayUrl', newConfig.railwayUrl);
    setSyncStatus('saving');
    try {
      await Promise.all([db.saveConfig(newConfig), db.saveFiles(newFiles, newConfig.railwayUrl)]);
      setSyncStatus('idle');
    } catch {
      setSyncStatus('error');
    }
  };

  const article = activeId ? articles.find(a => a.id === activeId) ?? null : null;

  const handleStepChange = (step: number) => {
    if (!article) return;
    handleUpdateArticle(article.id, { currentStep: step });
  };

  const handleNext = () => {
    if (!article) return;
    const next = Math.min(article.currentStep + 1, 4);
    handleUpdateArticle(article.id, {
      currentStep: next,
      status: next === 4 ? 'review' : 'in_progress',
    });
  };

  const handlePrev = () => {
    if (!article) return;
    handleUpdateArticle(article.id, { currentStep: Math.max(article.currentStep - 1, 1) });
  };

  const stepCfg = article ? config.stepConfigs[article.currentStep] : null;
  const currentModel =
    (stepCfg?.modelId ? config.models.find(m => m.id === stepCfg.modelId && m.enabled) : null) ||
    config.models.find(m => m.enabled) ||
    undefined;

  // ── Loading screen ──
  if (syncStatus === 'loading') {
    return (
      <div className="h-screen flex items-center justify-center bg-[#f4f5f8]">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 rounded-2xl bg-slate-900 text-white flex items-center justify-center font-bold text-lg mx-auto">W</div>
          <div className="text-sm font-semibold text-slate-700">Đang tải Writer Studio...</div>
          <div className="w-40 h-1 bg-slate-200 rounded-full overflow-hidden mx-auto">
            <div className="h-full bg-slate-800 rounded-full w-3/5 animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  if (initialLoadError) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#f4f5f8] p-6">
        <div className="max-w-md w-full bg-white border border-red-200 rounded-3xl p-6 text-center shadow-sm space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center text-xl mx-auto">!</div>
          <div>
            <h1 className="text-base font-bold text-slate-800">Không tải được dữ liệu từ Railway / Supabase</h1>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              Ứng dụng đã khóa thao tác lưu để tránh ghi đè database bằng dữ liệu rỗng.
            </p>
          </div>
          <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2 text-[11px] text-red-700 font-mono break-words">
            {initialLoadError}
          </div>
          <button
            onClick={() => window.location.reload()}
            className="bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm py-2.5 px-5 rounded-xl transition-all"
          >
            Thử tải lại
          </button>
        </div>
      </div>
    );
  }

  // ── Empty state — no articles yet ──
  if (articles.length === 0) {
    return (
      <div className="h-screen flex overflow-hidden bg-[#f4f5f8]">
        <Sidebar
          articles={[]}
          activeArticleId={null}
          onSelectArticle={() => {}}
          onNewArticle={handleNewArticle}
          onOpenConfig={() => setShowConfig(true)}
          onToggleComplete={handleToggleComplete}
          completionSavingId={completionSavingId}
        />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-5 max-w-sm">
            <div className="w-14 h-14 rounded-3xl bg-slate-900 text-white flex items-center justify-center font-bold text-2xl mx-auto shadow-lg">W</div>
            <div className="space-y-1.5">
              <h1 className="text-lg font-bold text-slate-800">Chào mừng đến Writer Studio</h1>
              <p className="text-sm text-slate-500 leading-relaxed">
                Workspace AI cho quy trình sản xuất nội dung 4 bước.<br />
                Bắt đầu bằng cách tạo bài viết đầu tiên.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              {articleActionError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {articleActionError}
                </div>
              )}
              <button
                onClick={handleNewArticle}
                className="bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm py-3 px-6 rounded-2xl shadow-sm transition-all"
              >
                + Tạo bài viết đầu tiên
              </button>
              <button
                onClick={() => setShowConfig(true)}
                className="bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 font-semibold text-xs py-2.5 px-5 rounded-2xl transition-all"
              >
                Cấu hình AI Model & Knowledge Base
              </button>
            </div>
          </div>
        </div>
        {showConfig && (
          <ConfigModal config={config} files={files} onSave={handleSaveConfig} onClose={() => setShowConfig(false)} />
        )}
      </div>
    );
  }

  return (
    <div className="h-screen flex overflow-hidden bg-[#f4f5f8]">
      <Sidebar
        articles={articles}
        activeArticleId={activeId}
        onSelectArticle={id => setActiveId(id)}
        onNewArticle={handleNewArticle}
        onOpenConfig={() => setShowConfig(true)}
        onToggleComplete={handleToggleComplete}
        completionSavingId={completionSavingId}
      />

      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {articleActionError && (
          <div className="mx-5 mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 flex items-center justify-between gap-3">
            <span>{articleActionError}</span>
            <button type="button" onClick={() => setArticleActionError(null)} className="font-bold text-red-500 hover:text-red-700" aria-label="Đóng thông báo">×</button>
          </div>
        )}
        {article ? (
          <>
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
                  config={config}
                  files={files}
                  model={currentModel || config.models[0]}
                  railwayUrl={config.railwayUrl}
                  onUpdate={u => handleUpdateArticle(article.id, u)}
                  onNext={handleNext}
                />
              )}
              {article.currentStep === 2 && (
                <Step2CoreIdea
                  article={article}
                  config={config}
                  files={files}
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
                  config={config}
                  files={files}
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
                  config={config}
                  files={files}
                  model={currentModel || config.models[0]}
                  railwayUrl={config.railwayUrl}
                  onUpdate={u => handleUpdateArticle(article.id, u)}
                  onPrev={handlePrev}
                  onToggleComplete={() => handleToggleComplete(article)}
                  completionSaving={completionSavingId === article.id}
                />
              )}
            </main>
          </>
        ) : (
          // Article selected from sidebar but not found (shouldn't happen)
          <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
            Chọn bài viết từ danh sách bên trái
          </div>
        )}
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
