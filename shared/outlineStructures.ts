/** Content definitions live exclusively in uploaded Skills & Rules Markdown. */
export interface OutlineStructure {
  id: string;
  name: string;
  description: string;
  useWhen: string;
  outlineInstructions: string;
  draftInstructions: string;
  requiredHeadings: Array<{ heading: string; level: 'h2' | 'h3' }>;
}
export interface OutlineStructureSnapshot extends OutlineStructure {
  schemaVersion: 1;
  sourceId: string;
  sourceName: string;
  sourceHash: string;
}
interface Source { id: string; name: string; category?: string; fileType?: string; content?: string; scanStatus?: string }
export function structureHash(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}
/** Compatibility adapter for the owner's existing prose-only generator MD.
 * Labels and instructions are extracted from explicit headings/list entries, not inferred by AI.
 */
function readGeneratorMarkdown(content: string): OutlineStructure[] {
  const section = (heading: string) => content.match(new RegExp(`^## ${heading}\\s*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm'))?.[1] ?? '';
  const formSection = section('Select a form');
  const comparisonSection = section('Comparison forms');
  if (!formSection.trim() || !comparisonSection.trim()) return [];
  const sharedFormGuidance = formSection.replace(/^-.*$/gm, '').trim();
  const common = (content.replace(/^## Select a form\s*\n[\s\S]*?(?=^## |$(?![\s\S]))/m, '').replace(/^## Comparison forms\s*\n[\s\S]*?(?=^## |$(?![\s\S]))/m, '').trim() + '\n' + sharedFormGuidance).trim();
  const choices: Array<{ name: string; instructions: string }> = [];
  for (const match of comparisonSection.matchAll(/^### (.+)\n([\s\S]*?)(?=^### |$(?![\s\S]))/gm)) {
    choices.push({ name: match[1].trim(), instructions: match[2].trim() });
  }
  for (const match of formSection.matchAll(/^- ([A-Za-z][\w&-]+)\s+(.+)$/gm)) {
    // A list entry that explicitly delegates to forms below is a group, not a selectable leaf.
    if (/\bselect\b.*\bbelow\b/i.test(match[2])) continue;
    choices.push({ name: match[1], instructions: match[0].slice(2).trim() });
  }
  return choices.map(choice => ({
    id: choice.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    name: choice.name,
    description: choice.instructions,
    useWhen: choice.instructions,
    outlineInstructions: `${common}\n\n## Selected form: ${choice.name}\n${choice.instructions}`,
    draftInstructions: [choice.instructions, section('Preparation').trim(), section('Depth and visuals').trim(), section('Final checks').trim()].filter(Boolean).join('\n\n'),
    requiredHeadings: [],
  }));
}
export function readOutlineStructures(files: Source[], allowedIds?: string[]) {
  const structures: OutlineStructureSnapshot[] = [];
  const errors: string[] = [];
  for (const file of files) {
    if (file.category !== 'rules' || !(file.fileType === 'md' || /\.md$/i.test(file.name)) || file.scanStatus === 'error' || !file.content || (allowedIds && !allowedIds.includes(file.id))) continue;
    const blocks = [...file.content.matchAll(/```outline-structures\s*\n([\s\S]*?)```/g)].map(block => block[1]);
    if (!blocks.length && file.name.toLowerCase() === '02-outline-generator.md') {
      const entries = readGeneratorMarkdown(file.content);
      if (entries.length) blocks.push(JSON.stringify({ version: 1, structures: entries }));
      else errors.push(`${file.name}: missing Select a form / Comparison forms declarations`);
    }
    for (const block of blocks) {
      try {
        const parsed = JSON.parse(block);
        if (parsed.version !== 1 || !Array.isArray(parsed.structures)) throw new Error('Expected version: 1 and structures array');
        for (const entry of parsed.structures) {
          const text = (key: string) => {
            if (typeof entry?.[key] !== 'string' || !entry[key].trim()) throw new Error(`Missing ${key}`);
            return entry[key].trim();
          };
          const id = text('id');
          if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(id)) throw new Error(`Invalid structure id: ${id}`);
          const requiredHeadings = entry.requiredHeadings ?? [];
          if (!Array.isArray(requiredHeadings) || requiredHeadings.some((h: any) => !h || typeof h.heading !== 'string' || !h.heading.trim() || !['h2', 'h3'].includes(h.level))) throw new Error(`Invalid requiredHeadings: ${id}`);
          structures.push({ id, name: text('name'), description: text('description'), useWhen: text('useWhen'), outlineInstructions: text('outlineInstructions'), draftInstructions: text('draftInstructions'), requiredHeadings: requiredHeadings.map((h: any) => ({ heading: h.heading.trim(), level: h.level })), schemaVersion: 1, sourceId: file.id, sourceName: file.name, sourceHash: structureHash(file.content) });
        }
      } catch (error) { errors.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`); }
    }
  }
  const duplicates = new Set(structures.filter((s, i, all) => all.findIndex(other => other.id === s.id) !== i).map(s => s.id));
  for (const id of duplicates) errors.push(`Duplicate outline structure id: ${id}`);
  // Never choose an arbitrary definition when two documents use the same ID.
  return { structures: structures.filter(s => !duplicates.has(s.id)), errors };
}
export function outlineStructurePrompt(snapshot: OutlineStructureSnapshot | null | undefined, stage: 'outline' | 'draft'): string {
  if (!snapshot) return '';
  return [
    `SELECTED OUTLINE STRUCTURE (frozen MD definition): ${snapshot.id} — ${snapshot.name}`,
    `SOURCE (internal metadata, never print in article): ${snapshot.sourceName} / ${snapshot.sourceHash}`,
    stage === 'outline' ? snapshot.outlineInstructions : snapshot.draftInstructions,
    `Required headings in order: ${JSON.stringify(snapshot.requiredHeadings)}`,
    stage === 'draft' ? 'Preserve every approved outline heading and its order. Do not add unplanned headings or select a different structure.' : 'Use this definition for layout; preserve the Article Spec, approved evidence and output JSON contract.',
  ].join('\n');
}
export function validateOutlineStructure(sections: Array<{ heading: string; level?: string }>, snapshot?: OutlineStructureSnapshot | null): string[] {
  if (!snapshot) return [];
  let cursor = 0;
  const errors: string[] = [];
  const normalize = (text: string) => text.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  for (const required of snapshot.requiredHeadings) {
    const offset = sections.slice(cursor).findIndex(s => normalize(s.heading) === normalize(required.heading) && s.level === required.level);
    if (offset < 0) errors.push(`Missing or out-of-order ${required.level.toUpperCase()}: ${required.heading}`);
    else cursor += offset + 1;
  }
  return errors;
}

export const OUTLINE_OPERATIONAL_STAGES = [
  { id: 'structured-handoff', instruction: 'Lock the selected title, angle, audience, tone and accepted keywords.' },
  { id: 'outline-mapping', instruction: 'Create ordered H2/H3 sections with search intent, keyword mapping and rationale. Layout and required sections come only from the selected frozen Markdown structure.', parameters: { minimumSections: 4 } },
  { id: 'evidence-registry', instruction: 'Reuse verified quotes by ID and reject unsupported references.' },
];
export const OUTLINE_RESPONSE_CONTRACT = [
  'Return only one valid JSON object, no Markdown fences or commentary.',
  'Schema: {"evidenceRegistry":{"ev-1":{"source":string,"note":string,"quote":string,"role":"kb"|"content_plan"|"rules"}},"sections":[{"id":string,"heading":string,"level":"h2"|"h3","notes":string,"rationale":string,"keywords":string[],"searchIntent":"informational"|"commercial"|"transactional"|"navigational","evidenceRefs":string[],"ruleRefs":string[]}]}',
  'Use actual reader-ready English headings. Give each section relevant keyword mapping, search intent, concise content guidance and rationale for its role, order and source support.',
  'Declare each verbatim quote once in evidenceRegistry; reuse its ID in evidenceRefs. Copy source names and quotes exactly from authorized documents.',
  'Each section needs evidence from Knowledge Base or current Content Plan when available, and a Rules quote when Rules are available. Skip empty source categories. Never invent or paraphrase evidence.',
  'Knowledge Base supplies factual claims. Current activity Content Plan supplies topic and keywords. The frozen selected MD structure supplies layout. Preserve the Article Spec and declared missing evidence.',
].join('\n');
export function buildOutlineTask(input: { spec: unknown; direction: unknown; structure?: OutlineStructureSnapshot | null; desiredSections: number; minimumSections: number }) {
  return [
    OUTLINE_RESPONSE_CONTRACT,
    `ARTICLE SPEC (immutable): ${JSON.stringify(input.spec)}`,
    `Selected direction: ${JSON.stringify(input.direction)}`,
    outlineStructurePrompt(input.structure, 'outline'),
    `Create approximately ${Math.max(input.desiredSections, input.structure?.requiredHeadings.length ?? 0)} sections; never fewer than ${input.minimumSections}.`,
    'Return ordered H2/H3 sections with heading, notes, rationale, keywords, searchIntent, evidenceRefs and ruleRefs. Use an evidenceRegistry to avoid repeating quotes.',
    'Use only exact quotes from supplied sources; never invent evidence. Preserve required headings in the selected structure in their exact order and level.',
  ].join('\n');
}

export function resolveOutlineSelection(files: Source[], allowedIds: string[], selection: Pick<OutlineStructureSnapshot, 'id' | 'sourceId' | 'sourceHash'>): OutlineStructureSnapshot {
  const catalog = readOutlineStructures(files, allowedIds);
  const match = catalog.structures.find(item => item.id === selection?.id && item.sourceId === selection?.sourceId && item.sourceHash === selection?.sourceHash);
  if (!match) throw new Error('Outline structure is missing, changed, duplicated or not authorized. Refresh Skills & Rules and select it again.');
  // Resolve content on the server, never trust instructions submitted by a browser.
  return match;
}
export function outlineSelectionUpdates(outlineStructure: OutlineStructureSnapshot) {
  return { outlineStructure, outlineNeedsRegeneration: true, draftNeedsRegeneration: true, editorialApproval: null, qualityReport: null, status: 'in_progress' as const, completedAt: null };
}
