import type { AICallUsage, AIModel, SeoResearchResult } from '../types';

export interface AIRequest {
  model: AIModel;
  prompt: string;
  systemPrompt?: string;
  railwayUrl?: string;
  maxTokens?: number;
  temperature?: number;
  stepNumber: 1 | 2 | 3 | 4;
  splitByWave?: boolean;
  bypassCache?: boolean;
  jsonMode?: boolean;
  articleId: string;
}

export interface AIResponse {
  content: string;
  model: string;
  usage?: { inputTokens: number; outputTokens: number; cachedInputTokens?: number };
  generatedAt?: string;
  servedAt?: string;
  cacheHit?: boolean;
  timing?: { contextMs: number; providerMs: number; totalMs: number };
  context?: { stepNumber: number; kb: string[]; action: string[]; rules: string[]; totalChars: number; waves?: number };
  budget?: { used: number; limit: number };
  costUsd?: number | null;
}

interface AIErrorPayload {
  error?: string;
  code?: 'AI_CREDITS_EXHAUSTED' | 'AI_PROVIDER_QUOTA_EXCEEDED' | 'AI_PROVIDER_NOT_CONFIGURED' | 'ARTICLE_DAILY_AI_LIMIT' | 'AI_PROVIDER_ERROR';
  provider?: string;
  modelId?: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google Gemini',
  mistral: 'Mistral',
  groq: 'Groq',
  together: 'Together AI',
  deepseek: 'DeepSeek',
};

function formatAIError(payload: AIErrorPayload, fallbackProvider: string, fallbackModel: string): string {
  const provider = PROVIDER_LABELS[payload.provider ?? fallbackProvider] ?? payload.provider ?? fallbackProvider;
  const model = payload.modelId ?? fallbackModel;
  if (payload.code === 'AI_CREDITS_EXHAUSTED') {
    return `⚠️ ${provider} API đã hết credits. Model ${model} không thể tiếp tục. Vui lòng nạp credits trong tài khoản ${provider} hoặc chọn model thuộc provider khác trong Model & Rules DB.`;
  }
  if (payload.code === 'AI_PROVIDER_QUOTA_EXCEEDED') {
    return `⚠️ ${provider} đang vượt quota hoặc rate limit cho model ${model}. Vui lòng thử lại sau hoặc chọn provider khác.`;
  }
  if (payload.code === 'AI_PROVIDER_NOT_CONFIGURED') {
    return `⚠️ ${provider} chưa được cấu hình API key cho model ${model}. Vui lòng kiểm tra Railway Variables hoặc chọn provider khác.`;
  }
  return payload.error || `Lỗi AI provider ${provider} với model ${model}.`;
}

const DEMO_RESPONSES: Record<string, string> = {
  outline: `## Dàn bài đề xuất

**I. Giới thiệu tổng quan**
- Bối cảnh thị trường và lý do so sánh
- Tiêu chí đánh giá chính được sử dụng

**II. Tổng quan sản phẩm**
- Thông số kỹ thuật và tính năng nổi bật
- Đối tượng người dùng mục tiêu

**III. Phân tích chi tiết theo tiêu chí**
- Hiệu năng và tốc độ xử lý
- Chất lượng, độ bền và thiết kế
- Giá trị so với chi phí đầu tư

**IV. Ưu điểm & Nhược điểm**
- Bảng so sánh trực quan
- Kịch bản sử dụng phù hợp cho từng nhóm người dùng

**V. Kết luận & Khuyến nghị**
- Lời khuyên theo nhu cầu cụ thể
- Điểm đánh giá tổng thể (thang 10)`,

  draft: `# Tiêu đề bài viết

Mở đầu hấp dẫn thu hút độc giả ngay từ những dòng đầu tiên. Đặt vấn đề rõ ràng và nêu lý do tại sao bài viết này quan trọng với người đọc.

## Phần 1: Tổng quan

Nội dung phần mở đầu chi tiết, cung cấp bối cảnh cần thiết để độc giả hiểu được vấn đề đang được đề cập.

## Phần 2: Phân tích chuyên sâu

Đây là phần nội dung chính của bài viết. Trình bày các luận điểm theo thứ tự logic, có dẫn chứng cụ thể và số liệu thực tế.

## Kết luận

Tóm tắt các điểm chính và đưa ra lời khuyên hoặc kêu gọi hành động rõ ràng.`,

  angle: `**Góc độ đề xuất:** *"Điều mà 90% người dùng bỏ qua khi đưa ra quyết định này"*

Thay vì tiếp cận từ góc độ thông thường, hãy khai thác khía cạnh ít được đề cập nhưng có tác động lớn nhất đến quyết định của người dùng.

**Từ khóa gợi ý bổ sung:** review chi tiết, so sánh toàn diện, kinh nghiệm thực tế, đánh giá khách quan 2026`,
};

