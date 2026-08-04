import { useState, useMemo } from 'react';
import type { Article, AIModel, AppConfig, DocumentFile } from '../../types';
import { callAI } from '../../lib/aiService';
import {
  collectStepDocs,
  buildDocContextBlock,
  buildRoleSystemPrompt,
  describeBundle,
} from '../../lib/docContext';

const TONES = [
  { id: 'professional', label: 'Chuyên nghiệp' },
  { id: 'friendly', label: 'Thân thiện' },
  { id: 'authoritative', label: 'Uy tín' },
  { id: 'conversational', label: 'Trò chuyện' },
  { id: 'educational', label: 'Giáo dục' },
  { id: 'persuasive', label: 'Thuyết phục' },
];

const ANGLES = [
  { id: 'informational', label: '📘 Thông tin' },
  { id: 'comparison', label: '⇄ So sánh' },
  { id: 'how-to', label: '🔧 Hướng dẫn' },
  { id: 'opinion', label: '💬 Quan điểm' },
  { id: 'data-driven', label: '📊 Dữ liệu' },
  { id: 'story', label: '📖 Câu chuyện' },
];

const WORD_COUNTS = [600, 1000, 1500, 2000, 3000];

interface Props {
  article: Article;
  config: AppConfig;
  files: DocumentFile[];
  model: AIModel;
  railwayUrl: string;
  onUpdate: (updates: Partial<Article>) => void;
  onNext: () => void;
  onPrev: () => void;
}

