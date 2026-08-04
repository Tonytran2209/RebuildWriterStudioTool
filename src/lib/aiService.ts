import type { AIModel } from '../types';

export interface AIRequest {
  model: AIModel;
  prompt: string;
  systemPrompt?: string;
  railwayUrl?: string;
  maxTokens?: number;
  temperature?: number;
  stepNumber: 1 | 2 | 3 | 4;
}

export interface AIResponse {
  content: string;
  model: string;
  usage?: { inputTokens: number; outputTokens: number };
  generatedAt?: string;
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
  const { model, prompt, systemPrompt, maxTokens, temperature, stepNumber } = req;

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
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText })) as any;
        throw new Error(err.error || `Railway error ${res.status}`);
      }

      return res.json();
    } catch (err: any) {
      // Re-throw with clear message — UI will show it
      throw new Error(`Railway: ${err.message}`);
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
