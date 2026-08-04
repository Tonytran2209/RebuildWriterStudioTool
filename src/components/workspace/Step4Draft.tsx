import { useState, useMemo, useRef } from 'react';
import type { Article, AIModel, AppConfig, DocumentFile } from '../../types';
import { callAI } from '../../lib/aiService';
import {
  collectStepDocs,
  buildDocContextBlock,
  buildRoleSystemPrompt,
  describeBundle,
} from '../../lib/docContext';

function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function calcReadability(text: string) {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 3);
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!sentences.length || !words.length) return null;
  const avgWordsPerSentence = words.length / sentences.length;
  if (avgWordsPerSentence < 15) return { label: 'Rất dễ đọc', score: 95, color: 'text-emerald-600' };
  if (avgWordsPerSentence < 20) return { label: 'Dễ đọc', score: 80, color: 'text-emerald-500' };
  if (avgWordsPerSentence < 25) return { label: 'Trung bình', score: 65, color: 'text-amber-500' };
  return { label: 'Khó đọc', score: 40, color: 'text-red-500' };
}

interface Props {
  article: Article;
  config: AppConfig;
  files: DocumentFile[];
  model: AIModel;
  railwayUrl: string;
  onUpdate: (updates: Partial<Article>) => void;
  onPrev: () => void;
}