function getDemoKey(prompt: string): string {
  const p = prompt.toLowerCase();
  if (p.includes('dàn bài') || p.includes('outline')) return 'outline';
  if (p.includes('bài viết') || p.includes('draft') || p.includes('viết')) return 'draft';
  return 'angle';
}

export async function callAI(req: AIRequest): Promise<AIResponse> {
  const { model, prompt, systemPrompt, maxTokens, temperature, stepNumber, splitByWave, bypassCache, jsonMode, articleId } = req;

  // Resolve railway URL — prop → localStorage → hardcoded production URL
  const railwayUrl = req.railwayUrl
    || localStorage.getItem('writer:railwayUrl')
    || 'https://rebuildwriterstudiotool-production.up.railway.app';

  if (railwayUrl) {
    try {
      const res = await fetch(`${railwayUrl.replace(/\/$/, '')}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: model.id,
          provider: model.provider,
          prompt,
          systemPrompt,
          stepNumber,
          maxTokens,
          temperature,
          splitByWave,
          bypassCache,
          jsonMode,
          pricing: model.pricing,
          articleId,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText })) as AIErrorPayload;
        throw new Error(formatAIError(err, model.provider, model.id));
      }

      const response = await res.json() as AIResponse;
      const billedInput = response.cacheHit ? 0 : response.usage?.inputTokens ?? 0;
      const billedOutput = response.cacheHit ? 0 : response.usage?.outputTokens ?? 0;
      const billedCachedInput = response.cacheHit ? 0 : response.usage?.cachedInputTokens ?? 0;
      const usage: AICallUsage = {
        id: `usage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        step: stepNumber,
        provider: model.provider,
        model: response.model || model.id,
        inputTokens: billedInput,
        cachedInputTokens: billedCachedInput,
        outputTokens: billedOutput,
        totalTokens: billedInput + billedOutput,
        costUsd: response.cacheHit ? 0 : response.costUsd ?? null,
        cacheHit: Boolean(response.cacheHit),
        calledAt: new Date().toISOString(),
      };
      window.dispatchEvent(new CustomEvent<AICallUsage>('writer:ai-usage', { detail: usage }));
      return response;
    } catch (err: any) {
      // Preserve actionable provider/billing messages instead of hiding them
      // behind a generic Railway prefix in every workflow step.
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(message.startsWith('⚠️') ? message : `Railway: ${message}`);
    }
  }

  // Demo mode — simulate delay + return placeholder
  await new Promise(r => setTimeout(r, 1200 + Math.random() * 600));
  return {
    content: DEMO_RESPONSES[getDemoKey(prompt)],
    model: model.id,
    usage: { inputTokens: 450, outputTokens: 280 },
  };
}

export async function researchSeoKeywords(seeds: string[], articleId: string, railwayUrl?: string): Promise<SeoResearchResult> {
  const baseUrl = railwayUrl || localStorage.getItem('writer:railwayUrl') || 'https://rebuildwriterstudiotool-production.up.railway.app';
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/seo/research`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seeds, articleId }),
  });
  const payload = await response.json().catch(() => ({ error: response.statusText })) as SeoResearchResult & AIErrorPayload;
  if (!response.ok) throw new Error(formatAIError(payload, 'openai', payload.modelId ?? 'gpt-5.4-mini'));
  return payload;
}
