import { useState, useMemo } from 'react';
import type { Article, AIModel, AppConfig, DocumentFile, OutlineSection } from '../../types';
import { callAI } from '../../lib/aiService';
import {
  collectStepDocs,
  buildDocContextBlock,
  buildRoleSystemPrompt,
  describeBundle,
} from '../../lib/docContext';

function generateId() {
  return Math.random().toString(36).slice(2, 9);
}

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

export default function Step3Outline({ article, config, files, model, railwayUrl, onUpdate, onNext, onPrev }: Props) {
  const [generating, setGenerating] = useState(false);
  const outline = article.outline || [];

  const bundle = useMemo(() => collectStepDocs(3, config, files), [config, files]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const systemPrompt = buildRoleSystemPrompt(
        [
          'Tạo dàn bài (outline) chi tiết dựa trên tài liệu được cấp và thông tin bài viết.',
          '- Knowledge Base cung cấp nội dung/luận điểm cho từng mục.',
          '- Action Plan xác định cấu trúc mẫu và các mục bắt buộc phải có.',
          '- Rules & Guidelines quyết định định dạng heading, độ sâu H2/H3, quy tắc đặt tiêu đề.',
          '- Chỉ trả về dàn bài dạng markdown với heading H2 (## ) và H3 (### ). Không viết đoạn văn.',
        ].join('\n'),
      );
      const userPrompt = [
        `TÀI LIỆU STEP 3 (${describeBundle(bundle)}):`,
        buildDocContextBlock(bundle),
        '',
        'THÔNG TIN BÀI VIẾT:',
        `- Chủ đề: "${article.topic}"`,
        `- Góc độ: ${article.angle || '(chưa chọn)'}`,
        `- Giọng văn: ${article.tone || '(chưa chọn)'}`,
        `- Số từ mục tiêu: ${article.wordCount || 1500}`,
        `- Từ khóa: ${article.keywords || ''}`,
        '',
        'Yêu cầu: Trả về dàn bài markdown, các mục H2/H3 rõ ràng, mỗi mục có 1 dòng ghi chú ngắn về nội dung.',
      ].join('\n');

      const res = await callAI({ model, railwayUrl, prompt: userPrompt, systemPrompt });

      // Parse the outline text into structured sections
      const lines = res.content.split('\n').filter((l: string) => l.trim());
      const sections: OutlineSection[] = [];
      lines.forEach((line: string) => {
        const h2Match = line.match(/^#{1,2}\s+(.+)|^\*{2}([IVX\d]+\.?\s+.+)\*{2}|^[IVX\d]+\.\s+(.+)/);
        const h3Match = line.match(/^#{3}\s+(.+)|^[-–]\s+(.+)|^\s+-\s+(.+)/);
        if (h2Match) {
          const heading = (h2Match[1] || h2Match[2] || h2Match[3] || '').trim();
          if (heading) sections.push({ id: generateId(), heading, notes: '', level: 'h2' });
        } else if (h3Match) {
          const heading = (h3Match[1] || h3Match[2] || h3Match[3] || '').trim();
          if (heading && sections.length > 0) sections.push({ id: generateId(), heading, notes: '', level: 'h3' });
        }
      });

      onUpdate({ outline: sections.length > 0 ? sections : [
        { id: generateId(), heading: 'Giới thiệu tổng quan', notes: '', level: 'h2' },
        { id: generateId(), heading: 'Phân tích chi tiết', notes: '', level: 'h2' },
        { id: generateId(), heading: 'Ưu điểm & Nhược điểm', notes: '', level: 'h2' },
        { id: generateId(), heading: 'Kết luận & Khuyến nghị', notes: '', level: 'h2' },
      ] });
    } finally {
      setGenerating(false);
    }
  };

  const updateSection = (id: string, field: keyof OutlineSection, value: string) => {
    onUpdate({
      outline: outline.map(s => s.id === id ? { ...s, [field]: value } : s),
    });
  };

  const removeSection = (id: string) => {
    onUpdate({ outline: outline.filter(s => s.id !== id) });
  };

  const addSection = (level: 'h2' | 'h3') => {
    onUpdate({ outline: [...outline, { id: generateId(), heading: '', notes: '', level }] });
  };

  const moveSection = (id: string, dir: -1 | 1) => {
    const idx = outline.findIndex(s => s.id === id);
    if (idx + dir < 0 || idx + dir >= outline.length) return;
    const next = [...outline];
    [next[idx], next[idx + dir]] = [next[idx + dir], next[idx]];
    onUpdate({ outline: next });
  };

  return (
    <div className="h-full flex flex-col gap-4 animate-fade-in-up">
      <div className="bg-[#ebedf3] rounded-3xl p-1.5 shadow-sm border border-slate-200/60 flex-1 flex flex-col min-h-0">
        <div className="bg-white rounded-2xl p-6 flex-1 overflow-y-auto shadow-sm">
          <div className="max-w-3xl mx-auto space-y-5">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-800 mb-1">Step 3: Draft Outline</h2>
                <p className="text-xs text-slate-500">Xây dựng cấu trúc bài viết. Có thể chỉnh sửa, thêm, xóa hoặc sắp xếp lại các mục.</p>
              </div>
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-xs font-bold px-4 py-2 rounded-xl transition-all flex items-center space-x-2 shrink-0"
              >
                {generating ? (
                  <>
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <span>AI đang tạo...</span>
                  </>
                ) : (
                  <>
                    <span>✨</span>
                    <span>{outline.length > 0 ? 'Tạo lại' : 'AI Tạo Outline'}</span>
                  </>
                )}
              </button>
            </div>

            {generating && (
              <div className="space-y-3">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="space-y-2">
                    <div className="ai-loading h-4 w-1/3" />
                    <div className="ai-loading h-3 w-2/3 ml-4" />
                  </div>
                ))}
              </div>
            )}

            {!generating && outline.length === 0 && (
              <div className="border-2 border-dashed border-slate-200 rounded-2xl p-10 text-center">
                <div className="text-3xl mb-3">📄</div>
                <p className="text-sm font-semibold text-slate-600">Chưa có outline</p>
                <p className="text-xs text-slate-400 mt-1">Nhấn "AI Tạo Outline" hoặc thêm mục thủ công bên dưới</p>
              </div>
            )}

            {!generating && outline.length > 0 && (
              <div className="space-y-2">
                {outline.map((section, idx) => (
                  <div
                    key={section.id}
                    className={`group flex items-start gap-3 p-3 rounded-xl border transition-all ${
                      section.level === 'h2'
                        ? 'bg-slate-50 border-slate-200'
                        : 'bg-white border-slate-100 ml-6'
                    }`}
                  >
                    {/* Order controls */}
                    <div className="flex flex-col gap-0.5 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => moveSection(section.id, -1)} className="w-4 h-4 flex items-center justify-center text-slate-400 hover:text-slate-700">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                      </button>
                      <button onClick={() => moveSection(section.id, 1)} className="w-4 h-4 flex items-center justify-center text-slate-400 hover:text-slate-700">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                      </button>
                    </div>

                    <div className="flex-1 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${section.level === 'h2' ? 'bg-slate-800 text-white' : 'bg-slate-200 text-slate-600'}`}>
                          {section.level.toUpperCase()}
                        </span>
                        <input
                          value={section.heading}
                          onChange={e => updateSection(section.id, 'heading', e.target.value)}
                          placeholder="Tiêu đề mục..."
                          className={`flex-1 bg-transparent outline-none text-slate-800 placeholder:text-slate-300 ${section.level === 'h2' ? 'text-sm font-bold' : 'text-xs font-semibold'}`}
                        />
                      </div>
                      <input
                        value={section.notes}
                        onChange={e => updateSection(section.id, 'notes', e.target.value)}
                        placeholder="Ghi chú nội dung, từ khóa, dữ liệu cần đề cập..."
                        className="w-full bg-transparent text-[11px] text-slate-500 outline-none placeholder:text-slate-300"
                      />
                    </div>

                    <button
                      onClick={() => removeSection(section.id)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-300 hover:text-red-400 mt-1"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add section buttons */}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => addSection('h2')}
                className="flex-1 py-2 border-2 border-dashed border-slate-300 hover:border-slate-500 text-slate-400 hover:text-slate-600 text-xs font-semibold rounded-xl transition-all"
              >
                + Thêm mục H2
              </button>
              <button
                onClick={() => addSection('h3')}
                className="flex-1 py-2 border-2 border-dashed border-slate-200 hover:border-slate-400 text-slate-300 hover:text-slate-500 text-xs font-semibold rounded-xl transition-all"
              >
                + Thêm mục H3
              </button>
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
          disabled={outline.length === 0}
          className="bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-xs py-2.5 px-6 rounded-2xl shadow-sm transition-all flex items-center space-x-2"
        >
          <span>Tiếp tục → First Draft</span>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </button>
      </div>
    </div>
  );
}
