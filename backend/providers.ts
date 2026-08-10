/**
 * AI provider adapters — each returns { content, model, usage }
 * All providers share the same input signature.
 */

export interface GenerateRequest {
  modelId: string;
  provider: string;
  prompt: string;
  systemPrompt?: string;
  contextDocs?: string[];
  maxTokens?: number;
  temperature?: number;
}

export interface GenerateResponse {
  content: string;
  model: string;
  usage?: { inputTokens: number; outputTokens: number; cachedInputTokens?: number };
}

// ── Anthropic ────────────────────────────────────────────────────────────────

async function callAnthropic(req: GenerateRequest): Promise<GenerateResponse> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const systemParts: string[] = [];
  if (req.systemPrompt) systemParts.push(req.systemPrompt);
  if (req.contextDocs?.length) {
    systemParts.push('\n\n=== TÀI LIỆU THAM KHẢO ===\n' + req.contextDocs.join('\n\n---\n\n'));
  }

  const msg = await client.messages.create({
    model: req.modelId,
    max_tokens: req.maxTokens ?? 4096,
    system: systemParts.join('\n') || undefined,
    messages: [{ role: 'user', content: req.prompt }],
  });

  const content = msg.content.find(b => b.type === 'text')?.text ?? '';
  return {
    content,
    model: msg.model,
    usage: { inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens },
  };
}

// ── OpenAI ───────────────────────────────────────────────────────────────────

async function callOpenAI(req: GenerateRequest): Promise<GenerateResponse> {
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const messages: any[] = [];
  if (req.systemPrompt || req.contextDocs?.length) {
    const sysContent = [
      req.systemPrompt ?? '',
      req.contextDocs?.length ? '\n\n=== TÀI LIỆU THAM KHẢO ===\n' + req.contextDocs.join('\n\n---\n\n') : '',
    ].filter(Boolean).join('\n');
    messages.push({ role: 'system', content: sysContent });
  }
  messages.push({ role: 'user', content: req.prompt });

  if (req.modelId.startsWith('gpt-5.')) {
    const input = messages.map(message => ({
      role: message.role,
      content: message.content,
    }));
    const response = await client.responses.create({
      model: req.modelId,
      input,
      max_output_tokens: req.maxTokens ?? 4096,
    });
    return {
      content: response.output_text,
      model: response.model,
      usage: {
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
        cachedInputTokens: response.usage?.input_tokens_details?.cached_tokens ?? 0,
      },
    };
  }

  const res = await client.chat.completions.create({
    model: req.modelId,
    messages,
    max_tokens: req.maxTokens ?? 4096,
    temperature: req.temperature ?? 0.7,
  });

  return {
    content: res.choices[0]?.message?.content ?? '',
    model: res.model,
    usage: {
      inputTokens: res.usage?.prompt_tokens ?? 0,
      outputTokens: res.usage?.completion_tokens ?? 0,
      cachedInputTokens: res.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    },
  };
}

// ── Google Gemini ────────────────────────────────────────────────────────────

async function callGoogle(req: GenerateRequest): Promise<GenerateResponse> {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);

  const modelId = req.modelId;
  const model = genAI.getGenerativeModel({ model: modelId });

  const contextBlock = req.contextDocs?.length
    ? '\n\n=== TÀI LIỆU THAM KHẢO ===\n' + req.contextDocs.join('\n\n---\n\n')
    : '';

  const fullPrompt = [
    req.systemPrompt ? `[Hướng dẫn hệ thống]: ${req.systemPrompt}` : '',
    contextBlock,
    `[Yêu cầu]: ${req.prompt}`,
  ].filter(Boolean).join('\n\n');

  const result = await model.generateContent(fullPrompt);
  const text = result.response.text();

  return {
    content: text,
    model: modelId,
    usage: {
      inputTokens: result.response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: result.response.usageMetadata?.candidatesTokenCount ?? 0,
    },
  };
}

// ── Mistral ──────────────────────────────────────────────────────────────────

