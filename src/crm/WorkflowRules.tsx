import type { ReactNode } from 'react';
import type { AppConfig, DocumentFile, WorkflowRuleId } from '../types';
import { compileWorkflowRules, getWorkflowRuleSetting } from '../lib/workflowRules';
import { useI18n } from '../lib/i18n';
import { GATES } from './model';
import { I } from './ui';
import { GATE_DOCUMENT_CONTRACT, GATE_PARAMETERS, ROLE_LABEL_VI, ROLE_ORDER, primaryPlaybookId, resolveGateParameters, ruleRoleOf, type GateRole } from '../../shared/gateDocuments';

interface Props { config: AppConfig; files: DocumentFile[]; onChange: (config: AppConfig) => void }

const Sec = ({ title, desc, children }: { title: string; desc: string; children: ReactNode }) => <section><h2>{title}</h2><p className="desc">{desc}</p>{children}</section>;

/** Team instructions per gate, appended to that gate's prompt. */
const NOTES: Array<{ gate: number; rule: WorkflowRuleId; step: number }> = [{ gate: 0, rule: 'core-idea', step: 2 }, { gate: 1, rule: 'outline', step: 3 }, { gate: 2, rule: 'draft', step: 4 }];

export default function WorkflowRules({ config, files, onChange }: Props) {
  const { tr } = useI18n();
  const rule = (id: WorkflowRuleId) => getWorkflowRuleSetting(config, id);
  const save = (id: WorkflowRuleId, patch: Partial<ReturnType<typeof getWorkflowRuleSetting>>) => {
    const current = rule(id);
    onChange({ ...config, workflowRules: { ...config.workflowRules, [id]: { ...current, ...patch, version: current.version + 1 } } });
  };
  const params = resolveGateParameters(files, config);
  const gateOf = (step: number) => GATES.find(g => g.step === step)!;
  const sourceText = (id: string) => { const src = params[id].source; return src.kind === 'file' ? tr(`đọc từ ${src.name}`, `from ${src.name}`) : src.kind === 'settings' ? tr('giá trị cũ trong Settings', 'old Settings value') : tr('mặc định', 'default'); };
  const rulesFor = (step: number) => files.filter(f => f.category === 'rules' && (config.stepConfigs[step]?.fileAccess?.rules ?? []).includes(f.id));
  const setPrimary = (step: number, id: string) => onChange({ ...config, stepConfigs: { ...config.stepConfigs, [step]: { ...config.stepConfigs[step], primaryPlaybookId: id || undefined } } });
  /** Documents of a Gate in the order and role the backend sends them. */
  const docsFor = (step: number) => {
    const access = config.stepConfigs[step]?.fileAccess;
    const kb = files.filter(f => f.category === 'kb' && (access?.kb ?? []).includes(f.id)).map(f => ({ name: f.name, role: 'KNOWLEDGE_BASE' as GateRole }));
    const rules = rulesFor(step).map(f => ({ name: f.name, role: ruleRoleOf(f, config, step) }));
    return [...rules, ...kb, { name: tr('Content Plan của bài', "Article's Content Plan"), role: 'CONTENT_PLAN' as GateRole }].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
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
    <Sec title={tr('Thông số pipeline', 'Pipeline numbers')} desc={tr('Các con số pipeline dùng ở từng gate. Sửa trong front matter của Playbook chính hoặc Standards của Gate; áp dụng cho lượt chạy tiếp theo.', "Numbers the pipeline uses at each gate. Edit them in the front matter of the Gate's primary Playbook or Standards; they apply to the next run.")}>
      <div className="box">
        {GATE_PARAMETERS.map(p => <div key={p.id} className="box-row" style={{ flexWrap: 'wrap' }}>
          <span className={`tag t-${gateOf(p.step).color}`}>{gateOf(p.step).short}</span>
          <div className="grow" style={{ minWidth: 200 }}>{tr(p.vi, p.en)} <code style={{ fontSize: 11, color: 'var(--f3)' }}>{p.id}</code><div className="s">{tr(p.hintVi, p.hintEn)} ({p.min}–{p.max}) · {sourceText(p.id)}</div></div>
          <b style={{ minWidth: 40, textAlign: 'right' }}>{params[p.id].value}</b>
        </div>)}
        <div className="box-row" style={{ flexWrap: 'wrap' }}>
          <span className={`tag t-${GATES[2].color}`}>{GATES[2].short}</span>
          <div className="grow" style={{ minWidth: 200 }}>{tr('Số từ mục tiêu', 'Target words')}<div className="s">{tr('Độ dài bài tiếng Anh; QC chấp nhận khoảng ±15%.', 'English article length; QC accepts about ±15%.')} (800–10000)</div></div>
          <input className="inp" style={{ width: 90 }} type="number" min={800} max={10000} step={100} aria-label={tr('Số từ tiếng Anh mục tiêu', 'Target English words')} value={words} onChange={e => setWords(Number(e.target.value))} />
        </div>
      </div>
    </Sec>

    <Sec title={tr('Playbook chính của mỗi Gate', 'Primary Playbook per Gate')} desc={tr('Playbook chính là quy tắc AI phải bám theo ở Gate đó. Chỉ chọn được file Rules đã tick cho Gate trong Storage. Standards là yêu cầu bắt buộc, Voice & Style chỉ quyết định cách diễn đạt.', 'The primary Playbook is the method AI must follow at that Gate. Only Rules files ticked for the Gate in Storage can be chosen. Standards are mandatory; Voice & Style only shapes wording.')}>
      <div className="box">{NOTES.map(n => {
        const gate = GATES[n.gate];
        const prompt = compileWorkflowRules(config, n.step, 'batch');
        const primary = primaryPlaybookId(config, n.step);
        const note = rule(n.rule).customInstruction;
        return <div key={n.rule} className="box-row" style={{ display: 'block' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className={`tag t-${gate.color}`}>{gate.short}</span><span className="grow">{gate.label}</span>
            <select className="inp" style={{ width: 280, maxWidth: '100%' }} aria-label={`${tr('Playbook chính cho', 'Primary Playbook for')} ${gate.label}`} value={primary ?? ''} onChange={e => setPrimary(n.step, e.target.value)}>
              <option value="">{tr('Chưa chọn Playbook chính', 'No primary Playbook')}</option>
              {rulesFor(n.step).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          {primary
            ? note.trim() && <p className="s" style={{ marginTop: 8 }}>{tr('Ghi chú cũ của team không còn được gửi vì Gate đã có Playbook chính. Chép vào file nếu cần:', 'The old team note is no longer sent because this Gate has a primary Playbook. Copy it into the file if needed:')} <i>{note}</i></p>
            : <textarea className="inp" rows={2} style={{ height: 'auto', padding: 8, resize: 'vertical', marginTop: 8 }} aria-label={`${tr('Ghi chú cho', 'Note for')} ${gate.label}`} placeholder={tr('Ghi chú tạm cho Gate (nên chuyển vào Playbook chính)', 'Temporary note for this Gate (better moved into the primary Playbook)')} value={note} onChange={e => save(n.rule, { customInstruction: e.target.value })} />}
          <details style={{ marginTop: 6 }}><summary style={{ cursor: 'pointer', color: 'var(--f3)', fontSize: 12 }}>{tr('Xem prompt AI nhận ở gate này', 'See what AI receives at this gate')}</summary><pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, color: 'var(--f2)', background: 'var(--bg2)', borderRadius: 6, padding: 8, marginTop: 6, maxHeight: 320, overflow: 'auto' }}>{[prompt.systemPrompt, prompt.taskGuidance, GATE_DOCUMENT_CONTRACT, `${tr('Tài liệu gửi theo thứ tự', 'Documents in send order')}:\n${docsFor(n.step).map(d => `- ${ROLE_LABEL_VI[d.role]}: ${d.name}`).join('\n')}`].filter(Boolean).join('\n\n')}</pre></details>
        </div>;
      })}</div>
      <p className="s" style={{ marginTop: 8 }}>{tr('Đặt các con số ở đầu file Playbook chính hoặc file Standards của Gate, ví dụ:', "Set the numbers at the top of the Gate's primary Playbook or a Standards file, for example:")}</p>
      <pre style={{ fontSize: 12, color: 'var(--f2)', background: 'var(--bg2)', borderRadius: 6, padding: 8 }}>{'---\nintroMinWords: 60\nintroMaxWords: 85\nconclusionPercent: 7\nmaxSentencesPerParagraph: 5\n---'}</pre>
    </Sec>

    <Sec title={tr('Luôn bật', 'Always on')} desc={tr('Các bảo vệ chất lượng này luôn chạy ở mọi bài, không cần cài đặt.', 'These quality safeguards always run on every article; nothing to set.')}>
      <div className="box">{fixed.map(f => <div key={f.en} className="box-row"><I n={f.icon} /><div className="grow">{tr(f.vi, f.en)}<div className="s">{tr(f.dVi, f.dEn)}</div></div><span className="tag t-green">{tr('Luôn bật', 'On')}</span></div>)}</div>
      {legacy.length > 0 && <div className="box" style={{ marginTop: 12 }}><div className="box-row" style={{ flexWrap: 'wrap' }}><I n="history" /><div className="grow" style={{ minWidth: 220 }}>{tr('Có tuỳ chỉnh nâng cao từ phiên bản cũ', 'Advanced customizations from the old editor')}<div className="s">{tr('Chế độ Guided, tắt quy tắc cho batch hoặc câu lệnh sửa riêng từng bước vẫn đang áp dụng. Đặt lại để dùng quy tắc mặc định (giữ thông số và hướng dẫn của team).', 'Guided mode, rules turned off for batch, or rewritten stage text still apply. Reset to the default rules (numbers and team instructions are kept).')}</div></div><button className="btn" onClick={resetLegacy}><I n="restore" />{tr('Đặt lại mặc định', 'Reset to defaults')}</button></div></div>}
    </Sec>
  </>;
}
