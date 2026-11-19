import type { ReactNode } from 'react';
import type { AppConfig, DocumentFile, WorkflowRuleId } from '../types';
import { compileWorkflowRules, getWorkflowRuleSetting } from '../lib/workflowRules';
import { useI18n } from '../lib/i18n';
import { GATES } from './model';
import { I } from './ui';

interface Props { config: AppConfig; files: DocumentFile[]; onChange: (config: AppConfig) => void }

const Sec = ({ title, desc, children }: { title: string; desc: string; children: ReactNode }) => <section><h2>{title}</h2><p className="desc">{desc}</p>{children}</section>;

/** Numbers the pipeline reads (backend clamps to the same ranges). Stored as workflow-rule stage parameters. */
const PARAMS: Array<{ gate: number; rule: WorkflowRuleId; stage: string; param: string; min: number; max: number; def: number; vi: string; en: string; hintVi: string; hintEn: string }> = [
  { gate: 0, rule: 'core-idea', stage: 'market-research', param: 'keywordCount', min: 5, max: 20, def: 10, vi: 'Số keyword nghiên cứu', en: 'Keywords to research', hintVi: 'Số keyword SEO tra trên web cho mỗi bài.', hintEn: 'SEO keywords looked up on the web per article.' },
  { gate: 0, rule: 'core-idea', stage: 'idea-generation', param: 'ideaCount', min: 2, max: 6, def: 3, vi: 'Số ý tưởng', en: 'Ideas', hintVi: 'Số ý tưởng AI tạo ra để chọn một ý viết bài.', hintEn: 'Ideas generated before one is chosen.' },
  { gate: 1, rule: 'outline', stage: 'outline-mapping', param: 'minimumSections', min: 4, max: 12, def: 4, vi: 'Số section tối thiểu', en: 'Minimum sections', hintVi: 'Outline không được ít hơn số section này.', hintEn: 'The outline never has fewer sections.' },
  { gate: 2, rule: 'draft', stage: 'word-allocation', param: 'conclusionPercent', min: 5, max: 12, def: 7, vi: 'Độ dài kết luận (%)', en: 'Conclusion length (%)', hintVi: 'Phần trăm số từ dành cho kết luận.', hintEn: 'Share of the word budget for the conclusion.' },
  { gate: 2, rule: 'draft', stage: 'structured-assembly', param: 'maxSentencesPerParagraph', min: 2, max: 7, def: 5, vi: 'Số câu tối đa mỗi đoạn', en: 'Max sentences per paragraph', hintVi: 'Giữ đoạn văn ngắn, dễ đọc.', hintEn: 'Keeps paragraphs short and readable.' },
];

/** Team instructions per gate, appended to that gate's prompt. */
const NOTES: Array<{ gate: number; rule: WorkflowRuleId; step: number }> = [{ gate: 0, rule: 'core-idea', step: 2 }, { gate: 1, rule: 'outline', step: 3 }, { gate: 2, rule: 'draft', step: 4 }];

