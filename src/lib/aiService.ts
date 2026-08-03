import type { AIModel } from '../types';

export interface AIRequest {
  model: AIModel;
  prompt: string;
  systemPrompt?: string;
  contextDocs?: string[];
  railwayUrl?: string;
}

export interface AIResponse {
  content: string;
  model: string;
  usage?: { inputTokens: number; outputTokens: number };
}

const DEMO_RESPONSES: Record<string, string> = {
  outline: `## Dàn bài đề xuất

**I. Giới thiệu tổng quan**
- Bối cảnh thị trường và lý do so sánh
- Tiêu chí đánh giá chính

**II. Tổng quan sản phẩm**
- Thông số kỹ thuật và tính năng nổi bật
- Đối tượng người dùng mục tiêu

**III. Phân tích chi tiết theo tiêu chí**
- Hiệu năng và tốc độ xử lý
- Chất lượng và độ bền
- Giá trị so với chi phí

**IV. Ưu điểm & Nhược điểm**
- Bảng so sánh trực quan
- Kịch bản sử dụng phù hợp

**V. Kết luận & Khuyến nghị**
- Lời khuyên theo từng nhóm người dùng
- Điểm đánh giá tổng thể`,

  draft: `# So sánh toàn diện: Sản phẩm A và Sản phẩm B (2026)

Khi thị trường ngày càng có nhiều lựa chọn, việc ra quyết định đúng đắn trở nên quan trọng hơn bao giờ hết. Bài viết này cung cấp góc nhìn khách quan, dựa trên dữ liệu thực tế để giúp bạn đưa ra lựa chọn phù hợp.

## Tổng quan nhanh

Cả hai sản phẩm đều nhắm đến phân khúc người dùng chuyên nghiệp, nhưng với triết lý thiết kế và định vị thị trường khác nhau...`,

  angle: `**Góc độ đề xuất:** *"Chi phí ẩn mà 90% người dùng không biết khi so sánh hai sản phẩm này"*

Thay vì so sánh thông số bề mặt, hãy đi sâu vào tổng chi phí sở hữu (TCO), giá trị lâu dài và những điểm mà các bài review thông thường bỏ qua.

**Từ khóa gợi ý:** so sánh [A] vs [B], [A] có tốt không, nên mua [A] hay [B], đánh giá [B] 2026`,
};

export async function callAI(req: AIRequest): Promise<AIResponse> {
  const { model, prompt, systemPrompt, contextDocs, railwayUrl } = req;

  if (railwayUrl) {
    try {
      const res = await fetch(`${railwayUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: model.id,
          provider: model.provider,
          prompt,
          systemPrompt,
          contextDocs,
        }),
      });
      if (!res.ok) throw new Error(`Railway API error: ${res.status}`);
      return res.json();
    } catch (err) {
      console.warn('Railway API call failed, falling back to demo mode:', err);
    }
  }

  // Demo mode: simulate network delay + return placeholder
  await new Promise(r => setTimeout(r, 1200 + Math.random() * 800));

  const key = prompt.toLowerCase().includes('dàn bài') || prompt.toLowerCase().includes('outline')
    ? 'outline'
    : prompt.toLowerCase().includes('draft') || prompt.toLowerCase().includes('bài viết')
    ? 'draft'
    : 'angle';

  return {
    content: DEMO_RESPONSES[key] || `[Demo] Phản hồi từ **${model.name}**. Kết nối Railway backend để kích hoạt AI thực.`,
    model: model.id,
    usage: { inputTokens: 450, outputTokens: 280 },
  };
}
