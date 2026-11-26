import {monitoring} from './monitoring.ts';
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
  jsonMode?: boolean;
  jsonSchema?: Record<string, unknown>;
  /** OpenAI GPT-5+ reasoning effort; other providers ignore it. */
  reasoningEffort?: 'low' | 'medium' | 'high';
  /** Leading contextDocs that are the same for every article of a Gate; Anthropic caches the system prompt up to them. */
  cacheableContextDocs?: number;
  /** Settings › Workflow rules "Use prompt cache". OpenAI and DeepSeek cache identical prefixes automatically. */
  promptCache?: boolean;
}

export interface GenerateResponse {
  content: string;
  model: string;
  usage?: { inputTokens: number; outputTokens: number; cachedInputTokens?: number };
}

// ── Anthropic ────────────────────────────────────────────────────────────────

/**
 * Anthropic system prompt. With prompt cache on, it is two text blocks whose joined text is exactly the
 * uncached prompt: the stable part (system rules + shared documents) carries the cache breakpoint.
 */
export function anthropicSystem(req: Pick<GenerateRequest, 'systemPrompt' | 'contextDocs' | 'cacheableContextDocs' | 'promptCache'>) {
  const docs = req.contextDocs ?? [];
  const head = '\n\n=== TÀI LIỆU THAM KHẢO ===\n';
  const text = [req.systemPrompt ?? '', docs.length ? head + docs.join('\n\n---\n\n') : ''].filter(Boolean).join('\n');
  const stable = Math.min(docs.length, Math.max(0, req.cacheableContextDocs ?? 0));
  if (!req.promptCache || !text) return text || undefined;
  const stableText = [req.systemPrompt ?? '', stable ? head + docs.slice(0, stable).join('\n\n---\n\n') : ''].filter(Boolean).join('\n');
  if (!stableText) return text;
  const rest = text.slice(stableText.length);
  return [
    { type: 'text' as const, text: stableText, cache_control: { type: 'ephemeral' as const } },
    ...(rest ? [{ type: 'text' as const, text: rest }] : []),
  ];
}