export default function WorkflowRules({ config, onChange }: Props) {
  const { tr } = useI18n();
  const rule = (id: WorkflowRuleId) => getWorkflowRuleSetting(config, id);
  const save = (id: WorkflowRuleId, patch: Partial<ReturnType<typeof getWorkflowRuleSetting>>) => {
    const current = rule(id);
    onChange({ ...config, workflowRules: { ...config.workflowRules, [id]: { ...current, ...patch, version: current.version + 1 } } });
  };
  const paramValue = (p: typeof PARAMS[number]) => Number(rule(p.rule).stageOverrides[p.stage]?.parameters?.[p.param] ?? p.def);
  const setParam = (p: typeof PARAMS[number], raw: number) => {
    const value = Math.min(p.max, Math.max(p.min, Math.round(raw) || p.def));
    const stages = rule(p.rule).stageOverrides;
    save(p.rule, { stageOverrides: { ...stages, [p.stage]: { ...stages[p.stage], parameters: { ...stages[p.stage]?.parameters, [p.param]: value } } } });
  };
  const words = Math.max(800, config.stepConfigs[4]?.maxDraftWords ?? config.stepConfigs[4]?.maxDraftCharacters ?? 1500);
  const setWords = (value: number) => onChange({ ...config, stepConfigs: { ...config.stepConfigs, 4: { ...config.stepConfigs[4], maxDraftWords: Math.min(10000, Math.max(800, value || 1500)) } } });

  // Settings from the old rule editor that still change prompts but have no control here any more.
  const legacy = (['source-grounding', 'core-idea', 'outline', 'draft', 'quality-persistence'] as WorkflowRuleId[]).filter(id => {
    const saved = config.workflowRules?.[id];
    if (!saved) return false;
    const hasStageText = Object.values(saved.stageOverrides ?? {}).some(stage => Boolean(stage?.instruction?.trim()));
    const ungatedNote = !NOTES.some(n => n.rule === id) && Boolean(saved.customInstruction?.trim());
    return saved.enforcement === 'guided' || saved.appliesTo?.batch === false || hasStageText || ungatedNote;
  });
  const resetLegacy = () => onChange({ ...config, workflowRules: Object.fromEntries(Object.entries(config.workflowRules ?? {}).map(([id, saved]) => {
    if (!saved) return [id, saved];
    const stageOverrides = Object.fromEntries(Object.entries(saved.stageOverrides ?? {}).map(([stage, o]) => [stage, { parameters: o?.parameters }]));
    const keepNote = NOTES.some(n => n.rule === id);
    return [id, { ...saved, enforcement: 'strict', appliesTo: { manual: true, batch: true }, stageOverrides, customInstruction: keepNote ? saved.customInstruction : '', version: saved.version + 1 }];
  })) });

  const fixed = [
    { icon: 'shield-check', vi: 'Đối chứng nguồn', en: 'Source grounding', dVi: 'AI chỉ dùng Content Plan, Knowledge Base và tài liệu Shipper cấp cho gate; không bịa số liệu hay trích dẫn.', dEn: 'AI uses only the Content Plan, Knowledge Base and documents Shipper gives the gate; no invented facts or quotes.' },
    { icon: 'list-check', vi: 'Quality Gate', en: 'Quality Gate', dVi: 'Kiểm tra cấu trúc, số từ, độ bao phủ, bảo mật và link, rồi AI Review chấm điểm. Bài đạt ngưỡng ở Settings › Pipeline mới thành AI Approved.', dEn: 'Checks structure, word count, coverage, confidentiality and links, then AI Review scores it. Only drafts at the Settings › Pipeline threshold become AI Approved.' },
    { icon: 'user-check', vi: 'Duyệt outline Editorial', en: 'Editorial outline approval', dVi: 'Bài Editorial dừng sau G2 cho đến khi có người duyệt outline.', dEn: 'Editorial articles stop after G2 until a person approves the outline.' },
    { icon: 'language', vi: 'Bài viết bằng tiếng Anh', en: 'Articles in English', dVi: 'Nội dung bài luôn tạo bằng tiếng Anh; giao diện mới dịch sang tiếng Việt.', dEn: 'Article content is always generated in English; only the UI is translated.' },
  ];

  return <>
    <Sec title={tr('Thông số pipeline', 'Pipeline numbers')} desc={tr('Các con số pipeline dùng khi chạy từng gate. Áp dụng cho lượt chạy tiếp theo.', 'Numbers the pipeline uses at each gate. Apply to the next run.')}>
      <div className="box">
        {PARAMS.slice(0, 3).map(p => <div key={p.param} className="box-row" style={{ flexWrap: 'wrap' }}>
          <span className={`tag t-${GATES[p.gate].color}`}>{GATES[p.gate].short}</span>
          <div className="grow" style={{ minWidth: 200 }}>{tr(p.vi, p.en)}<div className="s">{tr(p.hintVi, p.hintEn)} ({p.min}–{p.max})</div></div>
          <input className="inp" style={{ width: 90 }} type="number" min={p.min} max={p.max} aria-label={tr(p.vi, p.en)} value={paramValue(p)} onChange={e => setParam(p, Number(e.target.value))} />
        </div>)}
        <div className="box-row" style={{ flexWrap: 'wrap' }}>
          <span className={`tag t-${GATES[2].color}`}>{GATES[2].short}</span>
          <div className="grow" style={{ minWidth: 200 }}>{tr('Số từ mục tiêu', 'Target words')}<div className="s">{tr('Độ dài bài tiếng Anh; QC chấp nhận khoảng ±15%.', 'English article length; QC accepts about ±15%.')} (800–10000)</div></div>
          <input className="inp" style={{ width: 90 }} type="number" min={800} max={10000} step={100} aria-label={tr('Số từ tiếng Anh mục tiêu', 'Target English words')} value={words} onChange={e => setWords(Number(e.target.value))} />
        </div>
        {PARAMS.slice(3).map(p => <div key={p.param} className="box-row" style={{ flexWrap: 'wrap' }}>
          <span className={`tag t-${GATES[p.gate].color}`}>{GATES[p.gate].short}</span>
          <div className="grow" style={{ minWidth: 200 }}>{tr(p.vi, p.en)}<div className="s">{tr(p.hintVi, p.hintEn)} ({p.min}–{p.max})</div></div>
          <input className="inp" style={{ width: 90 }} type="number" min={p.min} max={p.max} aria-label={tr(p.vi, p.en)} value={paramValue(p)} onChange={e => setParam(p, Number(e.target.value))} />
        </div>)}
      </div>
    </Sec>

    <Sec title={tr('Hướng dẫn riêng của team', 'Team instructions')} desc={tr('Thêm yêu cầu riêng cho từng gate, ví dụ giọng văn hay điều cần tránh. Không cần chép lại quy tắc mặc định.', 'Add your own requirements per gate, such as tone or things to avoid. No need to repeat the default rules.')}>
      <div className="box">{NOTES.map(n => {
        const prompt = compileWorkflowRules(config, n.step, 'batch');
        return <div key={n.rule} className="box-row" style={{ display: 'block' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}><span className={`tag t-${GATES[n.gate].color}`}>{GATES[n.gate].short}</span>{GATES[n.gate].label}</div>
          <textarea className="inp" rows={2} style={{ height: 'auto', padding: 8, resize: 'vertical' }} aria-label={`${tr('Hướng dẫn cho', 'Instructions for')} ${GATES[n.gate].label}`} placeholder={tr('Không có hướng dẫn thêm', 'No extra instructions')} value={rule(n.rule).customInstruction} onChange={e => save(n.rule, { customInstruction: e.target.value })} />
          <details style={{ marginTop: 6 }}><summary style={{ cursor: 'pointer', color: 'var(--f3)', fontSize: 12 }}>{tr('Xem quy tắc AI nhận ở gate này', 'See the rules AI receives at this gate')}</summary><pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, color: 'var(--f2)', background: 'var(--bg2)', borderRadius: 6, padding: 8, marginTop: 6, maxHeight: 260, overflow: 'auto' }}>{[prompt.systemPrompt, prompt.taskGuidance].filter(Boolean).join('\n\n')}</pre></details>
        </div>;
      })}</div>
    </Sec>

    <Sec title={tr('Luôn bật', 'Always on')} desc={tr('Các bảo vệ chất lượng này luôn chạy ở mọi bài, không cần cài đặt.', 'These quality safeguards always run on every article; nothing to set.')}>
      <div className="box">{fixed.map(f => <div key={f.en} className="box-row"><I n={f.icon} /><div className="grow">{tr(f.vi, f.en)}<div className="s">{tr(f.dVi, f.dEn)}</div></div><span className="tag t-green">{tr('Luôn bật', 'On')}</span></div>)}</div>
      {legacy.length > 0 && <div className="box" style={{ marginTop: 12 }}><div className="box-row" style={{ flexWrap: 'wrap' }}><I n="history" /><div className="grow" style={{ minWidth: 220 }}>{tr('Có tuỳ chỉnh nâng cao từ phiên bản cũ', 'Advanced customizations from the old editor')}<div className="s">{tr('Chế độ Guided, tắt quy tắc cho batch hoặc câu lệnh sửa riêng từng bước vẫn đang áp dụng. Đặt lại để dùng quy tắc mặc định (giữ thông số và hướng dẫn của team).', 'Guided mode, rules turned off for batch, or rewritten stage text still apply. Reset to the default rules (numbers and team instructions are kept).')}</div></div><button className="btn" onClick={resetLegacy}><I n="restore" />{tr('Đặt lại mặc định', 'Reset to defaults')}</button></div></div>}
    </Sec>
  </>;
}