async function callMistral(req: GenerateRequest): Promise<GenerateResponse> {
  const systemContent = [
    req.systemPrompt ?? '',
    req.contextDocs?.length ? '\n\n=== TÀI LIỆU THAM KHẢO ===\n' + req.contextDocs.join('\n\n---\n\n') : '',
  ].filter(Boolean).join('\n');
  const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`,
    },
    body: JSON.stringify({
      model: req.modelId,
      messages: [
        ...(systemContent ? [{ role: 'system', content: systemContent }] : []),
        { role: 'user', content: req.prompt },
      ],
      max_tokens: req.maxTokens ?? 4096,
      temperature: req.temperature ?? 0.7,
    }),
  });

  if (!res.ok) throw new Error(`Mistral API error: ${await res.text()}`);
  const data = await res.json() as any;

  return {
    content: data.choices[0]?.message?.content ?? '',
    model: data.model,
    usage: {
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    },
  };
}

// ── Together AI (OpenAI-compatible) ─────────────────────────────────────────

async function callTogether(req: GenerateRequest): Promise<GenerateResponse> {
  const systemContent = [
    req.systemPrompt ?? '',
    req.contextDocs?.length ? '\n\n=== TÀI LIỆU THAM KHẢO ===\n' + req.contextDocs.join('\n\n---\n\n') : '',
  ].filter(Boolean).join('\n');
  const res = await fetch('https://api.together.xyz/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.TOGETHER_API_KEY}`,
    },
    body: JSON.stringify({
      model: req.modelId,
      messages: [
        ...(systemContent ? [{ role: 'system', content: systemContent }] : []),
        { role: 'user', content: req.prompt },
      ],
      max_tokens: req.maxTokens ?? 4096,
      temperature: req.temperature ?? 0.7,
    }),
  });
  if (!res.ok) throw new Error(`Together API error: ${await res.text()}`);
  const data = await res.json() as any;
  return {
    content: data.choices[0]?.message?.content ?? '',
    model: data.model,
    usage: {
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    },
  };
}

// ── Groq ─────────────────────────────────────────────────────────────────────

async function callGroq(req: GenerateRequest): Promise<GenerateResponse> {
  const { default: Groq } = await import('groq-sdk');
  const client = new Groq({ apiKey: process.env.GROQ_API_KEY });

  const groqModelMap: Record<string, string> = {
    'groq-gpt-oss-120b': 'openai/gpt-oss-120b',
    'llama-3-70b-groq': 'llama3-70b-8192',
    'llama-3-8b-groq': 'llama3-8b-8192',
    'mixtral-8x7b-groq': 'mixtral-8x7b-32768',
  };
  const modelId = groqModelMap[req.modelId] ?? req.modelId;

  const chat = await client.chat.completions.create({
    model: modelId,
    messages: [
      ...(req.systemPrompt || req.contextDocs?.length ? [{
        role: 'system' as const,
        content: [
          req.systemPrompt ?? '',
          req.contextDocs?.length ? '\n\n=== TÀI LIỆU THAM KHẢO ===\n' + req.contextDocs.join('\n\n---\n\n') : '',
        ].filter(Boolean).join('\n'),
      }] : []),
      { role: 'user' as const, content: req.prompt },
    ],
    max_tokens: req.maxTokens ?? 4096,
    temperature: req.temperature ?? 0.7,
  });

  return {
    content: chat.choices[0]?.message?.content ?? '',
    model: modelId,
    usage: {
      inputTokens: chat.usage?.prompt_tokens ?? 0,
      outputTokens: chat.usage?.completion_tokens ?? 0,
    },
  };
}

// ── Dispatcher ───────────────────────────────────────────────────────────────

export async function generate(req: GenerateRequest): Promise<GenerateResponse> {
  switch (req.provider) {
    case 'anthropic': return callAnthropic(req);
    case 'openai':    return callOpenAI(req);
    case 'google':    return callGoogle(req);
    case 'mistral':   return callMistral(req);
    case 'together':  return callTogether(req);
    case 'groq':      return callGroq(req);
    default:
      throw new Error(`Unknown provider: ${req.provider}`);
  }
}

/** Returns which providers have API keys configured */
export function getAvailableProviders(): Record<string, boolean> {
  return {
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    openai:    !!process.env.OPENAI_API_KEY,
    google:    !!process.env.GOOGLE_API_KEY,
    mistral:   !!process.env.MISTRAL_API_KEY,
    groq:      !!process.env.GROQ_API_KEY,
    together:  !!process.env.TOGETHER_API_KEY,
  };
}
