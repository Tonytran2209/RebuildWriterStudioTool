import crypto from 'crypto';

export interface StructuredSection {
  id: string;
  heading: string;
  content: string;
  contentHash: string;
  wave?: string;
  timeframe?: string;
  typeGroups: Array<'A' | 'B' | 'C'>;
}

const HEADING_PATTERN = /^(?:#{1,6}\s+|(?:section|phần|chapter|chương)\s+\d+|wave\s*\d+|publishing\s+wave\s*\d+)/i;
const WAVE_PATTERN = /\b(?:publishing\s+)?wave\s*[:#-]?\s*(\d+)\b/i;
const TIMEFRAME_HEADING_PATTERN = /^(?:(?:tháng|month)\s+\d{1,2}(?:\s*[/-]\s*(?:19|20)\d{2})?|Q[1-4]\s*[/-]?\s*(?:19|20)\d{2}|(?:19|20)\d{2}\s*[/-]?\s*Q[1-4])\s*[:#-]?\s*$/i;
const TIMEFRAME_PATTERNS = [
  /\bQ[1-4]\s*[/-]?\s*(?:19|20)\d{2}\b/i,
  /\b(?:19|20)\d{2}\s*[/-]?\s*Q[1-4]\b/i,
  /\b(?:tháng|month)\s+\d{1,2}(?:\s*[/-]\s*(?:19|20)\d{2})?\b/i,
  /\b(?:19|20)\d{2}\b/,
];

function hash(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function cleanHeading(line: string): string {
  return line.replace(/^#{1,6}\s+/, '').trim();
}

function sectionMetadata(heading: string, content: string) {
  const sample = `${heading}\n${content}`;
  const waveMatch = sample.match(WAVE_PATTERN);
  const timeframe = TIMEFRAME_PATTERNS.map(pattern => sample.match(pattern)?.[0]).find(Boolean);
  const typeGroups = (['A', 'B', 'C'] as const).filter(group =>
    new RegExp(`\\b(?:content\\s*)?type\\s*${group}\\b`, 'i').test(sample),
  );
  return {
    wave: waveMatch ? `Wave ${waveMatch[1]}` : undefined,
    timeframe,
    typeGroups,
  };
}

/** Deterministic extraction only: preserves original text and never invents metadata. */
export function extractStructuredSections(content: string): StructuredSection[] {
  const normalized = content.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];
  const lines = normalized.split('\n');
  const starts: number[] = [];
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed && (HEADING_PATTERN.test(trimmed) || WAVE_PATTERN.test(trimmed) || TIMEFRAME_HEADING_PATTERN.test(trimmed))) starts.push(index);
  });
  if (!starts.length || starts[0] !== 0) starts.unshift(0);

  const sections = starts.map((start, index) => {
    const end = starts[index + 1] ?? lines.length;
    const slice = lines.slice(start, end).join('\n').trim();
    const firstLine = lines[start]?.trim() || `Section ${index + 1}`;
    const heading = cleanHeading(firstLine).slice(0, 240);
    const metadata = sectionMetadata(heading, slice);
    return {
      id: `section-${index + 1}-${hash(slice).slice(0, 12)}`,
      heading,
      content: slice,
      contentHash: hash(slice),
      ...metadata,
    };
  }).filter(section => section.content);

  let inheritedWave: string | undefined;
  let inheritedTimeframe: string | undefined;
  for (const section of sections) {
    if (section.wave) {
      inheritedWave = section.wave;
      if (!section.timeframe) inheritedTimeframe = undefined;
    }
    else if (inheritedWave) section.wave = inheritedWave;
    if (section.timeframe) inheritedTimeframe = section.timeframe;
    else if (inheritedTimeframe && inheritedWave) section.timeframe = inheritedTimeframe;
  }

  return sections.length ? sections : [{
    id: `section-1-${hash(normalized).slice(0, 12)}`,
    heading: 'Full document',
    content: normalized,
    contentHash: hash(normalized),
    typeGroups: [],
  }];
}