export default function Step4Draft({ article, config, files, model, railwayUrl, onUpdate, onPrev }: Props) {
  const bundle = useMemo(() => collectStepDocs(4, config, files), [config, files]);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);

  const draft = article.draft || '';
  const wordCount = countWords(draft);
  const targetWords = article.wordCount || 1500;
  const readability = calcReadability(draft);
  const progress = Math.min(Math.round((wordCount / targetWords) * 100), 100);

  // Keyword density check
  const keywordList = (article.keywords || '').split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
  const draftLower = draft.toLowerCase();
  const keywordStats = keywordList.slice(0, 4).map(kw => ({
    keyword: kw,
    count: (draftLower.match(new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length,
    density: draft ? `${(((draftLower.match(new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length / Math.max(wordCount, 1)) * 100).toFixed(1)}%` : '0%',
  }));

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const outlineText = (article.outline || [])
        .map(s => `${s.level === 'h2' ? '## ' : '### '}${s.heading}${s.notes ? ` (${s.notes})` : ''}`)
        .join('\n');

      const systemPrompt = buildRoleSystemPrompt(
        [
          'Viết bài hoàn chỉnh theo dàn bài và tài liệu được cấp.',
          '- Knowledge Base là nguồn dữ liệu duy nhất cho số liệu, dẫn chứng, thông tin sản phẩm. KHÔNG bịa dữ liệu.',
          '- Action Plan xác định định hướng nội dung và các mục bắt buộc.',
          '- Rules & Guidelines quyết định tone of voice, từ ngữ cấm, cấu trúc câu, quy tắc SEO. PHẢI tuân thủ tuyệt đối.',
          '- Khi dùng thông tin từ KB, nêu tự nhiên trong văn bản (không cần footnote).',
          '- Nếu KB không có dữ liệu cho một mục, viết mục đó ở dạng khung và ghi chú "[Cần bổ sung dữ liệu]".',
        ].join('\n'),
      );
      const userPrompt = [
        `TÀI LIỆU STEP 4 (${describeBundle(bundle)}):`,
        buildDocContextBlock(bundle),
        '',
        'THÔNG TIN BÀI VIẾT:',
        `- Chủ đề: "${article.topic}"`,
        `- Giọng văn: ${article.tone || ''}`,
        `- Từ khóa: ${article.keywords || ''}`,
        `- Số từ mục tiêu: ~${targetWords}`,
        '',
        'DÀN BÀI:',
        outlineText,
        '',
        'Yêu cầu: Viết bài hoàn chỉnh theo dàn bài trên, tuân thủ toàn bộ Rules & Guidelines.',
      ].join('\n');

      const res = await callAI({ model, railwayUrl, prompt: userPrompt, systemPrompt });
      onUpdate({ draft: res.content });
      if (editorRef.current) editorRef.current.innerText = res.content;
    } finally {
      setGenerating(false);
    }
  };

  const handleEditorInput = () => {
    if (editorRef.current) {
      onUpdate({ draft: editorRef.current.innerText });
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(draft);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="h-full flex flex-col gap-4 animate-fade-in-up">
      <div className="bg-[#ebedf3] rounded-3xl p-1.5 shadow-sm border border-slate-200/60 flex-1 flex flex-col min-h-0">
        <div className="flex-1 flex gap-3 p-3 min-h-0">

          {/* Editor panel */}
          <div className="flex-1 bg-white rounded-2xl flex flex-col shadow-sm min-w-0">
            {/* Editor toolbar */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
              <div>
                <h2 className="text-sm font-bold text-slate-800">Step 4: First Draft & Audit</h2>
                <p className="text-[10px] text-slate-400">{article.title || 'Bài viết mới'}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-xs font-bold px-3 py-1.5 rounded-xl transition-all flex items-center space-x-1.5"
                >
                  {generating ? (
                    <>
                      <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                      <span>Đang viết...</span>
                    </>
                  ) : <><span>✨</span><span>{draft ? 'Viết lại' : 'AI Viết Draft'}</span></>}
                </button>
                <button
                  onClick={handleCopy}
                  disabled={!draft}
                  className="bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-700 text-xs font-semibold px-3 py-1.5 rounded-xl transition-all"
                >
                  {copied ? '✓ Đã copy' : 'Copy'}
                </button>
              </div>
            </div>

            {/* Draft editor */}
            <div className="flex-1 overflow-y-auto p-5">
              {generating ? (
                <div className="space-y-3">
                  {[...Array(12)].map((_, i) => (
                    <div key={i} className="ai-loading h-4" style={{ width: `${60 + Math.random() * 40}%` }} />
                  ))}
                </div>
              ) : (
                <div
                  ref={editorRef}
                  contentEditable
                  suppressContentEditableWarning
                  onInput={handleEditorInput}
                  data-placeholder="Nhấn 'AI Viết Draft' để tạo nội dung, hoặc bắt đầu viết thủ công..."
                  className="prose-editor min-h-full whitespace-pre-wrap"
                >
                  {draft || ''}
                </div>
              )}
            </div>

            {/* Word count bar */}
            <div className="px-5 py-2.5 border-t border-slate-100">
              <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1.5">
                <span className="font-mono font-semibold">{wordCount.toLocaleString()} / {targetWords.toLocaleString()} từ</span>
                <span>{progress}% hoàn thành</span>
              </div>
              <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${progress >= 100 ? 'bg-emerald-500' : progress >= 70 ? 'bg-blue-500' : 'bg-amber-400'}`}
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          </div>

          {/* Audit panel */}
          <div className="w-60 flex flex-col gap-3 shrink-0">
            {/* Readability */}
            <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
              <h3 className="text-xs font-bold text-slate-800">Phân tích nội dung</h3>
              <div className="space-y-2.5">
                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-slate-500 font-medium">Độ dễ đọc</span>
                    <span className={`font-bold ${readability?.color || 'text-slate-400'}`}>{readability?.label || '—'}</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${readability?.score || 0}%` }} />
                  </div>
                </div>

                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-500">Số từ</span>
                  <span className="font-mono font-bold text-slate-700">{wordCount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-500">Số đoạn</span>
                  <span className="font-mono font-bold text-slate-700">{draft.split('\n\n').filter(p => p.trim()).length}</span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-500">Số ký tự</span>
                  <span className="font-mono font-bold text-slate-700">{draft.length.toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* SEO Checklist */}
            <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
              <h3 className="text-xs font-bold text-slate-800">SEO Checklist</h3>
              <div className="space-y-2">
                {[
                  { label: 'Tiêu đề có từ khóa', pass: article.topic ? keywordList.some(k => article.topic!.toLowerCase().includes(k)) : false },
                  { label: 'Độ dài >= 800 từ', pass: wordCount >= 800 },
                  { label: 'Độ dài >= mục tiêu', pass: wordCount >= targetWords * 0.9 },
                  { label: 'Có headings (H2/H3)', pass: draft.includes('##') || (article.outline || []).length > 0 },
                  { label: 'Từ khóa xuất hiện trong bài', pass: keywordList.some(k => draftLower.includes(k)) },
                ].map(item => (
                  <div key={item.label} className="flex items-center gap-2">
                    <div className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${item.pass ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                      <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d={item.pass ? 'M5 13l4 4L19 7' : 'M6 18L18 6M6 6l12 12'} />
                      </svg>
                    </div>
                    <span className={`text-[11px] ${item.pass ? 'text-slate-700' : 'text-slate-400'}`}>{item.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Keyword density */}
            {keywordStats.length > 0 && (
              <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
                <h3 className="text-xs font-bold text-slate-800">Mật độ từ khóa</h3>
                <div className="space-y-2">
                  {keywordStats.map(kw => (
                    <div key={kw.keyword}>
                      <div className="flex justify-between text-[11px] mb-0.5">
                        <span className="text-slate-600 font-medium truncate max-w-[120px]">{kw.keyword}</span>
                        <span className="font-mono text-slate-700 font-bold">{kw.density}</span>
                      </div>
                      <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-indigo-400 rounded-full"
                          style={{ width: `${Math.min(parseFloat(kw.density) * 20, 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Export */}
            <div className="bg-white rounded-2xl p-4 shadow-sm space-y-2">
              <h3 className="text-xs font-bold text-slate-800">Xuất bài viết</h3>
              <button
                onClick={handleCopy}
                disabled={!draft}
                className="w-full py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white text-xs font-semibold rounded-xl transition-all"
              >
                {copied ? '✓ Đã copy' : 'Copy toàn bộ nội dung'}
              </button>
              <button
                disabled={!draft}
                onClick={() => {
                  const blob = new Blob([draft], { type: 'text/plain' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${(article.title || 'bai-viet').replace(/\s+/g, '-')}.txt`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="w-full py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-700 text-xs font-semibold rounded-xl transition-all"
              >
                Tải xuống .txt
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-between shrink-0">
        <button onClick={onPrev} className="bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-semibold text-xs py-2.5 px-5 rounded-2xl shadow-sm transition-all">
          ← Quay lại Outline
        </button>
        <button
          disabled={!draft}
          className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-xs py-2.5 px-6 rounded-2xl shadow-sm transition-all"
        >
          ✓ Đánh dấu hoàn thành
        </button>
      </div>
    </div>
  );
}
