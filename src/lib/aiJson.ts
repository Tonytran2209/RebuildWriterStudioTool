function extractJsonBody(raw: string) {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : raw).trim();
  const objectStart = body.indexOf('{');
  const arrayStart = body.indexOf('[');
  const start = objectStart >= 0 && (arrayStart < 0 || objectStart < arrayStart) ? objectStart : arrayStart;
  if (start < 0) throw new Error('Không tìm thấy JSON trong phản hồi AI.');
  const end = body[start] === '{' ? body.lastIndexOf('}') : body.lastIndexOf(']');
  if (end <= start) throw new Error('JSON từ AI chưa hoàn chỉnh hoặc bị cắt giữa chừng.');
  return body.slice(start, end + 1);
}

function escapeUnquotedStringQuotes(input: string) {
  let output = '';
  let inString = false;
  let escaped = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (!inString) {
      if (char === '"') inString = true;
      output += char;
      continue;
    }
    if (escaped) { output += char; escaped = false; continue; }
    if (char === '\\') { output += char; escaped = true; continue; }
    if (char !== '"') { output += char; continue; }
    const next = input.slice(index + 1).match(/^\s*([,:}\]"])/)?.[1];
    if (next || !input.slice(index + 1).trim()) {
      inString = false;
      output += char;
    } else {
      output += '\\"';
    }
  }
  return output;
}

export function parseAIJson(raw: string): unknown {
  const json = extractJsonBody(raw);
  try { return JSON.parse(json); } catch { /* deterministic repair below */ }
  const repaired = escapeUnquotedStringQuotes(json)
    .replace(/\u00a0/g, ' ')
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/}\s*{/g, '},{')
    .replace(/("(?:\\.|[^"\\])*"|\d+(?:\.\d+)?|true|false|null|\]|})\s*\n\s*(?="[^"\n]+"\s*:)/g, '$1,\n');
  try { return JSON.parse(repaired); } catch (error) {
    throw new Error(`AI trả về JSON sai cấu trúc và không thể phục hồi an toàn: ${error instanceof Error ? error.message : String(error)}`);
  }
}
