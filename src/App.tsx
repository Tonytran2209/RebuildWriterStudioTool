import { useState, useEffect, useCallback, useRef } from 'react';
import type { AICallUsage, Article, AppConfig, ContentPlanItem, DocumentFile } from './types';
import { DEFAULT_CONFIG, mergeWithLatestModelCatalog } from './lib/defaultData';
import * as db from './lib/db';
import Sidebar from './components/Sidebar';
import StepNav from './components/StepNav';
import ConfigModal from './components/config/ConfigModal';
import Step1ContentType from './components/workspace/Step1ContentType';
import Step2CoreIdea from './components/workspace/Step2CoreIdea';
import Step3Outline from './components/workspace/Step3Outline';
import Step4Draft from './components/workspace/Step4Draft';
import { useI18n } from './lib/i18n';
import ActivityLauncher from './components/ActivityLauncher';
import BatchActivity from './components/BatchActivity';

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
  const { tr } = useI18n();
  const [articles, setArticles] = useState<Article[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [files, setFiles] = useState<DocumentFile[]>([]);
  const [showConfig, setShowConfig] = useState(false);
  const [showBatchOverview, setShowBatchOverview] = useState(true);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('loading');
  const [initialLoadError, setInitialLoadError] = useState<string | null>(null);
  const [articleActionError, setArticleActionError] = useState<string | null>(null);
  const [completionSavingId, setCompletionSavingId] = useState<string | null>(null);
  const [deletingArticleId, setDeletingArticleId] = useState<string | null>(null);
  const articleMutationQueue = useRef<Promise<void>>(Promise.resolve());
  const articlesRef = useRef<Article[]>([]);
  const activeIdRef = useRef<string | null>(null);
  articlesRef.current = articles;
  activeIdRef.current = activeId;

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
    return enqueueArticleMutation(() => db.updateArticle(id, updates))
      .then(() => { setSyncStatus('idle'); return true; })
      .catch((error: unknown) => {
        setArticleActionError(`Không đồng bộ được bài viết với Supabase: ${error instanceof Error ? error.message : String(error)}`);
        setSyncStatus('error');
        return false;
      });
  }, [enqueueArticleMutation]);

  useEffect(() => {
    const recordUsage = (event: Event) => {
      const usage = (event as CustomEvent<AICallUsage>).detail;
      const articleId = activeIdRef.current;
      const current = articlesRef.current.find(item => item.id === articleId);
      if (!articleId || !current || !usage) return;
      try {
        const summary = JSON.parse(localStorage.getItem('writer:usage-summary') ?? '{}') as Record<string, AICallUsage[]>;
        summary[String(usage.step)] = [...(summary[String(usage.step)] ?? []), usage].slice(-500);
        localStorage.setItem('writer:usage-summary', JSON.stringify(summary));
      } catch { /* usage persistence in the article remains authoritative */ }
      const previous = current.aiUsageByStep?.[usage.step] ?? [];
      const aiUsageByStep = {
        ...current.aiUsageByStep,
        [usage.step]: [...previous, usage].slice(-50),
      };
      const updated = articlesRef.current.map(item => item.id === articleId
        ? { ...item, aiUsageByStep, updatedAt: new Date().toISOString() }
        : item);
      articlesRef.current = updated;
      setArticles(updated);
      enqueueArticleMutation(() => db.updateArticle(articleId, { aiUsageByStep }))
        .catch((error: unknown) => {
          setArticleActionError(`Không lưu được usage AI: ${error instanceof Error ? error.message : String(error)}`);
          setSyncStatus('error');
        });
    };
    window.addEventListener('writer:ai-usage', recordUsage);
    return () => window.removeEventListener('writer:ai-usage', recordUsage);
  }, [enqueueArticleMutation]);

  const handleCreateActivity = async (type: ContentPlanItem['type'], plan: string, items: ContentPlanItem[], batchSize?: 5 | 10 | 15 | 20) => {
    const activityId = `activity-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setArticleActionError(null);
    setSyncStatus('saving');
    try {
      const records = items.map((item, index): Article => {
        const snapshot = {
          id: item.id, label: item.title, description: item.sourceLine, keywords: item.keywords,
          typeGroup: (type === 'comparison-seo' ? 'A' : 'C') as const, wave: 'Current activity', timeframe: new Date().toISOString().slice(0, 10),
          actionPlanEvidence: item.sourceLine, scheduleEvidence: item.sourceLine,
        };
        return ({
        ...createNewArticle(),
        id: `art-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`,
        title: item.title,
        topic: item.title,
        keywords: item.keywords.join(', '),
        activityType: type,
        activityKind: type === 'comparison-seo' ? 'batch' : 'single',
        activityId,
        contentPlanInput: plan,
        contentPlanItemId: item.id,
        batchSize,
        batchStatus: type === 'comparison-seo' ? 'queued' : undefined,
        contentType: type === 'comparison-seo' ? 'Comparison / SEO' : 'Editorial / Originality',
        selectedContentTypeSuggestionId: item.id,
        selectedContentTypeSnapshot: snapshot,
        contentTypeSuggestions: [snapshot],
        currentStep: type === 'comparison-seo' ? 2 : 1,
      }); });
      const saved: Article[] = [];
      for (const record of records) saved.push(await enqueueArticleMutation(() => db.saveArticle(record)));
      setArticles(current => [...saved, ...current]);
      setActiveId(saved[0]?.id ?? null);
      setShowBatchOverview(type === 'comparison-seo');
      if (type === 'comparison-seo') await db.startBatch(activityId);
      setSyncStatus('idle');
    } catch (error: unknown) {
      setArticleActionError(`Không tạo được activity trong Supabase: ${error instanceof Error ? error.message : String(error)}`);
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

  const handleDeleteArticle = useCallback(async (target: Article) => {
    if (deletingArticleId) return;
    const targets = target.activityType === 'comparison-seo' && target.activityId
      ? articles.filter(item => item.activityId === target.activityId)
      : [target];
    const confirmed = window.confirm(targets.length > 1
      ? `Xoá vĩnh viễn batch gồm ${targets.length} bài khỏi Supabase? Thao tác này không thể hoàn tác.`
      : `Xoá vĩnh viễn bài viết “${target.title}” khỏi Supabase? Thao tác này không thể hoàn tác.`);
    if (!confirmed) return;

    setArticleActionError(null);
    setDeletingArticleId(target.id);
    setSyncStatus('saving');
    try {
      // Finish any content save already queued before deleting the database record.
      await articleMutationQueue.current;
      for (const item of targets) await db.deleteArticle(item.id);
      const targetIds = new Set(targets.map(item => item.id));
      const remaining = articles.filter(item => !targetIds.has(item.id));
      setArticles(remaining);
      if (activeId && targetIds.has(activeId)) setActiveId(remaining[0]?.id ?? null);
      setSyncStatus('idle');
    } catch (error: unknown) {
      setArticleActionError(`Không xoá được bài viết khỏi Supabase: ${error instanceof Error ? error.message : String(error)}`);
      setSyncStatus('error');
    } finally {
      setDeletingArticleId(null);
    }
  }, [activeId, articles, deletingArticleId]);

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

  useEffect(() => {
    const activityId = article?.activityType === 'comparison-seo' ? article.activityId : null;
    if (!activityId) return;
    let stopped = false;
    const refresh = async () => {
      try {
        const result = await db.fetchBatch(activityId);
        if (stopped) return;
        setArticles(current => {
          const remoteIds = new Set(result.articles.map(item => item.id));
          return [...result.articles, ...current.filter(item => !remoteIds.has(item.id))];
        });
      } catch { /* retain the last durable snapshot while Railway reconnects */ }
    };
    refresh();
    const timer = window.setInterval(refresh, 4000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [article?.activityId, article?.activityType]);

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
      <div className="h-dvh flex items-center justify-center bg-[#f4f5f8]">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 rounded-2xl bg-slate-900 text-white flex items-center justify-center font-bold text-lg mx-auto">W</div>
          <div className="text-sm font-semibold text-slate-700">{tr('Đang tải Writer Studio...', 'Loading Writer Studio...')}</div>
          <div className="w-40 h-1 bg-slate-200 rounded-full overflow-hidden mx-auto">
            <div className="h-full bg-slate-800 rounded-full w-3/5 animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  if (initialLoadError) {
    return (
      <div className="h-dvh flex items-center justify-center bg-[#f4f5f8] p-4 sm:p-6">
        <div className="max-w-md w-full bg-white border border-red-200 rounded-3xl p-6 text-center shadow-sm space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center text-xl mx-auto">!</div>
          <div>
            <h1 className="text-base font-bold text-slate-800">{tr('Không tải được dữ liệu từ Railway / Supabase', 'Could not load data from Railway / Supabase')}</h1>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              {tr('Ứng dụng đã khóa thao tác lưu để tránh ghi đè database bằng dữ liệu rỗng.', 'Saving is locked to prevent overwriting the database with empty data.')}
            </p>
          </div>
          <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2 text-[11px] text-red-700 font-mono break-words">
            {initialLoadError}
          </div>
          <button
            onClick={() => window.location.reload()}
            className="bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm py-2.5 px-5 rounded-xl transition-all"
          >
            {tr('Thử tải lại', 'Try again')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-dvh flex flex-col md:flex-row overflow-hidden bg-[#f4f5f8]">
      <Sidebar
        articles={articles}
        activeArticleId={activeId}
        onSelectArticle={id => { setActiveId(id); setShowBatchOverview(true); }}
        onNewArticle={() => { setActiveId(null); setShowBatchOverview(true); }}
        onOpenConfig={() => setShowConfig(true)}
        onToggleComplete={handleToggleComplete}
        completionSavingId={completionSavingId}
        onDeleteArticle={handleDeleteArticle}
        deletingArticleId={deletingArticleId}
      />

      <div className="flex-1 min-h-0 flex flex-col h-full overflow-hidden">
        {articleActionError && (
          <div className="mx-2 md:mx-5 mt-2 md:mt-3 rounded-xl border border-red-200 bg-red-50 px-3 md:px-4 py-2 text-xs text-red-700 flex items-center justify-between gap-3">
            <span>{articleActionError}</span>
            <button type="button" onClick={() => setArticleActionError(null)} className="font-bold text-red-500 hover:text-red-700" aria-label="Đóng thông báo">×</button>
          </div>
        )}
        {article?.activityType === 'comparison-seo' && showBatchOverview ? (
          <BatchActivity
            articles={articles.filter(item => item.activityId === article.activityId)}
            onOpen={id => { setActiveId(id); setShowBatchOverview(false); }}
            onStart={() => article.activityId ? db.startBatch(article.activityId) : Promise.resolve()}
            onPause={() => article.activityId ? db.pauseBatch(article.activityId) : Promise.resolve()}
            onRetry={id => article.activityId ? db.retryBatchArticle(article.activityId, id) : Promise.resolve()}
          />
        ) : article ? (
          <>
            <StepNav
              currentStep={article.currentStep}
              onStepChange={handleStepChange}
              currentModel={currentModel}
              syncStatus={syncStatus}
              usage={article.aiUsageByStep?.[article.currentStep as 1 | 2 | 3 | 4] ?? []}
            />
            <main className="flex-1 min-h-0 overflow-hidden p-2.5 md:p-5">
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
          <ActivityLauncher onCreate={handleCreateActivity} onOpenConfig={() => setShowConfig(true)} />
        )}
      </div>

      {showConfig && (
        <ConfigModal
          config={config}
          files={files}
          articles={articles}
          onSave={handleSaveConfig}
          onClose={() => setShowConfig(false)}
        />
      )}
    </div>
  );
}