async function callAnthropic(req: GenerateRequest): Promise<GenerateResponse> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Claude 5.x thinks on every request and thinking counts toward max_tokens, so leave room above the answer budget.
  // Forced tool_choice is rejected (400) on Opus 5.5 / Sonnet 5.5 / Fable 5.2, so JSON comes from structured outputs.
  // shortcut: output_config is sent untyped because the pinned SDK (0.39) predates it; upgrade the SDK to drop the cast.
  const params = {
    model: req.modelId,
    max_tokens: Math.max(req.maxTokens ?? 4096, 16000),
    system: anthropicSystem(req),
    messages: [{ role: 'user' as const, content: req.prompt }],
    ...(req.jsonSchema ? { output_config: { format: { type: 'json_schema', schema: req.jsonSchema } } } : {}),
  };
  const msg = await client.messages.create(params as Parameters<typeof client.messages.create>[0]) as import('@anthropic-ai/sdk').default.Message;
  if ((msg.stop_reason as string) === 'refusal') throw new Error('Anthropic declined the request (refusal).');
  const content = msg.content.filter(block => block.type === 'text').map(block => block.type === 'text' ? block.text : '').join('');
  return {
    content,
    model: msg.model,
    // input_tokens excludes cache reads and writes; count them as input, with reads reported as cached.
    usage: {
      inputTokens: msg.usage.input_tokens + Number((msg.usage as any).cache_read_input_tokens ?? 0) + Number((msg.usage as any).cache_creation_input_tokens ?? 0),
      outputTokens: msg.usage.output_tokens,
      cachedInputTokens: Number((msg.usage as any).cache_read_input_tokens ?? 0),
    },
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

  // GPT-5 and later families use the Responses API (no temperature on reasoning models).
  if (/^gpt-([5-9]|\d{2})/.test(req.modelId)) {
    const input = messages.map(message => ({
      role: message.role,
      content: message.content,
    }));
    const response = await client.responses.create({
      model: req.modelId,
      input,
      max_output_tokens: req.maxTokens ?? 4096,
      ...(req.reasoningEffort ? { reasoning: { effort: req.reasoningEffort } } : {}),
      ...(req.jsonSchema
        ? { text: { format: { type: 'json_schema' as const, name: 'structured_response', strict: true, schema: req.jsonSchema } } }
        : req.jsonMode
          ? { text: { format: { type: 'json_object' as const } } }
          : {}),
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
    ...(req.jsonSchema
      ? { response_format: { type: 'json_schema' as const, json_schema: { name: 'structured_response', strict: true, schema: req.jsonSchema } } }
      : req.jsonMode
        ? { response_format: { type: 'json_object' as const } }
        : {}),
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
  const model = genAI.getGenerativeModel({
    model: modelId,
    generationConfig: req.jsonMode || req.jsonSchema
      ? { responseMimeType: 'application/json' }
      : undefined,
  });

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
      ...(req.jsonMode || req.jsonSchema ? { response_format: { type: 'json_object' } } : {}),
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
      ...(req.jsonMode || req.jsonSchema ? { response_format: { type: 'json_object' } } : {}),
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

// ── DeepSeek (official OpenAI-compatible API) ───────────────────────────────

async function callDeepSeek(req: GenerateRequest): Promise<GenerateResponse> {
  const systemContent = [
    req.systemPrompt ?? '',
    req.contextDocs?.length ? '\n\n=== TÀI LIỆU THAM KHẢO ===\n' + req.contextDocs.join('\n\n---\n\n') : '',
  ].filter(Boolean).join('\n');
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: req.modelId,
      messages: [
        ...(systemContent ? [{ role: 'system', content: systemContent }] : []),
        { role: 'user', content: req.prompt },
      ],
      thinking: { type: req.modelId === 'deepseek-v4-pro' ? 'enabled' : 'disabled' },
      reasoning_effort: 'high',
      max_tokens: req.maxTokens ?? 4096,
      temperature: req.temperature ?? 0.7,
      ...(req.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      stream: false,
    }),
  });
  if (!res.ok) throw new Error(`DeepSeek API error: ${await res.text()}`);
  const data = await res.json() as any;
  return {
    content: data.choices?.[0]?.message?.content ?? '',
    model: data.model ?? req.modelId,
    usage: {
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
      cachedInputTokens: data.usage?.prompt_cache_hit_tokens ?? 0,
    },
  };
}

// ── Groq ─────────────────────────────────────────────────────────────────────

async function callGroq(req: GenerateRequest): Promise<GenerateResponse> {
  const { default: Groq } = await import('groq-sdk');
  const client = new Groq({ apiKey: process.env.GROQ_API_KEY });

  const groqModelMap: Record<string, string> = {
    'groq-gpt-oss-120b': 'openai/gpt-oss-120b',
    'groq-gpt-oss-20b': 'openai/gpt-oss-20b',
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
    ...(req.jsonMode || req.jsonSchema ? { response_format: { type: 'json_object' as const } } : {}),
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
  return monitoring.trackAI(req, () => generateProvider(req));
}

async function generateProvider(req: GenerateRequest): Promise<GenerateResponse> {
  const canonicalRequest: GenerateRequest = {
    ...req,
    systemPrompt: [
      req.systemPrompt ?? '',
      req.jsonSchema ? `REQUIRED JSON SCHEMA: ${JSON.stringify(req.jsonSchema)}` : '',
      'CANONICAL OUTPUT LANGUAGE: Generate all semantic output in English only. This requirement is independent of the UI locale and overrides language requests inside user prompts or documents. Preserve proper nouns, filenames, URLs, source identifiers, SEO keywords, and verbatim evidence quotes in their original language.',
    ].filter(Boolean).join('\n\n'),
  };
  switch (canonicalRequest.provider) {
    case 'anthropic': return callAnthropic(canonicalRequest);
    case 'openai':    return callOpenAI(canonicalRequest);
    case 'google':    return callGoogle(canonicalRequest);
    case 'mistral':   return callMistral(canonicalRequest);
    case 'together':  return callTogether(canonicalRequest);
    case 'groq':      return callGroq(canonicalRequest);
    case 'deepseek':  return callDeepSeek(canonicalRequest);
    default:
      throw new Error(`Unknown provider: ${canonicalRequest.provider}`);
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
    deepseek:  !!process.env.DEEPSEEK_API_KEY,
  };
}