export default function Step2CoreIdea({ article, config, files, model, railwayUrl, onUpdate, onNext, onPrev }: Props) {
  const [loadingAngle, setLoadingAngle] = useState(false);
  const [suggestedAngle, setSuggestedAngle] = useState('');

  const bundle = useMemo(() => collectStepDocs(2, config, files), [config, files]);

  const handleSuggestAngle = async () => {
    if (!article.topic) return;
    setLoadingAngle(true);
    setSuggestedAngle('');
    try {
      const systemPrompt = buildRoleSystemPrompt(
        [
          'Đề xuất góc độ (angle) và từ khóa phụ để triển khai chủ đề người dùng cung cấp.',
          '- Dùng Knowledge Base làm căn cứ chuyên môn cho góc độ.',
          '- Đối chiếu Action Plan để đảm bảo góc độ nằm trong định hướng đã duyệt.',
          '- Tuân thủ Rules & Guidelines về tone, brand voice, cấu trúc bắt buộc.',
          '- Nếu tài liệu không đủ để đề xuất góc độ có căn cứ, nói rõ và gợi ý tài liệu còn thiếu.',
        ].join('\n'),
      );
      const userPrompt = [
        `TÀI LIỆU STEP 2 (${describeBundle(bundle)}):`,
        buildDocContextBlock(bundle),
        '',
        'THÔNG TIN BÀI VIẾT:',
        `- Chủ đề: "${article.topic}"`,
        `- Loại nội dung: ${article.contentType || '(chưa chọn)'}`,
        `- Từ khóa: ${article.keywords || '(chưa nhập)'}`,
        `- Độc giả: ${article.targetAudience || '(chưa nhập)'}`,
        '',
        'Yêu cầu: Đưa ra 1-2 góc độ tiếp cận độc đáo kèm giải thích ngắn, và danh sách từ khóa phụ.',
      ].join('\n');

      const res = await callAI({ model, railwayUrl, prompt: userPrompt, systemPrompt });
      setSuggestedAngle(res.content);
    } finally {
      setLoadingAngle(false);
    }
  };

  const isValid = article.topic && article.keywords && article.tone;

  return (
    <div className="h-full flex flex-col gap-4 animate-fade-in-up">
      <div className="bg-[#ebedf3] rounded-3xl p-1.5 shadow-sm border border-slate-200/60 flex-1 flex flex-col min-h-0">
        <div className="bg-white rounded-2xl p-6 flex-1 overflow-y-auto shadow-sm">
          <div className="max-w-3xl mx-auto space-y-6">
            <div>
              <h2 className="text-base font-bold text-slate-800 mb-1">Step 2: Core Idea & Angle</h2>
              <p className="text-xs text-slate-500">Xác định chủ đề cốt lõi, từ khóa mục tiêu và góc độ tiếp cận độc đáo.</p>
            </div>

            <div className="grid grid-cols-2 gap-5">
              {/* Topic */}
              <div className="col-span-2 space-y-1.5">
                <label className="text-xs font-bold text-slate-700">Chủ đề / Tiêu đề bài viết *</label>
                <input
                  value={article.topic || ''}
                  onChange={e => onUpdate({ topic: e.target.value })}
                  placeholder="Ví dụ: So sánh iPhone 15 Pro Max vs Samsung S24 Ultra — Flagship nào đáng mua năm 2026?"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-slate-800 transition-all placeholder:text-slate-400"
                />
              </div>

              {/* Keywords */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700">Từ khóa mục tiêu *</label>
                <textarea
                  value={article.keywords || ''}
                  onChange={e => onUpdate({ keywords: e.target.value })}
                  placeholder="Nhập từ khóa, cách nhau bởi dấu phẩy&#10;Ví dụ: iphone 15 pro max, so sánh điện thoại, flagship 2026"
                  rows={3}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-slate-800 transition-all placeholder:text-slate-400 resize-none"
                />
              </div>

              {/* Audience */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700">Đối tượng độc giả</label>
                <textarea
                  value={article.targetAudience || ''}
                  onChange={e => onUpdate({ targetAudience: e.target.value })}
                  placeholder="Ví dụ: Người dùng smartphone trung cấp và cao cấp, 22-40 tuổi, quan tâm đến công nghệ."
                  rows={3}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-slate-800 transition-all placeholder:text-slate-400 resize-none"
                />
              </div>

              {/* Angle */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700">Góc độ tiếp cận</label>
                <div className="grid grid-cols-3 gap-2">
                  {ANGLES.map(a => (
                    <button
                      key={a.id}
                      onClick={() => onUpdate({ angle: a.id })}
                      className={`py-1.5 px-2 text-[11px] font-semibold rounded-xl border transition-all ${
                        article.angle === a.id
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-slate-400'
                      }`}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tone */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700">Giọng văn *</label>
                <div className="grid grid-cols-3 gap-2">
                  {TONES.map(t => (
                    <button
                      key={t.id}
                      onClick={() => onUpdate({ tone: t.id })}
                      className={`py-1.5 px-2 text-[11px] font-semibold rounded-xl border transition-all ${
                        article.tone === t.id
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-slate-400'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Word count */}
              <div className="col-span-2 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-700">Số từ mục tiêu</label>
                  <span className="text-xs font-mono font-bold text-slate-600">{article.wordCount || 1500} từ</span>
                </div>
                <div className="flex gap-2">
                  {WORD_COUNTS.map(wc => (
                    <button
                      key={wc}
                      onClick={() => onUpdate({ wordCount: wc })}
                      className={`flex-1 py-1.5 text-[11px] font-semibold rounded-xl border transition-all ${
                        (article.wordCount || 1500) === wc
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-slate-400'
                      }`}
                    >
                      {wc >= 1000 ? `${wc/1000}K` : wc}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* AI Angle Suggestion */}
            <div className="bg-indigo-50/60 border border-indigo-100 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-slate-800">Gợi ý góc độ từ AI</h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">Sử dụng {model.name} để đề xuất góc tiếp cận độc đáo</p>
                </div>
                <button
                  onClick={handleSuggestAngle}
                  disabled={!article.topic || loadingAngle}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold px-4 py-2 rounded-xl transition-all"
                >
                  {loadingAngle ? 'Đang phân tích...' : '✨ Gợi ý'}
                </button>
              </div>
              {loadingAngle && (
                <div className="space-y-2">
                  <div className="ai-loading h-3 w-full" />
                  <div className="ai-loading h-3 w-4/5" />
                  <div className="ai-loading h-3 w-3/5" />
                </div>
              )}
              {suggestedAngle && !loadingAngle && (
                <div className="text-xs text-slate-700 leading-relaxed whitespace-pre-line bg-white rounded-xl p-3 border border-indigo-100">
                  {suggestedAngle}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-between shrink-0">
        <button onClick={onPrev} className="bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-semibold text-xs py-2.5 px-5 rounded-2xl shadow-sm transition-all">
          ← Quay lại
        </button>
        <button
          onClick={onNext}
          disabled={!isValid}
          className="bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-xs py-2.5 px-6 rounded-2xl shadow-sm transition-all flex items-center space-x-2"
        >
          <span>Tiếp tục → Draft Outline</span>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </button>
      </div>
    </div>
  );
}
