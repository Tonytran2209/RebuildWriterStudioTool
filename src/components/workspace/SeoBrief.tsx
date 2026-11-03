import { useId } from 'react';
import { Link2, Search, Target } from 'lucide-react';
import type { Article } from '../../types';
import { useI18n } from '../../lib/i18n';
interface Props { article: Article; primaryKeyword: string; linkTarget: number; linkMax: number; approvedCandidates: number }
export default function SeoBrief({ article, primaryKeyword, linkTarget, linkMax, approvedCandidates }: Props) {
  const { tr } = useI18n();
  const id = useId();
  const normalized = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  const selectedIdea = article.coreIdeaSuggestions?.find(idea => idea.id === article.selectedCoreIdeaId) ?? article.coreIdeaSuggestions?.[0];
  const seen = new Set([normalized(primaryKeyword)]);
  const secondary = (article.articleSpec?.secondaryQueries ?? selectedIdea?.secondaryKeywords ?? (article.keywords ?? '').split(',').slice(1)).filter(keyword => {
    const key = normalized(keyword); if (!key || seen.has(key)) return false; seen.add(key); return true;
  });
  const researched = (article.seoResearch?.keywords ?? []).filter(item => {
    const key = normalized(item.keyword); if (!key || seen.has(key)) return false; seen.add(key); return true;
  });
  const intentLabel = (intent: string) => ({ informational: tr('Tìm hiểu thông tin', 'Informational'), commercial: tr('Cân nhắc lựa chọn', 'Commercial'), transactional: tr('Thực hiện hành động', 'Transactional'), navigational: tr('Tìm trang cụ thể', 'Navigational') }[intent.toLowerCase()] ?? intent);
  const primaryIntent = article.articleSpec?.primaryIntent;
  return <section className="seo-brief" aria-labelledby={`${id}-title`}>
    <header className="seo-brief-header"><span className="seo-brief-heading"><Search size={16} aria-hidden="true" /><h3 id={`${id}-title`}>SEO brief</h3></span><span className="seo-brief-caption">{tr('Định hướng từ khóa cho bài viết', 'Keyword direction for this article')}</span></header>
    <div className="seo-brief-primary"><div><span className="seo-brief-label"><Target size={13} aria-hidden="true" />{tr('Từ khóa chính', 'Primary keyword')}</span><p>{primaryKeyword || tr('Chưa xác định từ khóa chính', 'Primary keyword not set')}</p></div><div className="seo-brief-intent"><span className="seo-brief-label">{tr('Ý định tìm kiếm', 'Search intent')}</span><span>{primaryIntent ? intentLabel(primaryIntent) : tr('Chưa xác định', 'Not set')}</span></div></div>
    <div className={`seo-brief-groups ${secondary.length && researched.length ? 'has-two-groups' : ''}`}>
      {secondary.length > 0 && <div className="seo-brief-group"><h4>{tr('Từ khóa phụ', 'Secondary keywords')}<span>{secondary.length}</span></h4><p className="seo-brief-group-help">{tr('Các truy vấn hỗ trợ trong định hướng đã chọn', 'Supporting queries in the selected direction')}</p><ol>{secondary.map((keyword, index) => <li key={normalized(keyword)}><span className="seo-brief-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><span className="seo-brief-keyword">{keyword.trim()}</span></li>)}</ol></div>}
      {researched.length > 0 && <div className="seo-brief-group"><h4>{tr('Từ khóa nghiên cứu', 'Researched keywords')}<span>{researched.length}</span></h4><p className="seo-brief-group-help">{tr('Tham khảo thêm từ kết quả nghiên cứu SEO', 'Additional terms from SEO research')}</p><ol>{researched.map((item, index) => <li key={normalized(item.keyword)}><span className="seo-brief-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><span className="seo-brief-keyword">{item.keyword.trim()}</span>{item.intent && item.intent.toLowerCase() !== primaryIntent && <span className="seo-brief-keyword-intent">{intentLabel(item.intent)}</span>}</li>)}</ol></div>}
      {!secondary.length && !researched.length && <p className="seo-brief-empty">{tr('Chưa có từ khóa hỗ trợ. Từ khóa chính vẫn là trọng tâm của bài viết.', 'No supporting keywords yet. The primary keyword remains the article focus.')}</p>}
    </div>
    <footer className="seo-brief-links"><Link2 size={15} aria-hidden="true" /><span>{tr('Liên kết nội bộ', 'Internal links')}</span><strong>{linkTarget}–{linkMax}</strong><span>{tr('liên kết cần có', 'links required')}</span><span className="seo-brief-candidates">{approvedCandidates} {tr('URL ứng viên đã duyệt', 'approved candidate URLs')}</span></footer>
  </section>;
}
