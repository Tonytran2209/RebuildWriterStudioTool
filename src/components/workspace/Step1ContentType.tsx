import type { Article } from '../../types';

const CONTENT_TYPES = [
  { id: 'comparison', label: 'So sánh sản phẩm', description: 'Phân tích điểm mạnh/yếu giữa 2-3 sản phẩm cùng phân khúc.', icon: '⇄', color: 'border-violet-200 hover:border-violet-400 bg-violet-50/40' },
  { id: 'review', label: 'Review sản phẩm', description: 'Đánh giá chi tiết một sản phẩm theo tiêu chí cụ thể.', icon: '★', color: 'border-amber-200 hover:border-amber-400 bg-amber-50/40' },
  { id: 'seo-blog', label: 'Bài blog SEO', description: 'Nội dung tối ưu từ khóa, đáp ứng search intent người dùng.', icon: '◎', color: 'border-blue-200 hover:border-blue-400 bg-blue-50/40' },
  { id: 'news', label: 'Tin tức ngành', description: 'Cập nhật xu hướng, sự kiện và phân tích ngành nghề.', icon: '▶', color: 'border-slate-200 hover:border-slate-400 bg-slate-50' },
  { id: 'case-study', label: 'Case Study', description: 'Câu chuyện khách hàng thực tế và kết quả đo lường được.', icon: '◈', color: 'border-emerald-200 hover:border-emerald-400 bg-emerald-50/40' },
  { id: 'email', label: 'Email Marketing', description: 'Chuỗi email nurture, newsletter hoặc campaign promotion.', icon: '✉', color: 'border-pink-200 hover:border-pink-400 bg-pink-50/40' },
  { id: 'social', label: 'Social Media', description: 'Nội dung Facebook, LinkedIn, TikTok ngắn gọn, viral.', icon: '◉', color: 'border-orange-200 hover:border-orange-400 bg-orange-50/40' },
  { id: 'landing', label: 'Landing Page Copy', description: 'Copywriting trang đích tối ưu chuyển đổi và CTA.', icon: '⬡', color: 'border-teal-200 hover:border-teal-400 bg-teal-50/40' },
];

interface Props {
  article: Article;
  onUpdate: (updates: Partial<Article>) => void;
  onNext: () => void;
}

export default function Step1ContentType({ article, onUpdate, onNext }: Props) {
  const selected = article.contentType;

  return (
    <div className="h-full flex flex-col gap-4 animate-fade-in-up">
      <div className="bg-[#ebedf3] rounded-3xl p-1.5 shadow-sm border border-slate-200/60 flex-1 flex flex-col min-h-0">
        <div className="bg-white rounded-2xl p-6 flex-1 overflow-y-auto shadow-sm">
          <div className="max-w-3xl mx-auto space-y-6">
            <div>
              <h2 className="text-base font-bold text-slate-800 mb-1">Step 1: Content Type Selection</h2>
              <p className="text-xs text-slate-500">
                Chọn định dạng nội dung để kích hoạt AI Model và bộ tài liệu phù hợp cho từng bước tiếp theo.
              </p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {CONTENT_TYPES.map(ct => (
                <button
                  key={ct.id}
                  onClick={() => onUpdate({ contentType: ct.id })}
                  className={`text-left p-4 rounded-2xl border-2 transition-all space-y-2 ${ct.color} ${
                    selected === ct.id
                      ? 'ring-2 ring-slate-900 ring-offset-1 border-transparent shadow-md'
                      : ''
                  }`}
                >
                  <div className="text-xl">{ct.icon}</div>
                  <div>
                    <div className="text-xs font-bold text-slate-800 leading-tight">{ct.label}</div>
                    <div className="text-[10px] text-slate-500 mt-1 leading-relaxed">{ct.description}</div>
                  </div>
                  {selected === ct.id && (
                    <div className="flex items-center space-x-1 text-[10px] font-bold text-slate-800">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" />
                      </svg>
                      <span>Đã chọn</span>
                    </div>
                  )}
                </button>
              ))}
            </div>

            {selected && (
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 animate-fade-in-up">
                <div className="flex items-center space-x-2 mb-2">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Loại đã chọn</span>
                </div>
                <p className="text-sm font-bold text-slate-800">
                  {CONTENT_TYPES.find(c => c.id === selected)?.label}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {CONTENT_TYPES.find(c => c.id === selected)?.description}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex justify-end shrink-0">
        <button
          onClick={onNext}
          disabled={!selected}
          className="bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-xs py-2.5 px-6 rounded-2xl shadow-sm transition-all flex items-center space-x-2"
        >
          <span>Tiếp tục → Core Idea & Angle</span>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </button>
      </div>
    </div>
  );
}
